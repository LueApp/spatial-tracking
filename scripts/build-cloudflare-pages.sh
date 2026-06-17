#!/bin/bash
# Cloudflare build entry point. Builds the Android APK and stages the web app
# into www/ with the APK bundled at www/downloads/, so the deployed site serves
# both the PWA and an APK download link. Mirrors the music_hub pattern.
#
# Cloudflare project settings:
#   Build command:        npm run build
#   Build output / assets: www   (matches wrangler.jsonc "assets.directory")
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Cloudflare clones shallow; deepen so `git describe` can name the build.
git fetch --unshallow --tags 2>/dev/null || git fetch --tags 2>/dev/null || true

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

JDK_HOME="${JDK_HOME:-$HOME/.local/share/temurin-17}"
JDK_URL="${JDK_URL:-https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk}"

download_file() {
  if command -v curl >/dev/null 2>&1; then curl -fL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else echo "need curl or wget" >&2; exit 1; fi
}

java_major() {
  command -v java >/dev/null 2>&1 || { echo 0; return; }
  java -version 2>&1 | awk -F '"' '/version/ { split($2, p, "."); print p[1]; exit }'
}

ensure_jdk() {
  if [ "$(java_major)" -ge 17 ] 2>/dev/null; then
    echo "Using existing JDK:"; java -version; return
  fi
  if [ ! -x "$JDK_HOME/bin/java" ]; then
    echo "Installing JDK 17 → $JDK_HOME"
    mkdir -p "$JDK_HOME"
    download_file "$JDK_URL" /tmp/temurin-17.tar.gz
    tar -xzf /tmp/temurin-17.tar.gz -C "$JDK_HOME" --strip-components=1
    rm -f /tmp/temurin-17.tar.gz
  fi
  export JAVA_HOME="$JDK_HOME"
  export PATH="$JAVA_HOME/bin:$PATH"
  echo "Using downloaded JDK:"; java -version
}

ensure_jdk
bash scripts/setup-android-sdk.sh

echo "Installing Node dependencies..."
npm ci 2>/dev/null || npm install

echo "Staging web assets and syncing Capacitor..."
npm run build:web
npx cap sync android

echo "Building Android debug APK..."
( cd android && chmod +x gradlew && ./gradlew :app:assembleDebug --no-daemon )

echo "Bundling APK into www/downloads/..."
node scripts/prepare-apk.mjs

echo "Build complete. Serve www/."
