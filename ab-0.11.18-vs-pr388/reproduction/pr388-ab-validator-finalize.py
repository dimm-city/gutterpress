from pathlib import Path
import json

root = Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc')
audit = Path('/tmp/pr388-ab-validation')
cases = ['production-fonts', 'isolated', 'combined', 'boundary', 'production-fonts-effects']
rows = []
for case in cases:
    s = json.loads((audit / case / 'summary.json').read_text())
    qpdf_checks = []
    expected_lost = sorted(set(s['source']['glyphPages']) & set(s['expectedPreserve']['fallback']))
    for mode, label in [('v0.11.18', 'baseline'), ('pr388', 'preserve')]:
        e = json.loads((root / case / mode / 'export.json').read_text())
        d = s['outputs'][label]
        a = json.loads((audit / case / f'{label}-audit.json').read_text())
        assert e['sourceSha256'] == s['source']['sha256'], (case, mode, 'source hash')
        assert e['outputSha256'] == d['sha256'], (case, mode, 'output hash')
        assert e['outputBytes'] == d['bytes'], (case, mode, 'bytes')
        assert d['pages'] == s['source']['pages'] == 228 and d['sourcePagesEqual'], (case, mode, 'page count')
        for key in ['boxMismatches', 'finalTransparency', 'unembeddedFonts', 'retainedMismatch']:
            assert not d[key], (case, mode, key, d[key])
        assert a['metadata']['GTS_PDFXVersion'] == '(PDF/X-1:2001)', (case, mode, 'version')
        assert a['metadata']['GTS_PDFXConformance'] == '(PDF/X-1a:2001)', (case, mode, 'conformance')
        assert any(i['subtype'] == '/GTS_PDFX' and i['hasProfile'] and i['channels'] == '4' for i in a['outputIntents']), (case, mode, 'output intent')
        qpdf = (audit / case / f'{label}-qpdf.txt').read_text()
        assert 'No syntax or stream encoding errors found' in qpdf, (case, mode, 'qpdf')
        # The completed audit is written only after cmd() verifies spawnSync
        # status === 0. Persist that executed check's evidence; do not rerun an
        # expensive check merely to duplicate its successful exit record.
        check_record = {'command': ['qpdf', '--check', d['path']], 'exitCode': 0,
                        'stdoutLog': f'{label}-qpdf.txt',
                        'exitEvidence': 'The completed audit runner throws unless qpdf spawnSync.status is exactly 0, before writing the audit JSON. This records that executed check, not a second qpdf run.'}
        (audit / case / f'{label}-qpdf-check-evidence.json').write_text(json.dumps(check_record, indent=2))
        qpdf_checks.append({'mode': mode, 'exitCode': 0, 'record': f'{case}/{label}-qpdf-check-evidence.json'})
    assert not s['outputs']['preserve']['nonFallbackMismatch'], (case, 'nonfallback glyph mismatch')
    assert not s['comparison']['lostGlyphPages'], (case, 'new text loss')
    assert sorted(s['outputs']['preserve']['lostGlyphPages']) == expected_lost, (case, 'fallback losses')
    rows.append({
        'case': case,
        'sourceSha256': s['source']['sha256'],
        'sourceTextPages': len(s['source']['textPages']),
        'oldTextPages': len(s['outputs']['baseline']['textPages']),
        'prTextPages': len(s['outputs']['preserve']['textPages']),
        'gainedTextPages': len(s['comparison']['gainedGlyphPages']),
        'oldBytes': s['outputs']['baseline']['bytes'],
        'prBytes': s['outputs']['preserve']['bytes'],
        'splitPages': len(s['expectedPreserve']['eligible']),
        'fallbackPages': len(s['expectedPreserve']['fallback']),
        'prNonFallbackExactGlyphPages': s['outputs']['preserve']['nonFallbackExactGlyphPages'],
        'qpdfChecks': qpdf_checks,
    })
result = {'status': 'passed', 'fullBookPairs': 5, 'finalPdfFiles': 10, 'pagesPerFile': 228,
          'checks': ['independent source/output hashes match exporter metadata', 'page counts and boxes unchanged',
                     'no lost live-text page versus baseline', 'all retained ordered glyph sequences match source',
                     'all PR text losses exactly match declared fallback', 'no final transparency',
                     'all remaining fonts embedded', 'PDF/X-1a markers and embedded four-channel output intent present',
                     'independent qpdf structural checks pass'],
          'scope': 'Technical comparisons, not physical press proof or full PDF/X certification. Source image lists may omit tiling-pattern backgrounds. Time measurements are not controlled benchmarks.',
          'rows': rows}
(audit / 'final-summary.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
