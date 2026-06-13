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

- **Altitude** comes from the phone's GPS and is often missing or off by tens of
  meters — treat it as best-effort. Shows `n/a` when unavailable. Readings with
  poor vertical accuracy are rejected and the rest smoothed; the readout shows
  the uncertainty (`412 m ±8`). Indoors GPS altitude stops updating, so after
  ~30 s without a fresh reading it is flagged `(old)` — elevator or stair
  height changes are invisible to GPS, and browsers expose no barometer to
  measure them.
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

## Files

| File | Purpose |
|------|---------|
| `index.html` | UI |
| `style.css` | styles |
| `app.js` | tracking, geo math, compass, map, storage |
| `sw.js` | service worker (offline app shell) |
| `manifest.json` | PWA install metadata |
| `icons/` | app icons |
