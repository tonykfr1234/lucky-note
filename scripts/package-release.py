"""Create a source release by explicit allowlist. Never include runtime data or credentials."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
output = root.parent / 'LuckyNote-0.1.0-source.zip'
top = {'README.md', 'LICENSE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile', 'compose.yaml', 'compose.local.yaml', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'playwright.config.ts', 'eslint.config.js', 'index.html', 'WORKLOG.md', 'CONTRACT.md'}
folders = {'src', 'server', 'tests', 'e2e', 'public', 'docs', 'scripts', '.github'}
files = [p for p in root.rglob('*') if p.is_file() and (p.relative_to(root).parts[0] in folders or p.relative_to(root).as_posix() in top)]
files += [p for p in (root / 'artifacts').glob('*') if p.is_file() and p.suffix in {'.log', '.json', '.png', '.md'}]
files = sorted(set(files))
for path in files:
    rel = path.relative_to(root)
    if path.is_symlink() or path.suffix in {'.db', '.sqlite', '.pem', '.key'} or (path.name.startswith('.env') and path.name != '.env.example') or any(part in {'node_modules', 'private', 'data', 'backups', 'restored-data'} for part in rel.parts):
        raise SystemExit(f'Forbidden release path: {rel}')
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in files:
        bundle.write(path, f'lucky-note/{path.relative_to(root).as_posix()}')
digest = hashlib.sha256(output.read_bytes()).hexdigest()
manifest = {'archive': output.name, 'sha256': digest, 'files': len(files), 'bytes': output.stat().st_size}
output.with_suffix('.sha256').write_text(f'{digest}  {output.name}\n', encoding='utf-8')
print(json.dumps(manifest, ensure_ascii=False, indent=2))
