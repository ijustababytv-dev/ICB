"""Retain checksum-pinned administrative SQL releases independently of the Lambda ZIP."""
from pathlib import Path
import hashlib
import json
import zipfile
import re

root = Path(__file__).resolve().parents[2]
database = root / 'database'
destination = root / 'dist' / 'database-upgrades'
destination.mkdir(parents=True, exist_ok=True)
for manifest_file in sorted((database / 'upgrades').glob('*.json')):
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    version = manifest['version']
    if not re.fullmatch(r'[0-9]{3}[-a-z0-9]*\.sql', version) or manifest_file.stem != version[:-4]:
        raise RuntimeError('Invalid administrative bundle version.')
    output = destination / version
    for item in manifest['objects']:
        if not re.fullmatch(r'(?:tables|indexes|views|functions)/[a-z0-9_-]+\.sql', item['file']):
            raise RuntimeError('Invalid administrative source path.')
        source = database / item['file']
        target = output / item['file']
        content = source.read_bytes()
        if hashlib.sha256(content).hexdigest() != item['sha256']:
            if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
                raise RuntimeError('Restore the original administrative bundle for ' + version)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    with zipfile.ZipFile(destination / (version + '.zip'), 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(manifest_file, 'upgrade.json')
        for item in manifest['objects']:
            archive.write(output / item['file'], item['file'])
print('Pinned administrative database upgrade bundles are ready.')
