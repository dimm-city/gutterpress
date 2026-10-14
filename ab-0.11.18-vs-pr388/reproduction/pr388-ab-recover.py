from pathlib import Path
import hashlib, json, subprocess, datetime

root=Path('/home/founder3/code/dimm-city/dc-op-manual/.worktrees/pdfx-field-guide-stress/.print-md/build/pdfx-ab-0.11.18-vs-42091ecc')
def digest(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
for case in ['combined','boundary']:
    d=root/case;out=d/'v0.11.18';source=Path((d/'source-path.txt').read_text().strip());css=d/'styles.css';pdf=out/'book.pdf'
    assert not (out/'export.json').exists()
    info=subprocess.check_output(['pdfinfo',str(pdf)],text=True)
    assert 'Pages:           228' in info
    recovery={'reason':'Export supervisor exited with signal 15 while the Ghostscript child continued writing. Ghostscript subsequently finished; the final PDF was recovered and independently checked. This is not a confirmed successful CLI run.',
              'supervisorExitCode':143,'ghostscriptExitCode':None,'times':None,
              'qpdfCheck':{'command':['qpdf','--check',str(pdf)],'exitCode':0,'stdout':'No syntax or stream encoding errors found; the file may still contain errors that qpdf cannot detect','observedInExecSession':21124 if case=='combined' else 42047},
              'pdfinfo':info,'pdfChangingStepsAfterGhostscript':[],'pendingIndependentAudit':str(Path('/tmp/pr388-ab-validation')/case),
              'recoveredAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (out/'recovery.json').write_text(json.dumps(recovery,indent=2)+'\n')
    metadata={'version':'v0.11.18','commit':'dfc3645781d5917eb16894d58a691ccd1d87745c','source':str(source),'sourceSha256':digest(source),'sourceBytes':source.stat().st_size,'css':str(css),'cssSha256':digest(css),'output':str(pdf),'outputBytes':pdf.stat().st_size,'outputSha256':digest(pdf),'times':{'total':None},'completion':'recovered completed artifact; see recovery.json for unobserved exit/timing'}
    (out/'export.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(case,metadata['outputBytes'],metadata['outputSha256'],flush=True)
