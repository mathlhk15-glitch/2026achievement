"""Build the explorer using only Python's standard library. Never edits source documents."""
from pathlib import Path
import argparse, base64, collections, hashlib, json, re, shutil, sys, tempfile, zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[1]
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + NS['w'] + '}'
CODE = re.compile(r'\[\s*(\d{2}[^\[\]\n]{1,30}?\d{2}[-－–]\d{2})\s*\]')

def norm_code(s):
    return re.sub(r'\s+', '', s).replace('－', '-').replace('–', '-')

def norm_text(s):
    return re.sub(r'\s+', '', s)

def text_of(el):
    chunks = []
    for child in el.iter():
        tag = child.tag.split('}')[-1]
        if tag == 't':
            chunks.append(child.text or '')
        elif tag in ('br', 'cr'):
            chunks.append('\n')
        elif tag == 'tab':
            chunks.append(' ')
    return ''.join(chunks).strip()

def numbering_markers(root, numbering):
    """Resolve Word's generated list numbers, which are not stored as text nodes."""
    if numbering is None:
        return {}
    abstracts = {}
    for abstract in numbering.findall('w:abstractNum', NS):
        levels = {}
        for lvl in abstract.findall('w:lvl', NS):
            fmt, pattern, start = (lvl.find('w:' + k, NS) for k in ('numFmt', 'lvlText', 'start'))
            levels[int(lvl.get(W + 'ilvl', '0'))] = (
                fmt.get(W + 'val', 'decimal') if fmt is not None else 'decimal',
                pattern.get(W + 'val', '%1.') if pattern is not None else '%1.',
                int(start.get(W + 'val', '1')) if start is not None else 1)
        abstracts[abstract.get(W + 'abstractNumId')] = levels
    nums = {}
    for num in numbering.findall('w:num', NS):
        abstract = num.find('w:abstractNumId', NS)
        levels = dict(abstracts.get(abstract.get(W + 'val') if abstract is not None else '', {}))
        for override in num.findall('w:lvlOverride', NS):
            start = override.find('w:startOverride', NS)
            level = int(override.get(W + 'ilvl', '0'))
            if start is not None and level in levels:
                fmt, pattern, _ = levels[level]
                levels[level] = (fmt, pattern, int(start.get(W + 'val', '1')))
        nums[num.get(W + 'numId')] = levels
    counters, markers = {}, {}
    for p in root.findall('.//w:p', NS):
        num_id, level_el = p.find('w:pPr/w:numPr/w:numId', NS), p.find('w:pPr/w:numPr/w:ilvl', NS)
        if num_id is None or num_id.get(W + 'val') == '0':
            continue
        num_id = num_id.get(W + 'val')
        level = int(level_el.get(W + 'val', '0')) if level_el is not None else 0
        levels = nums.get(num_id, {})
        if level not in levels:
            continue
        fmt, pattern, start = levels[level]
        if fmt == 'bullet':
            marker = '•' if any(0xE000 <= ord(c) <= 0xF8FF for c in pattern) else pattern
        elif fmt == 'none':
            continue
        else:
            key = (num_id, level)
            counters[key] = counters.get(key, start - 1) + 1
            for deeper in list(counters):
                if deeper[0] == num_id and deeper[1] > level:
                    del counters[deeper]
            marker = re.sub(r'%(\d+)', lambda m: str(counters.get((num_id, int(m.group(1)) - 1), levels.get(int(m.group(1)) - 1, ('', '', 1))[2])), pattern)
        markers[id(p)] = marker
    return markers

def block(el, markers=None):
    markers = markers or {}
    if el.tag == W + 'p':
        t = text_of(el)
        if not t:
            return None
        style = el.find('w:pPr/w:pStyle', NS)
        return {'type': 'paragraph', 'text': t, 'prefix': markers.get(id(el), ''),
                'style': style.get(W + 'val', '') if style is not None else ''}
    if el.tag == W + 'tbl':
        rows = []
        for row in el.findall('w:tr', NS):
            cells = []
            for cell in row.findall('w:tc', NS):
                span = cell.find('w:tcPr/w:gridSpan', NS)
                merge = cell.find('w:tcPr/w:vMerge', NS)
                paragraphs = [{'text': text_of(p), 'prefix': markers.get(id(p), '')} for p in cell.findall('.//w:p', NS) if text_of(p)]
                cells.append({'text': '\n'.join(p['text'] for p in paragraphs), 'paragraphs': paragraphs,
                              'span': int(span.get(W + 'val', '1')) if span is not None else 1,
                              'merge': merge.get(W + 'val', 'continue') if merge is not None else None})
            rows.append(cells)
        return {'type': 'table', 'rows': rows}
    return None

