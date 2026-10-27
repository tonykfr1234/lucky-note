"""Create a source release by explicit allowlist. Never include runtime data or credentials."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
output = root.parent / f'LuckyNote-{version}-source.zip'
top = {'README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md', 'CONTRIBUTING.md', 'SHA256SUMS.txt', 'LICENSE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile', 'compose.yaml', 'compose.local.yaml', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'playwright.config.ts', 'playwright.local.config.ts', 'eslint.config.js', 'index.html', 'WORKLOG.md', 'CONTRACT.md'}
folders = {'src', 'shared', 'server', 'tests', 'e2e', 'e2e-local', 'public', 'docs', 'scripts', '.github', 'android'}
excluded = {'node_modules', '.git', '.gradle', 'build', 'private', 'data', 'backups', 'restored-data'}
files = [p for p in root.rglob('*') if p.is_file() and not any(part in excluded for part in p.relative_to(root).parts) and p.name != 'local.properties' and (p.relative_to(root).parts[0] in folders or p.relative_to(root).as_posix() in top)]
files += [p for p in (root / 'artifacts').glob('*') if p.is_file() and p.suffix in {'.log', '.json', '.png', '.md'}]
files = sorted(set(files))
for path in files:
    rel = path.relative_to(root)
    if path.is_symlink() or path.suffix in {'.db', '.sqlite', '.pem', '.key', '.jks', '.keystore', '.apk'} or (path.name.startswith('.env') and path.name != '.env.example') or any(part in excluded for part in rel.parts):
        raise SystemExit(f'Forbidden release path: {rel}')
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in files:
        bundle.write(path, f'lucky-note/{path.relative_to(root).as_posix()}')
digest = hashlib.sha256(output.read_bytes()).hexdigest()
manifest = {'archive': output.name, 'sha256': digest, 'files': len(files), 'bytes': output.stat().st_size}
output.with_suffix('.sha256').write_text(f'{digest}  {output.name}\n', encoding='utf-8')
print(json.dumps(manifest, ensure_ascii=False, indent=2))
