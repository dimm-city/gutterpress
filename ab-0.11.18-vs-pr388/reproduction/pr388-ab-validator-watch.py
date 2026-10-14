from pathlib import Path
import json, subprocess, time

root = Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc')
out = Path('/tmp/pr388-ab-validation')
cases = ['production-fonts', 'isolated', 'combined', 'boundary', 'production-fonts-effects']
done = {}
out.mkdir(exist_ok=True)
deadline = time.monotonic() + 7200
while len(done) < len(cases) and time.monotonic() < deadline:
    for case in cases:
        if case in done:
            continue
        d = root / case
        markers = [d / version / 'export.json' for version in ['v0.11.18', 'pr388']]
        if not all(p.exists() for p in markers):
            continue
        source = (d / 'source-path.txt').read_text().strip() if (d / 'source-path.txt').exists() else str(d / 'source.pdf')
        print(f'Auditing completed pair: {case}', flush=True)
        with (out / f'{case}-run.log').open('w') as log:
            result = subprocess.run(['nice', '-n', '10', 'bun', '/tmp/pr388-ab-validator.ts', case, source,
                                     str(d / 'v0.11.18' / 'book.pdf'), str(d / 'pr388' / 'book.pdf')], stdout=log, stderr=subprocess.STDOUT)
        done[case] = {'exit': result.returncode, 'completed': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        (out / 'status.json').write_text(json.dumps(done, indent=2))
        print(f'{case}: audit exit {result.returncode}', flush=True)
    if len(done) < len(cases):
        time.sleep(10)
print(json.dumps(done, indent=2), flush=True)
raise SystemExit(0 if len(done) == len(cases) and all(v['exit'] == 0 for v in done.values()) else 1)