def block_text(b):
    return b['text'] if b['type'] == 'paragraph' else '\n'.join(c['text'] for r in b['rows'] for c in r)

def is_reviewed(example):
    """An example is shown as reviewed when its source is not a draft and its standard text matches."""
    return not example.get('draft') and not example.get('textReview')

def search_text(text):
    return re.sub(r'\s+', ' ', text).strip()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tmp.replace(path)

def bootstrap(html_path):
    html = html_path.read_text(encoding='utf-8-sig')
    start = html.index('const DATA=') + len('const DATA=')
    data, _ = json.JSONDecoder().raw_decode(html[start:])
    subjects = []
    for s in data['subjects']:
        ident = hashlib.sha256(json.dumps([s.get(k, '') for k in ('d', 'g', 'n', 'k', 'lv')], ensure_ascii=False).encode()).hexdigest()[:12]
        subjects.append({'id': ident, 'domain': s['d'], 'group': s['g'], 'name': s['n'],
                         'key': s['k'], 'level': s.get('lv', ''),
                         'standards': [{'code': norm_code(x['c']), 'text': x['t'], 'area': x.get('a', '')} for x in s['std']]})
    images = ROOT / 'public/assets/textbooks'
    images.mkdir(parents=True, exist_ok=True)
    textbooks = []
    for item in data.get('tb', []):
        item = dict(item)
        image = item.pop('img', '')
        if image.startswith('data:'):
            raw = base64.b64decode(image.split(',', 1)[1])
            filename = hashlib.sha256(raw).hexdigest()[:20] + '.jpg'
            (images / filename).write_bytes(raw)
            item['image'] = 'assets/textbooks/' + filename
        textbooks.append(item)
    write_json(ROOT / 'baseline/subjects.json', subjects)
    write_json(ROOT / 'baseline/textbooks.json', textbooks)

def part_names(z):
    """Map normalized part names to stored names. Some Windows tools store 'word\\document.xml'."""
    return {n.replace('\\', '/').lstrip('/'): n for n in z.namelist()}

def read_part(z, name):
    stored = part_names(z).get(name)
    if stored is None:
        raise KeyError(f"There is no item named '{name}' in the archive")
    return z.read(stored)

def read_document(path):
    before = path.stat()
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(read_part(z, 'word/document.xml'))
        numbering = ET.fromstring(read_part(z, 'word/numbering.xml')) if 'word/numbering.xml' in part_names(z) else None
    after = path.stat()
    if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
        raise ValueError('문서가 읽는 중 변경되었습니다. 저장을 마친 뒤 다시 갱신하세요.')
    markers = numbering_markers(root, numbering)
    blocks = [b for el in root.find('w:body', NS) if (b := block(el, markers))]
    intro, sections, active = [], [], None
    for b in blocks:
        t = block_text(b)
        header_text = t if b['type'] == 'paragraph' else '\n'.join(c['text'] for c in b['rows'][0][:2]) if b['rows'] else ''
        matches = list(CODE.finditer(header_text))
        # Codes cited inside activity tables are references, not new examples.
        prefix = header_text[:matches[0].start()].strip() if matches else ''
        is_header = bool(matches) and (len(prefix) <= 8 if b['type'] == 'paragraph'
                                      else norm_text(prefix) in ('', '성취기준', '성취기준코드', '성취기준원문'))
        if is_header:
            if active:
                sections.append(active)
            active = {'codes': list(dict.fromkeys(norm_code(m.group(1)) for m in matches)),
                      'blocks': [b], 'heading': t[:240]}
        elif active is not None:
            active['blocks'].append(b)
        else:
            intro.append(b)
    if active:
        sections.append(active)
    return intro, sections

