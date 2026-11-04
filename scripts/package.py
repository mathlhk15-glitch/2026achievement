"""Create the GitHub source ZIP, excluding generated output and local processes."""
from pathlib import Path
import argparse, zipfile

ROOT = Path(__file__).resolve().parents[1]

def package(output=None):
    output = Path(output) if output else ROOT.parent / (ROOT.name + '-GitHub.zip')
    temporary = output.with_suffix(output.suffix + '.tmp')
    with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(ROOT.rglob('*')):
            relative = path.relative_to(ROOT)
            if not path.is_file() or any(p in ('dist', '__pycache__', '.git') or p.startswith('.build-') for p in relative.parts):
                continue
            if path.name.startswith('.preview.') or path.name == 'failed-import.json':
                continue
            archive.write(path, Path(ROOT.name) / relative)
    with zipfile.ZipFile(temporary) as archive:
        assert archive.testzip() is None, 'ZIP 무결성 오류'
        for required in ('public/index.html', 'baseline/subjects.json', 'baseline/textbooks.json', 'baseline/display-overrides.json', 'scripts/build.py', 'scripts/validate.py', '.github/workflows/pages.yml'):
            assert ROOT.name + '/' + required in archive.namelist(), '업로드 필수 파일 누락: ' + required
    temporary.replace(output)
    print(f'ZIP PASS: {output.name}, {output.stat().st_size / 1024 / 1024:.1f} MB')
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output')
    package(parser.parse_args().output)
