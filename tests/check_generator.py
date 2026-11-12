"""Run browser checks against the current index.html using local Microsoft Edge."""
from pathlib import Path
import html
import json
import os
import re
import subprocess
import tempfile


def main():
    root = Path(__file__).resolve().parents[1]
    edge = Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe'
    source = (root / 'index.html').read_text(encoding='utf-8')
    source = re.sub(r'<script src="[^"]*xlsx[^>]*></script>', '', source)
    checks = (root / 'tests/generator.js').read_text(encoding='utf-8')
    with tempfile.TemporaryDirectory(prefix='schuzky-checks-') as directory:
        folder = Path(directory)
        page = folder / 'checks.html'
        page.write_text(source.replace('</body>', '<script>' + checks + '</script></body>'), encoding='utf-8')
        run = subprocess.run([str(edge), '--headless', '--disable-gpu', '--disable-extensions', '--no-first-run',
                              '--user-data-dir=' + str(folder / 'profile'), '--virtual-time-budget=120000',
                              '--dump-dom', page.as_uri()], capture_output=True, timeout=150)
        output = run.stdout.decode('utf-8', errors='replace')
        match = re.search(r'<pre id="test-result">(.*?)</pre>', output, re.S)
        if not match:
            raise SystemExit('No browser test results: ' + run.stderr.decode('utf-8', errors='replace')[-1500:])
        result = json.loads(html.unescape(match.group(1)))
        print(json.dumps(result, ensure_ascii=True, indent=2))
        if not result['ok']:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
