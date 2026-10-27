import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const records = [];
const sections = [];
function visit(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = join(dir, entry.name);
    if (entry.name.startsWith('@')) { visit(folder); continue; }
    const file = join(folder, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'UNDECLARED');
    records.push({ name: pkg.name, version: pkg.version, license, path: relative('node_modules', folder).replaceAll('\\', '/') });
    const licenseFiles = readdirSync(folder).filter(n => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n));
    for (const name of licenseFiles) {
      try { sections.push(`\n\n## ${pkg.name}@${pkg.version} — ${name}\n\n${readFileSync(join(folder, name), 'utf8')}`); } catch { /* license directories are skipped */ }
    }
    visit(join(folder, 'node_modules'));
  }
}
visit('node_modules');
records.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync('docs', { recursive: true });
writeFileSync('docs/DEPENDENCIES.json', JSON.stringify(records, null, 2) + '\n');
writeFileSync('THIRD_PARTY_NOTICES.md', '# Third-party notices\n\nGenerated from installed, lockfile-pinned packages. Includes build/test tools; platform-specific optional packages differ by OS. React and React DOM are the only bundled application dependencies. No code from AFFiNE, AppFlowy, Tiptap, Yjs, or Excalidraw is included.\n' + sections.join(''));
console.log(`Recorded ${records.length} installed packages and ${sections.length} license/notice files.`);
