"""Create a Linux-compatible Lambda ZIP from an explicit runtime allowlist."""
from pathlib import Path
import base64
import hashlib
import json
import stat
import zipfile

root = Path(__file__).resolve().parents[2]
cloud = root / 'cloud-server'
output = root / 'dist' / 'baby-icb-cloud-server.zip'
output.parent.mkdir(parents=True, exist_ok=True)
files = []
for directory in ('src', 'node_modules'):
    source = cloud / directory
    if not source.is_dir():
        raise RuntimeError('Run npm ci --prefix cloud-server before packaging.')
    for file in source.rglob('*'):
        if not file.is_file() or '.bin' in file.parts:
            continue
        if file.is_symlink() or not file.resolve().is_relative_to(cloud):
            raise RuntimeError('Runtime package must not include external links.')
        files.append((file, file.relative_to(cloud).as_posix()))
for name in ('package.json', 'package-lock.json', 'run.sh'):
    files.append((cloud / name, name))
files.append((root / 'database/state-manifest.json', 'database/state-manifest.json'))
files.append((root / 'database/feature-catalog.json', 'database/feature-catalog.json'))
for source in (root / 'local-server/config').glob('*.json'):
    files.append((source, 'config/' + source.name))
files.append((root / 'database/certs/global-bundle.pem', 'certs/global-bundle.pem'))
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for source, name in sorted(files, key=lambda item: item[1]):
        if any(part.startswith('.env') or part in ('data', 'backups', 'terraform') for part in Path(name).parts):
            raise RuntimeError('Private runtime file rejected.')
        content = source.read_bytes()
        if name == 'run.sh' and b'\r' in content:
            raise RuntimeError('run.sh requires LF line endings.')
        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = ((stat.S_IFREG | (0o755 if name == 'run.sh' else 0o644)) << 16)
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, content)
digest = hashlib.sha256(output.read_bytes()).digest()
print(json.dumps({'file': str(output), 'bytes': output.stat().st_size,
                  'sha256': base64.b64encode(digest).decode(), 'files': len(files)}))
