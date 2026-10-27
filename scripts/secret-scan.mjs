import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const excluded = new Set(['node_modules', '.git', '.gradle', 'data', '.local-data', '.e2e-data', 'build', 'dist', 'dist-local', 'dist-preview', 'test-results', 'playwright-report', 'private']);
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/, /\bAIza[A-Za-z0-9_-]{30,}\b/];
const findings = [];
let scanned = 0;
function scan(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(item.name)) continue;
    const file = join(dir, item.name);
    if (item.isDirectory()) { scan(file); continue; }
    if (item.name === '.env' || /\.(db|sqlite|pem|key|keystore|jks)$/.test(item.name)) { findings.push(`${file}: forbidden public file`); continue; }
    if (!/\.(md|json|ts|tsx|js|mjs|css|html|svg|yaml|yml|py|example|log|java|xml|gradle|properties|txt|sh|bat)$/.test(item.name)) continue;
    const content = readFileSync(file, 'utf8'); scanned++;
    if (patterns.some(p => p.test(content))) findings.push(`${file}: credential-like string`);
  }
}
scan('.');
console.log(JSON.stringify({ scanned, findings, note: 'Pattern scan supplements review; it does not prove absence of all secrets.' }, null, 2));
process.exit(findings.length ? 1 : 0);
