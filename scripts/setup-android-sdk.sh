#!/bin/bash
# Install the Android SDK pieces the Capacitor build needs, into $ANDROID_HOME.
# Idempotent: skips anything already present (so it's fast on a warm machine and
# self-provisioning on a clean CI runner). Capacitor 6 targets API 34.
#
# NB: plain `set -e` (no pipefail) on purpose — `yes | sdkmanager` leaves `yes`
# killed by SIGPIPE (141), which pipefail would mis-read as a build failure.
set -eu

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
CMDLINE_TOOLS_VERSION="${CMDLINE_TOOLS_VERSION:-11076708}"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip"

echo "=== Android SDK setup → $ANDROID_HOME ==="

download_file() {
  if command -v curl >/dev/null 2>&1; then curl -fL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else echo "need curl or wget" >&2; exit 1; fi
}

mkdir -p "$ANDROID_HOME/cmdline-tools"
if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
  echo "Downloading Android command-line tools..."
  TMP=/tmp/cmdline-tools.zip
  download_file "$CMDLINE_TOOLS_URL" "$TMP"
  if command -v unzip >/dev/null 2>&1; then unzip -q "$TMP" -d "$ANDROID_HOME/cmdline-tools"
  else python3 -m zipfile -e "$TMP" "$ANDROID_HOME/cmdline-tools"; fi
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -f "$TMP"
fi

export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

yes | sdkmanager --licenses >/dev/null 2>&1 || true
echo "Ensuring platform-tools, platforms;android-34, build-tools;34.0.0..."
yes | sdkmanager --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null

echo "Android SDK ready."
