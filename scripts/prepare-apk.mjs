// Copy the freshly built APK into www/downloads/ and write a metadata.json the
// landing page reads (version + size). Runs after build:web, so www/ exists.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apk = resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk');

if (!existsSync(apk)) {
  console.error('Missing APK:', apk, '\nRun the Android build first (gradlew assembleDebug).');
  process.exit(1);
}

let version = 'dev';
try {
  version = execSync('git describe --tags --always --dirty', { cwd: root }).toString().trim() || 'dev';
} catch { /* not a git checkout — keep "dev" */ }

const filename = `spatial-tracking-${version}.apk`;
const bytes = statSync(apk).size;
const downloads = resolve(root, 'www/downloads');
mkdirSync(downloads, { recursive: true });

// Versioned name (for clarity) + a stable alias so the README URL never changes.
copyFileSync(apk, resolve(downloads, filename));
copyFileSync(apk, resolve(downloads, 'spatial-tracking.apk'));

const metadata = {
  version,
  variant: 'debug',
  filename,
  bytes,
  updatedAt: new Date().toISOString(),
};
writeFileSync(resolve(downloads, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');

console.log(`Bundled ${filename} (${(bytes / 1048576).toFixed(1)} MB) into www/downloads/`);
