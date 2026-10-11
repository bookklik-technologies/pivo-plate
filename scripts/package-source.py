from pathlib import Path
import json, shutil, zipfile
root=Path(__file__).resolve().parent.parent
for name in ('browser-report.json','stress-report.json','layout-report.json','safety-report.json','modeling-report.json','png-report.json','erase-hud-report.json','theme-report.json','font-report.json'):
    source=root/'test-results'/name
    if source.exists(): shutil.copyfile(source,root/'docs'/name)
out=root.parent/'pivo-plate-v0.1-source.zip'
skip_dirs={'node_modules','.git','test-results','coverage','playwright-report','audit-review'}
skip_files={'integrate-fixes.py','harden-integration.py','migrate-lucide.py','refine-desktop.py','stabilize-store.py','stabilize-ui.py','protect-recovery-io.py','finish-recovery.py','fix-modeling.py','png-preflight.py','integrate-png.py','png-finalize.py','erase-hud.py','light-theme.py','refine-type.py','browser-initial.json','browser-initial.png'}
files=[]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for path in sorted(root.rglob('*')):
        if not path.is_file(): continue
        relative=path.relative_to(root)
        if any(part in skip_dirs for part in relative.parts) or path.name in skip_files or path.suffix=='.log': continue
        archive.write(path,Path('pivo-plate')/relative)
        files.append(str(relative))
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    required=['src/main.ts','src/core/editor.ts','src/io/project.ts','docs/VALIDATION.md','dist/pivo-plate-standalone.html','package-lock.json','tests/browser-e2e.mjs']
    for item in required: assert 'pivo-plate/'+item in archive.namelist(), item
print(json.dumps({'path':str(out),'files':len(files),'bytes':out.stat().st_size,'zipIntegrity':'passed'},indent=2))
