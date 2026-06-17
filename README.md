# Breadcrumb — Find Your Way Back 🧭

A mobile web app (PWA) that records your GPS trail so you can walk back to your
start point or any waypoint you marked. Big compass arrow + distance, optional
map. 100% client-side, no server, no account. Your trail is saved on your phone
(localStorage).

## What it does

- **● Rec** — asks for location + compass permission, then records a breadcrumb
  trail (lat / lon / altitude). First fix becomes your *Start point*.
- **📍 Mark** — save the spot you're standing on as a named waypoint.
- **Trajectory record** — save multiple trails on the same phone, rename them,
  delete old ones, and switch back to a previous record later.
- **➤ Find** — starts live GPS navigation without adding points to the selected
  record. Use this when you only want to follow an already saved path back.
- **Navigate back** — pick *Start* or any waypoint; a big 3D arrow points the
  straight-line direction to that target from your current GPS position. It
  uses the phone's full orientation (compass + tilt), so it keeps pointing at
  the target whether you hold the phone flat, upright, or anywhere in between —
  held upright with the target ahead, the arrow tips "into" the screen. Shows
  distance, direct bearing and altitude difference. Turns green ✓ when you
  arrive (≤ 8 m).
- **Map** (optional) — sits right below the arrow in the same card and draws
  your path on OpenStreetMap. A 🧭 toggle switches between north-up and
  heading-up (the map auto-rotates to your compass heading, like car
  navigation). Needs internet for the map tiles; the arrow works fully offline.
- **■ Stop / 🗑 Clear** — stop GPS / erase the selected record's trail and
  waypoints. Use **Delete** to remove the whole selected record.

## Important: it must be served over HTTPS

Browsers only give GPS + compass to **secure** pages (`https://` or `localhost`).
Opening `index.html` as a `file://` will NOT get location.

### Quick local test (on the same machine)
```bash
cd spatial-tracking
python3 -m http.server 8000
# open http://localhost:8000  (localhost counts as secure)
```

### Test on your actual phone
Your phone needs HTTPS. Easiest options:

1. **Cloudflare Tunnel / ngrok** (instant public HTTPS URL):
   ```bash
   python3 -m http.server 8000
   # in another terminal:
   ngrok http 8000        # or: cloudflared tunnel --url http://localhost:8000
   ```
   Open the `https://…` URL it prints on your phone.

2. **GitHub Pages** (free permanent hosting): push this folder to a repo, enable
   Pages → it serves over HTTPS. Best for everyday use.

Then in your phone browser use **Add to Home Screen** to install it as an app
(works offline after first load).

## Notes & limits

- **Altitude (web)** comes from the phone's GPS and is often missing or off by
  tens of meters — treat it as best-effort. Shows `n/a` when unavailable.
  Readings with poor vertical accuracy are rejected and the rest smoothed
  (weighted by their accuracy, with lone spikes damped so a stationary reading
  never jumps); the readout shows the uncertainty (`412 m ±8`). Indoors GPS
  altitude stops, so after ~30 s without a fresh reading it is flagged `(old)` —
  elevator or stair height changes are invisible to GPS, and browsers expose no
  barometer to measure them.
- **Altitude (native Android app)** adds the phone's **barometer**, the only
  sensor that sees an elevator. Air pressure tracks vertical movement to ~0.1 m,
  so the app fuses it with GPS: the barometer drives fast relative change while
  GPS slowly anchors the absolute level. The readout shows `412 m ±2 ·baro` and
  keeps moving in elevators and stairwells where the web version freezes. See
  **Native Android app** below.
- **iOS** asks for compass (motion) permission on the first Rec or Find tap —
  allow it.
- **Background tracking is limited.** Mobile browsers pause GPS when the screen
  locks or you switch apps. The app keeps the screen awake (Wake Lock) while
  tracking — keep it in the foreground for a complete trail.
- If recording resumes after the screen was locked, the next GPS fix starts a
  new trail segment instead of drawing a straight line from the old point.
- Weak indoor GPS fixes are filtered: very poor accuracy and suspicious jumps
  are ignored, and noisy movement inside the reported accuracy radius is not
  stored as a breadcrumb.
- **Indoor fallback (PDR).** When GPS degrades (shopping mall, parking garage),
  the app switches to pedestrian dead reckoning: it counts your steps with the
  accelerometer and advances the position along the compass heading (~0.7 m per
  step). Status shows `indoor PDR · N steps`, accuracy shows `≈X m (PDR)` and
  grows with distance walked, and estimated trail segments are drawn dashed on
  the map. As soon as a good GPS fix (≤ 35 m) returns, it snaps back to GPS.
  PDR drifts a few percent of distance walked — treat long indoor stretches as
  approximate. (True visual-inertial odometry isn't available to web pages;
  it would need a native ARCore/ARKit app or a WebXR AR session.)
