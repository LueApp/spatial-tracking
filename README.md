# Breadcrumb — Find Your Way Back 🧭

A mobile web app (PWA) that records your GPS trail so you can walk back to your
start point or any waypoint you marked. Big compass arrow + distance, optional
map. 100% client-side, no server, no account. Your trail is saved on your phone
(localStorage).

## What it does

- **▶ Start** — asks for location + compass permission, then records a breadcrumb
  trail (lat / lon / altitude). First fix becomes your *Start point*.
- **📍 Mark** — save the spot you're standing on as a named waypoint.
- **Navigate back** — pick *Start* or any waypoint; a big arrow points the way
  (rotates with your phone's compass), showing distance, bearing and altitude
  difference. Turns green ✓ when you arrive (≤ 8 m).
- **Map** (optional) — draws your path on OpenStreetMap. Needs internet for the
  map tiles; the arrow works fully offline.
- **■ Stop / 🗑 Clear** — stop tracking / erase everything.

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

- **Altitude** comes from the phone's GPS and is often missing or off by tens of
  meters — treat it as best-effort. Shows `n/a` when unavailable.
- **iOS** asks for compass (motion) permission on the first Start tap — allow it.
- **Background tracking is limited.** Mobile browsers pause GPS when the screen
  locks or you switch apps. The app keeps the screen awake (Wake Lock) while
  tracking — keep it in the foreground for a complete trail.
- A breadcrumb is stored when you've moved ≥ 5 m or every ≥ 8 s (tunable at the
  top of `app.js`).

## Files

| File | Purpose |
|------|---------|
| `index.html` | UI |
| `style.css` | styles |
| `app.js` | tracking, geo math, compass, map, storage |
| `sw.js` | service worker (offline app shell) |
| `manifest.json` | PWA install metadata |
| `icons/` | app icons |
