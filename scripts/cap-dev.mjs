// Dev-mode sync: point the native app at a LIVE URL (Capacitor server.url) so
// app.js changes arrive over the air — no APK reinstall per change. The
// committed capacitor.config.json stays in "bundled" mode (proper standalone
// release / site download); this script injects server.url transiently, runs
// cap sync (which bakes it into the native project), then restores the file so
// git stays clean.
//
//   CAP_SERVER_URL=https://spatial-tracking.lue-app.com   (default — production)
//   CAP_SERVER_URL=https://develop.spatial-tracking.lue-app.com   (a dev page)
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = resolve(root, 'capacitor.config.json');
const url = (process.env.CAP_SERVER_URL || 'https://spatial-tracking.lue-app.com').replace(/\/+$/, '');

const original = readFileSync(cfgPath, 'utf8');
const cfg = JSON.parse(original);
cfg.server = { ...(cfg.server || {}), url, cleartext: url.startsWith('http://') };
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

console.log('Dev mode — native app will load remote URL:', url);
try {
  execSync('npx cap sync android', { cwd: root, stdio: 'inherit' });
} finally {
  writeFileSync(cfgPath, original); // restore the committed bundled config
  console.log('Restored capacitor.config.json (bundled mode) for git.');
}