- A breadcrumb is stored when you've moved ≥ 5 m or every ≥ 8 s (tunable at the
  top of `app.js`).

## Native Android app (Capacitor)

The same `app.js` ships two ways: the web PWA above, and a native Android app via
[Capacitor](https://capacitorjs.com). The native build unlocks the **barometer**
(`Sensor.TYPE_PRESSURE`) through a small custom plugin — the one altitude source
browsers can't reach. Everything is feature-detected, so the identical code runs
on the web (GPS-only) and in the app (GPS + barometer); the web files stay at the
repo root for Cloudflare Pages, and `npm run build:web` stages them into `www/`.

### Prerequisites
- Node 18+ and the **Android SDK** (platform 34, build-tools 34).
- A **JDK 17** (Temurin/OpenJDK). Point Gradle at it via `JAVA_HOME` or
  `org.gradle.java.home` in `android/gradle.properties`.

### Build a debug APK locally
```bash
npm install
npm run android:assemble      # build:web → cap sync → gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
Or open the project in Android Studio: `npm run android:open`.

### CI build + download link (Cloudflare)
The APK is also built automatically and offered for download from the deployed
site, mirroring the `music_hub` setup:

- `npm run build` → `scripts/build-cloudflare-pages.sh` provisions a JDK 17 and
  the Android SDK (API 34) if absent, builds the debug APK, stages the web app
  into `www/`, and bundles the APK at `www/downloads/` with a `metadata.json`.
- `wrangler.jsonc` serves `www/`, so the deployed site exposes a permanent
  **`/downloads/spatial-tracking.apk`** plus a versioned copy. The home screen
  shows a *Get the Android app* card (hidden when already running in the app)
  that reads `metadata.json` for the version and size.
- `.github/workflows/deploy-cloudflare.yml` triggers a Cloudflare deploy hook on
  every `v*` tag push (set `CLOUDFLARE_DEPLOY_HOOK_URL` in repo secrets).

**Cloudflare project settings:** Build command `npm run build`, build output
directory `www`. No secrets are needed for the debug APK. (`JDK_URL` /
`CMDLINE_TOOLS_VERSION` can be overridden via env if the defaults are slow.)

> The CI ships a **debug-signed** APK so it installs by sideload with zero
> keystore setup. For a Play-ready signed release, add an `ANDROID_KEYSTORE_*`
> secret and switch the build to `assembleRelease` — see `music_hub` for the
> exact keystore-from-base64 pattern.

### How the barometric fusion works
- `android/.../BarometerPlugin.java` streams `{ pressure, altitude, timestamp }`
  events to JS (`Barometer` Capacitor plugin, registered in `MainActivity`).
- `app.js` runs a **complementary filter**: each pressure sample applies its
  altitude *delta* (fast, catches elevators); each trusted GPS fix nudges the
  fused value toward GPS's absolute altitude (slow, corrects weather drift).
  Poor-accuracy GPS (the indoor case) is ignored so the barometer carries on
  alone. Single-sample glitches beyond 8 m are dropped. Tunables: the `BARO_*`
  constants near the top of `app.js`.
- Devices without a barometer fall back to the GPS-only altitude path
  automatically.

> iOS isn't wired up here (no Mac to build on), but the JS side is
> platform-agnostic — adding an iOS `CMAltimeter` plugin with the same
> `Barometer` interface is all that's needed.

## Files

| File | Purpose |
|------|---------|
| `index.html` | UI |
| `style.css` | styles |
| `app.js` | tracking, geo math, compass, map, storage, barometric fusion |
| `sw.js` | service worker (offline app shell) |
| `manifest.json` | PWA install metadata |
| `icons/` | app icons |
| `capacitor.config.json` | Capacitor app config (appId, webDir) |
| `scripts/copy-web.mjs` | stages root web assets into `www/` for Capacitor |
| `scripts/build-cloudflare-pages.sh` | CI build: APK + `www/` with bundled download |
| `scripts/setup-android-sdk.sh` | provisions the Android SDK on a clean runner |
| `scripts/prepare-apk.mjs` | copies the APK + `metadata.json` into `www/downloads/` |
| `android/` | native Android project (incl. `BarometerPlugin.java`) |
| `.github/workflows/` | tag-push → Cloudflare deploy hook |
