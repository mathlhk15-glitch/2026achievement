"""Serve one explorer directory and identify it without relying on its HTML."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import argparse, hashlib, json, os, subprocess, sys

IDENTITY_PATH = '/__explorer_instance__'

def instance_id(directory):
    return hashlib.sha256(os.path.normcase(str(Path(directory).resolve())).encode('utf-8')).hexdigest()

class ExplorerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, quiet=False, **kwargs):
        self.quiet = quiet
        super().__init__(*args, **kwargs)

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)

    def do_GET(self):
        if urlsplit(self.path).path != IDENTITY_PATH:
            return super().do_GET()
        body = json.dumps({'instanceId': self.server.instance_id, 'pid': os.getpid()}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def create_server(directory, port=8870, quiet=False):
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise ValueError('탐색기 폴더가 없습니다: ' + str(directory))
    handler = partial(ExplorerHandler, directory=str(directory), quiet=quiet)
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    server.instance_id = instance_id(directory)
    return server

def spawn_server(directory, port, log_dir):
    directory, log_dir = Path(directory).resolve(), Path(log_dir).resolve()
    # Close inherited command pipes so a hidden server cannot keep the launcher open.
    with (log_dir / '.preview.stdout.log').open('ab') as output, (log_dir / '.preview.stderr.log').open('ab') as errors:
        process = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), '--directory', str(directory), '--port', str(port)],
            cwd=directory.parent, stdin=subprocess.DEVNULL, stdout=output, stderr=errors,
            close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            start_new_session=os.name != 'nt')
    return process.pid

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='.')
    parser.add_argument('--port', type=int, default=8870)
    parser.add_argument('--identity', action='store_true')
    parser.add_argument('--background', action='store_true')
    parser.add_argument('--log-dir', default='.')
    args = parser.parse_args()
    if args.identity:
        print(instance_id(args.directory))
    elif args.background:
        print(spawn_server(args.directory, args.port, args.log_dir))
    else:
        with create_server(args.directory, args.port) as server:
            print(f'http://127.0.0.1:{server.server_port}/', flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
