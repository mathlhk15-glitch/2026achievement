"""Compare the exported website itself with every source document and baseline."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import collections, hashlib, json, zipfile
import xml.etree.ElementTree as ET
from build import ROOT, NS, read_document, block_text, norm_text, read_part, status_of, is_usable, search_text, source_paths, example_title, careers_of, STATUSES

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def canonical(blocks):
    return [{k: v for k, v in block.items() if k != 'style'} for block in blocks]

def validate(output_dir=None, source_dir=None, project_root=None, quiet=False):
    project = Path(project_root) if project_root is not None else ROOT
    dist = Path(output_dir) if output_dir is not None else project / 'dist'
    source_dir = Path(source_dir) if source_dir is not None else project / 'source-docs'
    catalog, report = load(dist / 'data/catalog.json'), load(dist / 'data/report.json')
    source_infos = load(dist / 'data/sources.json')
    baseline = load(project / 'baseline/subjects.json')
    baseline_by_id = {s['id']: s for s in baseline}
    subjects = catalog['subjects']
    correction_path = project / 'baseline/display-overrides.json'
    corrections = load(correction_path) if correction_path.exists() else {}
    assert catalog.get('displayCorrections', {}) == report.get('displayCorrections', {}) == corrections, '수식 표시 보정 근거 불일치'
    assert len({s['id'] for s in subjects}) == len(subjects), '과목 식별자 중복'
    assert {s['id'] for s in subjects} == set(baseline_by_id), '기준 자료와 과목 목록 불일치'
    assert not report['errors'], '읽지 못한 문서가 있습니다.'
    info_by_name = {s['name']: s for s in source_infos}
    assert len(info_by_name) == len(source_infos), '중복된 출처 경로'
    paths, excluded = source_paths(source_dir, project)
    all_paths = sorted(p.relative_to(source_dir).as_posix() for p in paths)
    assert sorted(e['file'] for e in report.get('excludedFiles', [])) == sorted(excluded), '제외 목록과 실제 제외 문서 불일치'
    assert not set(excluded) & {f['file'] for f in report['files']}, '제외한 문서가 결과에 들어 있습니다.'
    assert sorted(f['file'] for f in report['files']) == all_paths, '새 자료 또는 삭제된 자료가 결과에 반영되지 않았습니다.'
    assert set(info_by_name) == set(all_paths), '출처 안내 누락'
    expected = {}
    total_sections = 0
    for file in report['files']:
        name = file['file']
        path = source_dir / name
        with zipfile.ZipFile(path) as z:
            xml = ET.fromstring(read_part(z, 'word/document.xml'))
        original = ''.join(t.text or '' for t in xml.find('w:body', NS).iter() if t.tag.split('}')[-1] == 't')
        intro, sections = read_document(path)
        extracted = ''.join(block_text(b) for b in intro)
        extracted += ''.join(block_text(b) for section in sections for b in section['blocks'])
        assert norm_text(original) == norm_text(extracted), '미지원 구조 또는 원문 텍스트 누락: ' + name
        info = info_by_name[name]
        assert info['id'] == hashlib.sha256(name.encode()).hexdigest()[:16], '출처 식별자 오류: ' + name
        assert info['intro'] == intro, '출처 활용 안내 변경 또는 누락: ' + name
        assert len(sections) == file['sections'] == info['sections'], '문서 묶음 수 불일치: ' + name
        for index, section in enumerate(sections, 1):
            expected[(name, index)] = section
        total_sections += len(sections)
    exported_sources = collections.Counter()
    actual_examples = actual_covered = actual_standards = actual_duplicates = 0
    codes = {st['code'] for s in subjects for st in s['standards']}

    def check_example(example, code, orphan=False):
        assert example['blocks'] and example['sources'], '빈 예시 또는 출처 없는 예시'
        assert len({(s['file'], s['section']) for s in example['sources']}) == len(example['sources']), '동일 출처 중복'
        for source in example['sources']:
            key = (source['file'], source['section'])
            assert key in expected, '없는 출처 묶음 참조: ' + str(key)
            section = expected[key]
            assert code in section['codes'], '다른 성취기준으로 잘못 연결: ' + str(key)
            assert canonical(example['blocks']) == canonical(section['blocks']), '웹 예시 본문 변경 또는 누락: ' + str(key)
            assert example.get('searchText', '\n'.join(block_text(b) for b in example['blocks'])) == '\n'.join(block_text(b) for b in section['blocks']), '예시 텍스트 불일치: ' + str(key)
            assert source['id'] == info_by_name[source['file']]['id'], '출처 안내 연결 오류: ' + str(key)
            assert bool(source.get('draft')) == bool(info_by_name[source['file']].get('draft')), '출처 초안 표시 오류'
            exported_sources[key] += 1
        assert bool(example.get('draft')) == any(s.get('draft') for s in example['sources']), '예시 초안 표시 오류'
        assert not orphan or code not in codes, '연결 가능한 예시가 미연결 목록에 있습니다.'

    search_index = load(dist / 'data/search.json')
    totals = dict.fromkeys(STATUSES, 0)
    for subject in subjects:
        base = baseline_by_id[subject['id']]
        for field in ('name', 'domain', 'group', 'key', 'level'):
            assert subject[field] == base[field], '과목 정보 변경: ' + field
        assert [(s['code'], s['text'], s['area']) for s in subject['standards']] == [(s['code'], s['text'], s['area']) for s in base['standards']], '기준 원문 또는 코드 변경'
        data = load(dist / 'data/inquiries' / (subject['id'] + '.json'))
        valid_codes = {st['code'] for st in subject['standards']}
        assert len(valid_codes) == len(subject['standards']), '과목 내 코드 중복'
        assert set(data) <= valid_codes, '과목에 속하지 않는 예시 코드'
        subject_covered = 0
        for st in subject['standards']:
            correction = corrections.get(st['code'])
            assert st.get('displayText') == (correction['displayText'] if correction else None), '수식 보정 표시 누락 또는 변경'
            if correction:
                assert st['text'] == correction['originalText'], '수식 보정 기준 원문 불일치'
            examples = data.get(st['code'], [])
            assert len(examples) == st['exampleCount'], '목록과 상세 예시 수 불일치'
            assert st['usableCount'] == sum(1 for e in examples if is_usable(e)), '학생 기본 표시 예시 수 불일치'
            assert st['verifiedCount'] == sum(1 for e in examples if status_of(e) == 'verified'), '교과 검토 완료 수 불일치'
            indexed = search_index.get(subject['id'], {}).get(st['code'], [])
            assert [row[0] for row in indexed] == [e['id'] for e in examples], '내용 검색 색인과 예시 불일치'
            for row, e in zip(indexed, examples):
                text = '\n'.join(block_text(b) for b in e['blocks'])
                assert row[1] == search_text(text), '내용 검색 색인 텍스트 불일치'
                assert row[2] == example_title(e['blocks']) and row[3] == careers_of(text), '주제 카드 제목·연결 진로 불일치'
                assert row[4] == e['status'] == status_of(e), '예시 상태 표시 불일치'
            assert st['sourceCount'] == sum(len(e['sources']) for e in examples), '출처 수 불일치'
            assert len({e['id'] for e in examples}) == len(examples), '중복 예시 식별자'
            subject_covered += bool(examples)
            actual_standards += 1
            actual_examples += len(examples)
            for example in examples:
                check_example(example, st['code'])
                actual_duplicates += len(example['sources']) - 1
                totals[status_of(example)] += 1
                assert 'searchText' not in example, '상세 자료에 중복 검색 텍스트가 남아 있습니다.'
                assert bool(example.get('textReview')) == (norm_text(st['text']) not in norm_text('\n'.join(block_text(b) for b in example['blocks']))), '문장 비교 표시 오류'
        assert subject['covered'] == subject_covered, '과목별 연결 수 불일치'
        actual_covered += subject_covered
    orphans = report.get('orphanExamples', [])
    assert len(orphans) == len(report['unmatched']), '미연결 예시 내용 누락'
    for example, entry in zip(orphans, report['unmatched']):
        assert example['code'] == entry['code'], '미연결 코드 불일치'
        assert (entry['file'], entry['section']) == (example['sources'][0]['file'], example['sources'][0]['section']), '미연결 출처 불일치'
        check_example(example, example['code'], orphan=True)
    assert set(exported_sources) == set(expected), '연결 또는 미연결 목록에서 빠진 묶음이 있습니다.'
    textbooks = load(dist / 'data/textbooks.json')
    assert textbooks == load(project / 'baseline/textbooks.json'), '목차 기준 자료와 불일치'
    for book in textbooks:
        if book.get('image'):
            assert (dist / book['image']).is_file(), '교과서 목차 이미지 누락'
    for name in ('index.html', 'assets/app.css', 'assets/app.js'):
        assert (dist / name).is_file(), '웹 파일 누락: ' + name
        assert (dist / name).read_bytes() == (project / 'public' / name).read_bytes(), '웹 화면 파일이 최신 소스와 다릅니다: ' + name
    class AssetLinks(HTMLParser):
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            value = attrs.get('src') if tag in ('script', 'img') else attrs.get('href') if tag == 'link' else None
            if value and not urlsplit(value).scheme and not urlsplit(value).netloc:
                target = (dist / unquote(urlsplit(value).path)).resolve()
                assert target.is_relative_to(dist.resolve()) and target.is_file(), '웹 자원 링크 누락: ' + value
    AssetLinks().feed((dist / 'index.html').read_text(encoding='utf-8'))
    s = catalog['summary']
    assert s == report['summary'] and catalog['generatedAt'] == report['generatedAt'], '보고서와 목록 버전 불일치'
    assert s['standards'] == actual_standards and s['subjects'] == len(subjects)
    assert s['coveredStandards'] == actual_covered and s['examples'] == actual_examples
    assert s['documents'] == len(all_paths) and s['sections'] == total_sections
    assert s['unmatched'] == len(orphans) and s['textDifferences'] == len(report['textDifferences'])
    assert s['exactDuplicatesMerged'] == actual_duplicates, '중복 병합 수 불일치'
    assert s.get('displayCorrectionCount', 0) == len(corrections), '수식 보정 개수 불일치'
    assert (s['verifiedExamples'], s['generalExamples'], s['draftExamples'], s['reviewExamples']) == tuple(totals[k] for k in STATUSES), '상태 집계 불일치'
    assert s['usableExamples'] == totals['verified'] + totals['general'] and s['excludedDocuments'] == len(excluded)
    assert 'reviewedExamples' not in s, "근거 없는 '검수 완료' 집계가 남아 있습니다."
    assert load(dist / 'data/school.json') == (load(project / 'baseline/school-subjects.json') if (project / 'baseline/school-subjects.json').exists() else {}), '학교 개설 과목 자료 불일치'
    names = {sub['name'] for sub in subjects}
    for grade in load(dist / 'data/school.json').get('grades', {}).values():
        missing = [n for n in grade.get('subjects', []) if n not in names]
        assert not missing, '학교 개설 과목 이름이 탐색기 과목과 다릅니다: ' + ', '.join(missing)
    if not quiet:
        print(f'PASS: {len(all_paths)}개 원문 및 실제 웹 본문·출처·기준 자료 대조, {actual_standards}개 성취기준, {actual_examples}개 예시, {len(textbooks)}개 목차 항목')
