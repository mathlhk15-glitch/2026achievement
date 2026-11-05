"""Integration checks for future additions, duplicate sources and failed imports."""
import argparse, contextlib, io, json, tempfile, zipfile
from pathlib import Path
import build as importer

def document(path, style='Normal', extra='', numbering=False):
    prefix = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if numbering else ''
    xml = f'''<w:document xmlns:w="{importer.NS['w']}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>[10공수1-01-01] 다항식</w:t></w:r></w:p>
      <w:p><w:r><w:t>기준 원문</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>단계</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>기본</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>심화</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>① 왜?</w:t></w:r></w:p></w:tc><w:tc><w:p><w:pPr>{prefix}</w:pPr><w:r><w:t>첫 질문</w:t></w:r></w:p><w:p><w:pPr>{prefix}</w:pPr><w:r><w:t>두 번째 질문</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>심화 활동</w:t></w:r></w:p></w:tc></w:tr></w:tbl>{extra}</w:body></w:document>'''
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('word/document.xml', xml)
        if numbering:
            z.writestr('word/numbering.xml', f'''<w:numbering xmlns:w="{importer.NS['w']}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>''')

def run():
    real_root = importer.ROOT
    with tempfile.TemporaryDirectory(prefix='inquiry-check-') as folder:
        root = Path(folder)
        importer.ROOT = root
        try:
            (root / 'public').mkdir()
            (root / 'public/assets').mkdir()
            for asset in ('index.html', 'assets/app.css', 'assets/app.js'):
                (root / 'public' / asset).write_text('fixture', encoding='utf-8')
            (root / 'source-docs').mkdir()
            importer.write_json(root / 'baseline/subjects.json', [{'id':'test','name':'공통수학1','domain':'수학','group':'공통','key':'공통수학1','level':'','standards':[{'code':'10공수1-01-01','text':'기준 원문','area':'다항식'}]}])
            importer.write_json(root / 'baseline/textbooks.json', [])
            args = argparse.Namespace(baseline=None, source_dir=str(root / 'source-docs'))
            document(root / 'source-docs/a.docx', style='Heading1', numbering=True)
            with contextlib.redirect_stdout(io.StringIO()):
                importer.build(args)
            inquiry = json.loads((root / 'dist/data/inquiries/test.json').read_text(encoding='utf-8'))
            lines = inquiry['10공수1-01-01'][0]['blocks'][2]['rows'][1][1]['paragraphs']
            assert [p['prefix'] for p in lines] == ['1.', '2.'], 'Word 자동 번호가 보존되어야 합니다.'
            document(root / 'source-docs/b.docx', style='Normal', numbering=True)
            with contextlib.redirect_stdout(io.StringIO()):
                importer.build(args)
            catalog = json.loads((root / 'dist/data/catalog.json').read_text(encoding='utf-8'))
            st = catalog['subjects'][0]['standards'][0]
            assert st['exampleCount'] == 1 and st['sourceCount'] == 2, '중복 내용은 묶고 두 출처를 유지해야 합니다.'
            unknown = '<w:p><w:r><w:t>[12미등록01-01] 미연결</w:t></w:r></w:p><w:p><w:r><w:t>남겨야 하는 탐구 예시</w:t></w:r></w:p>'
            document(root / 'source-docs/c.docx', extra=unknown)
            with contextlib.redirect_stdout(io.StringIO()):
                importer.build(args)
            report = json.loads((root / 'dist/data/report.json').read_text(encoding='utf-8'))
            assert len(report['orphanExamples']) == 1 and '남겨야' in report['orphanExamples'][0]['searchText'], '미연결 예시도 남아야 합니다.'
            nested = root / 'source-docs/추가 탐구'
            nested.mkdir()
            document(nested / 'a.docx', numbering=True)
            with contextlib.redirect_stdout(io.StringIO()):
                importer.build(args)
            inquiry = json.loads((root / 'dist/data/inquiries/test.json').read_text(encoding='utf-8'))
            numbered = next(e for e in inquiry['10공수1-01-01'] if e['blocks'][2]['rows'][1][1]['paragraphs'][0]['prefix'])
            assert any(s['file'] == '추가 탐구/a.docx' for s in numbered['sources']), '같은 이름의 하위 폴더 문서도 별도 출처로 남아야 합니다.'
            with zipfile.ZipFile(nested / 'draft.docx', 'w') as z:
                z.writestr('word/document.xml', f'<w:document xmlns:w="{importer.NS["w"]}"><w:body><w:p><w:r><w:t>1차 설계 초안 · 교과교사 검토 후 확정</w:t></w:r></w:p><w:p><w:r><w:t>[10공수1-01-01] 기준 원문</w:t></w:r></w:p><w:p><w:r><w:t>초안 예시</w:t></w:r></w:p></w:body></w:document>')
            with contextlib.redirect_stdout(io.StringIO()):
                importer.build(args)
            inquiry = json.loads((root / 'dist/data/inquiries/test.json').read_text(encoding='utf-8'))
            assert any(e['draft'] for e in inquiry['10공수1-01-01']), '초안 표시가 보존되어야 합니다.'
            reference = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>다른 성취기준 참고 [10공수1-01-02]</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
            document(nested / 'reference.docx', extra=reference)
            assert len(importer.read_document(nested / 'reference.docx')[1]) == 1, '표 안의 참고 코드를 새 예시로 분리하면 안 됩니다.'
            backslash = nested / 'windows-tool.docx'
            with zipfile.ZipFile(backslash, 'w') as z:
                z.writestr('word\\document.xml', f'<w:document xmlns:w="{importer.NS["w"]}"><w:body><w:p><w:r><w:t>[10공수1-01-01] 기준 원문</w:t></w:r></w:p><w:p><w:r><w:t>역슬래시 경로 예시</w:t></w:r></w:p></w:body></w:document>')
            assert len(importer.read_document(backslash)[1]) == 1, 'Windows 도구가 만든 역슬래시 경로 문서도 모든 운영체제에서 읽어야 합니다.'
            document(nested / 'UPPERCASE.DOCX', numbering=True)
            with contextlib.redirect_stdout(io.StringIO()):
                importer.build(args)
            exported = root / 'dist/data/inquiries/test.json'
            original_export = exported.read_bytes()
            tampered = json.loads(original_export)
            tampered['10공수1-01-01'][0]['blocks'][0]['text'] = '웹 본문 변조'
            importer.write_json(exported, tampered)
            from validate import validate
            try:
                validate(output_dir=root / 'dist', source_dir=root / 'source-docs', project_root=root, quiet=True)
            except AssertionError:
                pass
            else:
                raise AssertionError('실제 웹 본문 변경을 검출해야 합니다.')
            exported.write_bytes(original_export)
            assert any(s['file'].endswith('UPPERCASE.DOCX') for e in json.loads(original_export)['10공수1-01-01'] for s in e['sources']), '대문자 확장자도 읽어야 합니다.'
            before = (root / 'dist/data/catalog.json').read_bytes()
            unsupported = nested / 'unsupported.docx'
            with zipfile.ZipFile(unsupported, 'w') as z:
                z.writestr('word/document.xml', f'<w:document xmlns:w="{importer.NS["w"]}"><w:body><w:sdt><w:sdtContent><w:p><w:r><w:t>미지원 본문 구조</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>')
            try:
                importer.build(args)
            except SystemExit:
                pass
            else:
                raise AssertionError('원문 누락을 검출하면 갱신을 중지해야 합니다.')
            assert (root / 'dist/data/catalog.json').read_bytes() == before, '원문 검증 실패 시 기존 결과가 유지되어야 합니다.'
            unsupported.unlink()
            (root / 'source-docs/unfinished.docx').write_bytes(b'not a complete docx yet')
            try:
                importer.build(args)
            except SystemExit:
                pass
            else:
                raise AssertionError('미완성 문서는 갱신을 중지해야 합니다.')
            assert (root / 'dist/data/catalog.json').read_bytes() == before, '실패 시 기존 결과가 유지되어야 합니다.'
        finally:
            importer.ROOT = real_root
    print('PASS: 추가·중복·하위 폴더·대문자 확장자·역슬래시 경로·참고 코드·자동 번호·초안·웹 본문 변조 검출·검증 실패 시 기존 결과 유지')

if __name__ == '__main__':
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    run()