def build(args):
    if args.baseline:
        bootstrap(Path(args.baseline))
    if not (ROOT / 'baseline/subjects.json').exists():
        raise SystemExit('처음 실행할 때 --baseline 원본탐색기.html 을 지정하세요.')
    source = Path(args.source_dir).resolve()
    if not source.exists():
        raise SystemExit('자료 폴더가 없습니다: ' + str(source))
    subjects = json.loads((ROOT / 'baseline/subjects.json').read_text(encoding='utf-8'))
    code_map = collections.defaultdict(list)
    for s in subjects:
        for st in s['standards']:
            code_map[st['code']].append((s, st))
    corrections_path = ROOT / 'baseline/display-overrides.json'
    corrections = json.loads(corrections_path.read_text(encoding='utf-8')) if corrections_path.exists() else {}
    for code, correction in corrections.items():
        if code not in code_map or any(norm_text(st['text']) != norm_text(correction['originalText']) for _, st in code_map[code]):
            raise SystemExit('수식 표시 보정의 기준 자료가 달라졌습니다. 대조가 필요합니다: ' + code)
        if re.search('[\ue000-\uf8ff]', correction['displayText']):
            raise SystemExit('수식 표시 보정에 깨진 문자가 남아 있습니다: ' + code)
        for _, st in code_map[code]:
            st['displayText'] = correction['displayText']
    per_subject = {s['id']: collections.defaultdict(list) for s in subjects}
    report = {'files': [], 'unmatched': [], 'orphanExamples': [], 'errors': [], 'textDifferences': [], 'ambiguous': []}
    imports = []
    total_sections = total_examples = duplicates = 0
    fingerprints = {}
    paths = sorted(p for p in source.rglob('*') if p.is_file() and p.suffix.lower() == '.docx' and not p.name.startswith('~$'))
    if not paths:
        raise SystemExit('자료 폴더에 DOCX가 없습니다. 기존 결과를 유지합니다.')
    for path in paths:
        source_name = path.relative_to(source).as_posix()
        try:
            intro, sections = read_document(path)
        except Exception as exc:
            report['errors'].append({'file': source_name, 'error': str(exc)})
            continue
        file_id = hashlib.sha256(source_name.encode()).hexdigest()[:16]
        intro_text = '\n'.join(block_text(b) for b in intro)
        draft = bool(re.search(r'설계 초안|1차 초안|검수 전|검토 후 확정', intro_text))
        file_info = {'id': file_id, 'name': source_name, 'sections': len(sections), 'intro': intro, 'draft': draft}
        imports.append(file_info)
        linked = 0
        for index, section in enumerate(sections, 1):
            total_sections += 1
            content = '\n'.join(block_text(b) for b in section['blocks'])
            example = {'id': file_id + '-' + str(index), 'blocks': section['blocks'],
                       'format': 'flow' if '기본' in content and '심화' in content else 'plan',
                       'sources': [{'id': file_id, 'file': source_name, 'section': index, 'draft': draft}], 'draft': draft}
            example['searchText'] = content
            for code in section['codes']:
                targets = code_map.get(code, [])
                if not targets:
                    report['unmatched'].append({'file': source_name, 'section': index, 'code': code})
                    report['orphanExamples'].append(dict(example, code=code))
                    continue
                if len(targets) > 1:
                    named = [pair for pair in targets if norm_text(pair[0]['name']) in norm_text(path.stem + ' ' + '\n'.join(block_text(b) for b in intro))]
                    if named:
                        targets = named
                    if len(targets) > 1:
                        report['ambiguous'].append({'file': source_name, 'code': code, 'subjects': [s['name'] for s, _ in targets]})
                for s, st in targets:
                    # Do not change a source's text to make it agree with the baseline.
                    if norm_text(st['text']) not in norm_text(content):
                        report['textDifferences'].append({'file': source_name, 'section': index, 'code': code, 'subject': s['name']})
                        example = dict(example, textReview=True)
                    canonical = [{k: v for k, v in b.items() if k != 'style'} for b in section['blocks']]
                    fp = (s['id'], code, hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True).encode()).hexdigest())
                    if fp in fingerprints:
                        existing = fingerprints[fp]
                        if example['sources'][0] not in existing['sources']:
                            existing['sources'].extend(example['sources'])
                        existing['draft'] = existing.get('draft', False) or draft
                        duplicates += 1
                    else:
                        entry = dict(example, sources=list(example['sources']))
                        per_subject[s['id']][code].append(entry)
                        fingerprints[fp] = entry
                        total_examples += 1
                    linked += 1
        report['files'].append({'file': source_name, 'sections': len(sections), 'linked': linked, 'draft': draft})
    # Only publish a completed build. A live, incomplete DOCX leaves the last working build intact.
    if report['errors']:
        write_json(ROOT / 'reports/failed-import.json', report)
        raise SystemExit('읽지 못한 문서가 있어 기존 결과를 유지했습니다. reports/failed-import.json을 확인하세요.')
    staging = tempfile.TemporaryDirectory(prefix='.build-', dir=ROOT)
    out = Path(staging.name) / 'dist'
    out.mkdir()
    shutil.copytree(ROOT / 'public', out, dirs_exist_ok=True)
    covered = reviewed_total = draft_total = review_total = 0
    search_index = {}
    for s in subjects:
        count = 0
        for examples in per_subject[s['id']].values():
            examples.sort(key=lambda e: (bool(e.get('textReview')), bool(e.get('draft')), e['format'] != 'flow', e['sources'][0]['file']))
        for st in s['standards']:
            st['exampleCount'] = len(per_subject[s['id']][st['code']])
            st['reviewedCount'] = sum(1 for e in per_subject[s['id']][st['code']] if is_reviewed(e))
            st['sourceCount'] = sum(len(e['sources']) for e in per_subject[s['id']][st['code']])
            count += bool(st['exampleCount'])
        s['covered'] = count
        covered += count
        for examples in per_subject[s['id']].values():
            for e in examples:
                reviewed_total += is_reviewed(e)
                draft_total += bool(e.get('draft'))
                review_total += bool(e.get('textReview'))
        # searchText is kept in the separate search index so detail files stay small.
        write_json(out / 'data/inquiries' / (s['id'] + '.json'),
                   {code: [{k: v for k, v in e.items() if k != 'searchText'} for e in examples] for code, examples in per_subject[s['id']].items()})
        search_index[s['id']] = {code: [[e['id'], search_text(e['searchText'])] for e in examples] for code, examples in per_subject[s['id']].items() if examples}
    report['summary'] = {'documents': len(paths), 'subjects': len(subjects), 'standards': sum(len(s['standards']) for s in subjects),
                         'coveredStandards': covered, 'sections': total_sections, 'examples': total_examples,
                         'exactDuplicatesMerged': duplicates, 'unmatched': len(report['unmatched']),
                         'textDifferences': len(report['textDifferences']), 'ambiguous': len(report['ambiguous'])}
    report['summary'].update({'reviewedExamples': reviewed_total, 'draftExamples': draft_total, 'reviewExamples': review_total})
    report['summary']['displayCorrectionCount'] = len(corrections)
    report['displayCorrections'] = corrections
    report['generatedAt'] = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec='seconds')
    write_json(out / 'data/catalog.json', {'subjects': subjects, 'summary': report['summary'], 'generatedAt': report['generatedAt'], 'displayCorrections': corrections})
    write_json(out / 'data/textbooks.json', json.loads((ROOT / 'baseline/textbooks.json').read_text(encoding='utf-8')))
    write_json(out / 'data/sources.json', imports)
    write_json(out / 'data/search.json', search_index)
    write_json(out / 'data/report.json', report)
    try:
        from validate import validate
        validate(output_dir=out, source_dir=source, project_root=ROOT, quiet=True)
    except Exception as exc:
        report['errors'].append({'stage': 'validation', 'error': str(exc)})
        write_json(ROOT / 'reports/failed-import.json', report)
        staging.cleanup()
        raise SystemExit('생성 자료 검증에 실패하여 기존 결과를 유지했습니다: ' + str(exc)) from exc
    shutil.copytree(out, ROOT / 'dist', dirs_exist_ok=True)
    staging.cleanup()
    write_json(ROOT / 'reports/import-report.json', report)
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))

if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', help='성취기준및교과서목차탐색기.html (처음 한 번)')
    parser.add_argument('--source-dir', default=str(ROOT / 'source-docs'), help='과목별 워드 파일이 있는 폴더')
    build(parser.parse_args())
