"""Exercise folder identity and serving without opening a browser."""
from pathlib import Path
from urllib.request import urlopen
import json, tempfile, threading, subprocess, sys, time, os, signal
from serve import create_server, instance_id, IDENTITY_PATH

def run():
    with tempfile.TemporaryDirectory(prefix='explorer-server-') as temporary:
        root = Path(temporary)
        servers, threads, identities = [], [], []
        try:
            for name in ('같은 화면 A', '같은 화면 B'):
                directory = root / name
                directory.mkdir()
                (directory / 'index.html').write_text('same HTML', encoding='utf-8')
                server = create_server(directory, port=0, quiet=True)
                servers.append(server)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                threads.append(thread)
                url = f'http://127.0.0.1:{server.server_port}'
                with urlopen(url + '/', timeout=3) as response:
                    assert response.read() == b'same HTML'
                with urlopen(url + IDENTITY_PATH, timeout=3) as response:
                    identity = json.load(response)['instanceId']
                    assert response.headers['Cache-Control'] == 'no-store'
                assert identity == instance_id(directory)
                assert server.server_address[0] == '127.0.0.1'
                identities.append(identity)
            assert identities[0] != identities[1], 'HTML이 같아도 다른 폴더는 구분해야 합니다.'
            logs = root / '분리 실행 로그'
            logs.mkdir()
            detached = subprocess.run([sys.executable, str(Path(__file__).with_name('serve.py')), '--background', '--directory', str(root / '같은 화면 A'), '--port', '0', '--log-dir', str(logs)], capture_output=True, text=True, timeout=5, check=True)
            process_id = int(detached.stdout.strip())
            try:
                url = ''
                for _ in range(60):
                    output = (logs / '.preview.stdout.log').read_text(encoding='utf-8').strip()
                    if output:
                        url = output.splitlines()[0]
                        break
                    time.sleep(0.05)
                assert url, '분리 실행한 서버의 시작 주소 누락'
                with urlopen(url + IDENTITY_PATH.lstrip('/'), timeout=3) as response:
                    assert json.load(response)['pid'] == process_id
            finally:
                os.kill(process_id, signal.SIGTERM)
        finally:
            for server in servers:
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join(timeout=3)
    print('PASS: 다른 폴더의 동일 화면 구분, 로컬 파일 제공, 실행 식별 정보, 백그라운드 실행 후 명령 종료')

if __name__ == '__main__':
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    run()
