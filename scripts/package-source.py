"""Package maintained source and current builds; never execute unit tests."""
from pathlib import Path
import json, subprocess, zipfile

root = Path(__file__).resolve().parent.parent
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
subprocess.run(['node', str(root / 'scripts/build-standalone.mjs')], cwd=root, check=True)
source = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root).decode('utf-8').split('\0')
files = {root / name for name in source if name and (root / name).is_file()}
for output in ['dist', 'docs/.vitepress/dist']:
    files.update(path for path in (root / output).rglob('*') if path.is_file())
archive = root.parent / f"{package['name']}-v{package['version']}-source-and-build.zip"
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for path in sorted(files):
        bundle.write(path, Path(package['name']) / path.relative_to(root))
print(json.dumps({'archive': str(archive), 'files': len(files), 'unitTests': 'not executed; use explicit manual validation'}, indent=2))
