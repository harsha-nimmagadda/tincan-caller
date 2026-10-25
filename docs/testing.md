# Testing

Automated checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` (see README).
This file holds what automation cannot cover: **manual device checks**. The full release matrix
(PLAN §10.3) is added in Phase 8; the Phase 3 and later sections below are filled in as phases land.

## Phase 3 — camera / microphone on real phones

Needs one Android phone (Chrome) and one iPhone (Safari) on the same Wi-Fi as your computer.

1. `pnpm dev:https` and note the `Network:` URL it prints (e.g. `https://192.168.1.13:5173/`).
2. On the phone open `<that URL>/src/debug.html` (accept the self-signed certificate warning).
   getUserMedia needs HTTPS, which is why `dev:https` exists.
3. Pair it with a second tab/computer using the debug page's Start call / Join buttons:
   copy the invite from one side into the other's "paste invite" box, then the reply back. Use the
   plain page (no `?fake=1`) so the real camera is used.

Tick each box and note the device + OS/browser version.

| Check                                                                                                                                                           | Android Chrome | iPhone Safari |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------- |
| Camera + mic permission prompt appears once, and the call connects                                                                                              | ☐              | ☐             |
| **Flip** shows only when the phone has two cameras; pressing it switches front/back, the peer keeps seeing video, and the preview un-mirrors on the back camera | ☐              | ☐             |
| **Cam off** turns the camera's indicator light/dot **off** (not just a black picture); cam on brings it back and the peer sees video again                      | ☐              | ☐             |
| Mic mute: peer sees "remote mic off"; unmute works; no re-prompt                                                                                                | ☐              | ☐             |
| Start with `?audio=1` (audio-only), then press Cam: peer starts receiving video                                                                                 | ☐              | ☐             |
| **Background/foreground (iOS):** lock the phone or switch app for ~30 s, return: camera and mic recover and the peer sees video/hears audio again               | n/a            | ☐             |
| Rotate the phone mid-call: remote picture stays correctly proportioned, no crash                                                                                | ☐              | ☐             |
| Plug in / connect a Bluetooth headset mid-call: it appears in the mic/speaker lists; unplugging falls back to the phone mic without ending the call             | ☐              | ☐             |
| Device pickers list real device names (labels appear after permission)                                                                                          | ☐              | ☐             |

Known automated coverage: the controller's ordering rules (stop-before-open on phones, fall back
when a device disappears, re-acquire after the OS ends a track, serialised operations) are unit-tested
with scripted fakes; flip, device switch, unplug and background-kill run end to end in
Chromium, Firefox and WebKit. What only a real phone can show is the **physical** behaviour (camera
light, real Bluetooth routing, iOS background policy), hence this checklist.

## Phase 4 — the real UI

Automated: `pnpm e2e` drives the real app (`test/e2e/ui/`) through call scenarios, error cases, QR
codes (generated, then decoded from a picture), the tab bridge, shortcuts, Back/close guards,
permission denial and settings, in Chromium, Firefox and WebKit.

Accessibility: Lighthouse accessibility was **100** on all 12 screens/states. Re-run with
`scripts/a11y-audit.mjs` (instructions at the top of the file; Lighthouse is not a project dependency).

**Manual — phone ↔ laptop using only QR codes, in the same room** (needs a phone with a camera and a laptop):

1. Laptop: `pnpm dev:https`, open the `https://localhost:5173/` URL, Start a call → Continue. A QR code appears.
2. Phone (same Wi‑Fi): open `https://<laptop LAN IP>:5173/`, accept the certificate warning, Join with a code → **Scan QR**, point at the laptop screen.
3. Phone: Continue (allow camera/mic). It shows its own reply QR.
4. Laptop: **Scan reply QR** (uses the laptop webcam), point at the phone screen. The call connects.

| Check                                                                                                                 | Result |
| --------------------------------------------------------------------------------------------------------------------- | ------ |
| Phone scans the laptop's invite QR with the in-app scanner                                                            | ☐      |
| Laptop scans the phone's reply QR with its webcam                                                                     | ☐      |
| The phone's native camera app can also open the invite QR (it is a full link)                                         | ☐      |
| Call connects; video + audio both ways; safety codes match                                                            | ☐      |
| iOS Safari: if opened from the Home Screen app, the reply link opened in Safari shows the "paste this reply" fallback | ☐      |
| Android Back button during the call asks "End the call?"                                                              | ☐      |
| Screen stays awake for 5 minutes in a call (wake lock)                                                                | ☐      |
| Picture in picture works (button in "More"); auto‑PiP when switching apps (Chrome/Safari)                             | ☐      |
