"""Write a CSV checklist of examples whose standard text differs from the explorer baseline.
Run after build.py:  python scripts/review_list.py
"""
from pathlib import Path
import csv, difflib, json, re, sys
from build import ROOT, read_document, block_text, norm_text, CODE

def main():
    report = json.loads((ROOT / 'reports/import-report.json').read_text(encoding='utf-8'))
    subjects = json.loads((ROOT / 'baseline/subjects.json').read_text(encoding='utf-8'))
    baseline = {(s['name'], st['code']): st['text'] for s in subjects for st in s['standards']}
    source = ROOT / 'source-docs'
    cache, rows = {}, []
    for d in report['textDifferences']:
        if d['file'] not in cache:
            cache[d['file']] = read_document(source / d['file'])[1]
        section = cache[d['file']][d['section'] - 1]
        text = '\n'.join(block_text(b) for b in section['blocks'][:3])
        m = CODE.search(text)
        doc_line = re.sub(r'\s+', ' ', text[m.end():] if m else text).strip()[:200]
        if doc_line.startswith('성취기준') or len(doc_line) < 10:
            doc_line = re.sub(r'\s+', ' ', text).strip()[:200]
        base = baseline.get((d['subject'], d['code']), '')
        ratio = difflib.SequenceMatcher(None, norm_text(base), norm_text(doc_line)[:len(norm_text(base)) + 20]).ratio()
        verdict = '표현·수식 차이로 추정' if ratio >= 0.75 else ('부분 일치 · 확인 필요' if ratio >= 0.45 else '내용 불일치 의심 · 우선 확인')
        rows.append([d['subject'], d['code'], verdict, f'{ratio:.2f}', base, doc_line, d['file'], d['section'], '', ''])
    for u in report['unmatched']:
        rows.append(['(탐색기에 없음)', u['code'], '미연결 코드 · 우선 확인', '', '', '탐색기에 없는 코드입니다. 표기(예: 1↔Ⅰ)와 원문을 확인하세요.', u['file'], u['section'], '', ''])
    order = {'내용 불일치 의심 · 우선 확인': 0, '미연결 코드 · 우선 확인': 0, '부분 일치 · 확인 필요': 1, '표현·수식 차이로 추정': 2}
    rows.sort(key=lambda r: (order[r[2]], r[6], r[7]))
    out = ROOT / 'reports/문장차이_검토목록.csv'
    with out.open('w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['과목', '코드', '자동 판정(참고용)', '유사도', '탐색기 성취기준 원문', '문서에 적힌 성취기준(앞부분)', '출처 파일', '묶음 번호', '교사 확인 결과(적합/수정 필요/제외)', '확인자·날짜'])
        w.writerows(rows)
    counts = {k: sum(1 for r in rows if r[2] == k) for k in order}
    print(out.relative_to(ROOT), counts)

if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()
