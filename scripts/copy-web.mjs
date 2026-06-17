// Stage the static web app (which lives at the repo root so Cloudflare Pages can
// serve it directly) into www/, the folder Capacitor copies into the native app.
// Keeping the source at the root means the PWA and the Android app ship from one
// codebase — app.js is the single source of truth for all tracking logic.
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

// Files/dirs that make up the web app. Anything not listed (node_modules,
// android/, wrangler config, git, docs) is deliberately excluded.
const ASSETS = ['index.html', 'app.js', 'style.css', 'manifest.json', 'sw.js', 'icons'];

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
for (const name of ASSETS) {
  await cp(join(root, name), join(www, name), { recursive: true });
}
console.log('copied', ASSETS.length, 'web assets ->', www);
