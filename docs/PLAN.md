# Tincan — Implementation Plan (v1.0)

> Serverless, peer-to-peer 1:1 video calling PWA. Open source (AGPL-3.0), hosted as static files on GitHub Pages.
> This document is the single source of truth. The implementer works **one phase per chat session**, in order.

---

## 0. How to use this plan (for the implementing model)

Start each chat with:

> Read `docs/PLAN.md` fully. Implement **Phase N** only. Obey section 3 ("Rules"). Do not start the next phase. Finish by running every check in that phase's "Acceptance criteria" and report the results verbatim.

- If the plan is ambiguous, pick the simplest option that satisfies the acceptance criteria and add a `// PLAN-NOTE:` comment explaining the choice. Do not redesign.
- If the plan is **wrong** (e.g. a browser API behaves differently than described), stop and report. Do not silently work around it.
- Specs marked **NORMATIVE** must be followed byte-for-byte. They are wire formats shared between two independently running copies of the app.

---

## 1. Product decisions (locked)

| Topic | Decision |
|---|---|
| Name | **Tincan** (single constant `APP_NAME` in `src/config.ts`). Note: "Tin Can API" is an e-learning standard, so name the repo `tincan-call` for search clarity. |
| Topology | 1:1 only. The code must not assume 1:1 *outside* `CallSession`, so mesh can be added later. |
| Signaling, default | **Manual**: invite link / QR code / copy-paste (offer → answer). No third party involved. |
| Signaling, opt-in | **Automatic via public Nostr relays.** Payloads are end-to-end encrypted with a key that lives only in the link's `#fragment`. Off by default; can be enabled in Settings or with a one-time consent prompt when opening such a link. |
| STUN | On by default (`stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`). Editable, and can be removed in Settings (LAN-only calls then; Settings explains this in one line: "Helps find a direct route between networks; sees only your IP"). Confirmed by the owner. |
| TURN | Not bundled. Users can add their own (BYO) in Settings, with a "Test" button and a "force relay" (hide my IP) option. A docs page explains how to self-host coturn. |
| v1 features | 1:1 audio and video, **audio-only mode**, mic/cam toggles, **camera flip + device picker** (mic/cam/speaker), **stats/network HUD**, **optional safety code** (anti-MITM), **picture-in-picture**, **screen wake lock**, **i18n scaffolding** (English only). |
| Not in v1 | Text chat, file transfer, screen sharing, group calls, contacts/persistent identity, push/ringing, recording. |
| Identity | None. Every call is a fresh one-time handshake. Only settings are stored (localStorage). |
| Stack | React 19 + TypeScript 6.0.x + Vite 8 + Tailwind CSS 4 + vite-plugin-pwa 2 + zustand 5. Tests: Vitest 5 + Playwright 1.64. pnpm 10, Node 24 LTS. |
| Platforms (must work) | Android Chrome (tab and installed PWA), iOS Safari (tab and home-screen PWA), desktop Chrome/Edge, desktop Firefox, desktop Safari. Cross-engine calls must work. |
| License / host | AGPL-3.0, GitHub Pages at `https://<user>.github.io/tincan-call/` (subpath, so set Vite `base`). |

### Hard limits to state honestly in the README
1. **No ringing.** Without a server nothing can wake a closed app, so both people must have Tincan open.
2. **Some networks need TURN.** About 10–20% of network pairs (mobile carrier NAT, corporate firewalls) cannot connect directly. Without a BYO TURN server those calls fail, and the app explains why.
3. **Peers see each other's IP address** (inherent to P2P). "Force relay" hides it, but needs TURN.
4. **Manual mode cannot auto-reconnect** after a network change (e.g. Wi-Fi → 4G). It offers a one-tap "new invite" instead. Relay mode reconnects automatically.

---

## 2. Findings from the POC (why this is a rewrite)

The POC lives in `../tincan-poc/` after Phase 0, for reference only. **Port these:**
- `src/utils/mediaConstraints.ts`: orientation-aware constraints. Port as is, but drop the manual aspect-ratio selector; keep "auto" only.
- The stats logic in `PeerManager.startTelemetryMonitoring`: rewrite it as a pure function (see 6.9).
- The ICE server test idea in `iceServers.ts::testIceServerReachability`.

**Do not port** anything else. The problems to fix:

| # | POC problem | Fix in v1 |
|---|---|---|
| 1 | Full SDP compressed with LZ-string makes 1.5–3 KB tokens, so the QR code often falls back to "use link" | Compact binary token (~110 bytes) carrying only ICE credentials, fingerprint and candidates. Bootstrap a data channel, then negotiate media over it (6.3–6.5). |
| 2 | Offer in `?offer=` query, which reaches GitHub's server logs | Use the `#fragment` only, which is never sent to the server. Strip it from the address bar right after reading it. |
| 3 | No MITM protection, so "E2E" was not true | Commit–reveal safety code (6.7). |
| 4 | Tests re-implement the functions instead of importing them | Tests import real modules. |
| 5 | 950-line `PeerManager` god-class mixing media, RTC, files, stats | Separate modules: `MediaController`, `CallSession`, transports, pure codecs. |
| 6 | `registerType: 'autoUpdate'` can reload the page mid-call | `registerType: 'prompt'`, and offer the update only when not in a call. |
| 7 | Manifest `orientation: portrait-primary`, SVG-only icons | No orientation lock; PNG and maskable icons; apple-touch-icon PNG. |
| 8 | Cam-off via `track.enabled=false` keeps the camera light on | Stop the track and `replaceTrack(null)`. |
| 9 | Camera flip opens the new camera before closing the old one, which fails on many Androids | Stop first, then acquire. |
| 10 | Uses legacy `offerToReceiveAudio` and the `RTCSessionDescription` constructor | Transceivers and plain description objects. |
| 11 | No reconnection, no failure diagnostics | ICE restart over the data channel, plus a diagnostics classifier (6.10). |
| 12 | Leftover dev config (`pinggy` hosts) | Remove. |

---

## 3. Rules for the implementer (apply to every phase)

1. **Never modify ("munge") the local SDP** before `setLocalDescription`. We *build* remote SDP from tokens; we never edit our own.
2. **Never** put tokens or secrets in query strings. Use only `#o=`, `#a=` and `#r=`, and call `history.replaceState` to strip them after reading.
3. TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any`; use `unknown` plus type guards for all external input (tokens, data-channel messages, relay events, localStorage).
4. Pure logic (codecs, SDP, SAS, stats parsing, diagnostics, relay room reducer) lives in `src/core/**` with **no DOM/React imports** and has unit tests.
5. React components never touch `RTCPeerConnection` or `MediaStreamTrack` directly. They read the zustand store and call store actions.
6. Every `getUserMedia` track, event listener, interval, `RTCPeerConnection`, wake lock and relay socket gets released on hangup and unmount. Write the teardown with the setup.
7. Every `HTMLMediaElement.play()` call handles the rejected promise (autoplay policy) by showing a "Tap to start audio" overlay.
8. ICE priority math uses multiplication, not bitwise shifts (`126 << 24` overflows int32 in JS).
9. Do not add a dependency not listed in this plan without writing a one-line justification in the PR description.
10. Keep files under ~300 lines. Keep functions small and named for what they do.
11. All user-visible strings go through `t('key')` (section 8.4). No hardcoded English in components.
12. Use `data-testid` attributes on everything the e2e tests touch (listed in 10.2).
13. Commit at the end of each phase with a conventional-commit message.

---

## 4. Repository layout (target)

```
tincan-call/
  .github/
    workflows/ci.yml            # lint, typecheck, unit, e2e, build
    workflows/deploy.yml        # main → GitHub Pages
    ISSUE_TEMPLATE/{bug.yml,feature.yml}
    pull_request_template.md
    dependabot.yml
  docs/
    PLAN.md                     # this file
    protocol.md                 # NORMATIVE wire formats (copy of 6.3, 6.5, 6.7, 7.x)
    turn.md                     # self-hosting coturn + using hosted TURN
    testing.md                  # manual device matrix + checklist
    threat-model.md
  public/
    icons/ (generated PNGs)  robots.txt
  scripts/
    capture-sdp-fixtures.ts     # Playwright script dumping real SDPs from chromium/firefox/webkit
    mock-nostr-relay.ts         # tiny WS relay for e2e (Phase 6)
    relay-smoke.ts              # manual check that public relays accept our ephemeral kind
  src/
    main.tsx  App.tsx  config.ts  index.css
    i18n/ index.ts  en.ts
    core/
      encoding/ base64url.ts  crc32.ts  bytes.ts
      token/ token.ts           # binary encode/decode (NORMATIVE 6.3)
      sdp/ extract.ts  build.ts  candidates.ts
      rtc/ call-session.ts  negotiation.ts  gather.ts  control.ts  sas.ts  stats.ts  diagnostics.ts  ice-config.ts
      media/ media-controller.ts  constraints.ts  devices.ts
      signaling/ link.ts  tab-bridge.ts  relay/ relay-crypto.ts  relay-room.ts  nostr-transport.ts
      platform/ wake-lock.ts  pip.ts  share.ts  clipboard.ts  media-session.ts  capabilities.ts
      settings/ settings.ts     # schema, defaults, load/validate/save
    state/ store.ts              # zustand store, wires core to UI
    ui/
      screens/ Home.tsx  Lobby.tsx  CreateCall.tsx  JoinCall.tsx  InCall.tsx  CallEnded.tsx  Settings.tsx  About.tsx
      components/ QrCode.tsx  QrScanner.tsx  CodeBox.tsx  SafetyCode.tsx  StatsHud.tsx  ControlBar.tsx
                  VideoTile.tsx  DevicePicker.tsx  Toast.tsx  UpdatePrompt.tsx  ConsentDialog.tsx  ErrorPanel.tsx
    workers/ qr-decode.worker.ts
  test/
    unit/ ... (mirrors src/core)
    fixtures/sdp/ chrome-offer.sdp firefox-offer.sdp webkit-offer.sdp (+ answers) stats/*.json
    e2e/ manual-call.spec.ts  cross-browser.spec.ts  errors.spec.ts  relay.spec.ts  offline.spec.ts
  index.html  vite.config.ts  playwright.config.ts  vitest.config.ts  eslint.config.js  tsconfig.json
  LICENSE (AGPL-3.0)  README.md  PRIVACY.md  SECURITY.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  CHANGELOG.md
```

---

## 5. Architecture overview

```
 UI (React screens/components)
   │ reads state / calls actions
 state/store.ts  (zustand)
   │ owns one MediaController + at most one CallSession + optional RelayRoom
   ├── MediaController ── getUserMedia, devices, flip, mute, re-acquire, emits "localTracksChanged"
   ├── CallSession ────── RTCPeerConnection, bootstrap DC "ctl", perfect negotiation, SAS, stats, ICE restart
   │      uses core/token + core/sdp to turn "local description" ⇄ "token"
   └── Transport for tokens:
          Manual:  link / QR / paste  (+ tab-bridge for answer links)
          Relay:   RelayRoom (pure reducer) + NostrTransport (WebSocket, lazy-loaded)
```

**Call flow (both modes):**
1. **Bootstrap**: the caller creates a PC that has only a negotiated data channel `ctl` (id 0). It gathers ICE fully (vanilla ICE) and encodes an **offer token**. The callee builds a synthetic remote offer SDP from it, answers, gathers, and encodes an **answer token**. The caller builds a synthetic remote answer SDP from that. DTLS/SCTP comes up and `ctl` opens.
2. **Media**: over `ctl`, the caller adds audio and video transceivers, and the offer/answer for media runs over the data channel (perfect negotiation). Trickle ICE also goes over `ctl` from now on.
3. **Safety code**: commit–reveal over `ctl`, then both screens show the same 6 digits.
4. **Live**: mic/cam state messages, stats, ICE restart over `ctl` when the connection degrades.

This is why tokens are tiny: they never contain codecs or media lines.

---

## 6. Core specifications

### 6.1 `config.ts` constants

```ts
export const APP_NAME = 'Tincan';
export const PROTOCOL_VERSION = 1;            // wire protocol, independent of app semver
export const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
// ↑ Phase 6 must verify each with scripts/relay-smoke.ts; drop any that reject kind 25050.
export const GATHER_TIMEOUT_MS = 3000;        // 5000 when any TURN server configured
export const CONNECT_TIMEOUT_MS = 20000;      // after both descriptions applied
export const DISCONNECT_GRACE_MS = 3000;      // 'disconnected' this long → restartIce
export const RESTART_TIMEOUT_MS = 15000;      // restart not recovered → failed
export const OFFER_SOFT_EXPIRY_MS = 10 * 60_000; // warn "invite is old, create a new one"
export const STATS_INTERVAL_MS = 1000;        // HUD visible; 3000 otherwise (quality dot)
export const MAX_CTL_MESSAGE_BYTES = 65536;
export const MAX_CANDIDATES = 12;
export const RELAY_KIND = 25050;
export const RELAY_HELLO_INTERVAL_MS = 3000;
export const RELAY_RESEND_MS = 4000;
export const RELAY_MAX_EVENT_AGE_S = 60;
```

### 6.2 RTCPeerConnection configuration

```ts
{
  iceServers: [...stun from settings, ...turn from settings],
  iceTransportPolicy: settings.forceRelay && hasTurn ? 'relay' : 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  certificates: [await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' })],
}
```
If `generateCertificate` throws, omit `certificates`. All target browsers emit a `sha-256` fingerprint anyway; the token encoder rejects anything else with `UnsupportedFingerprintError`.

### 6.3 Token format v1 — **NORMATIVE**

Binary, big-endian, then **base64url without padding**.

```
offset  size  field
0       1     header: high nibble = token version (1), low nibble = kind (0 = offer, 1 = answer)
1       1     flags:
                bits 0-1  setup: 0 = actpass, 1 = active, 2 = passive
                bit  2    hasMid      (1 if mid != "0")
                bit  3    hasCommit   (answer only, MUST be 1 for answers)
                bit  4    hasOfferRef (answer only, MUST be 1 for answers)
                bits 5-7  reserved, MUST be 0 (decoder rejects if set)
2       1+n   ice-ufrag   : u8 length (4..64) + ASCII
        1+n   ice-pwd     : u8 length (22..128) + ASCII
        1+n   o= sess-id  : u8 length (1..20) + ASCII digits
        4     o= sess-version : u32
        32    DTLS fingerprint sha-256 (raw bytes)
        1+n   mid         : only if hasMid; u8 length (1..16) + ASCII
        16    commit      : only if hasCommit; first 16 bytes of SHA-256(callee nonce)   (see 6.7)
        4     offerRef    : only if hasOfferRef; first 4 bytes of SHA-256(ASCII "<offer ufrag>:<offer pwd>")
        1     candidate count (0..12)
        per candidate:
          1   bits 0-1 type (0 host, 1 srflx, 2 relay, 3 prflx); bits 2-3 family (0 ipv4, 1 ipv6, 2 mdns-uuid); bits 4-7 reserved = 0
          4|16|16  address (ipv4 bytes | ipv6 bytes | UUID bytes of "<uuid>.local")
          2   port u16
last    4     CRC-32 (IEEE, as in zlib) over all preceding bytes
```

Decoder requirements:
- Total length ≤ 512 bytes. Every length and range above is validated. Unknown version → `TokenVersionError`. CRC mismatch → `TokenCorruptError` ("the code looks cut off or mistyped").
- Accept input as: a raw token; a full link containing `#o=`/`#a=`; or text with surrounding whitespace or a chat message around it. Extract with the regex `/(?:#[oa]=)?([A-Za-z0-9_-]{60,700})/`, then decode.
- Expected kind mismatch (an answer pasted where an offer is expected, or vice versa) → `TokenKindError` with a specific message.

Size check: Chrome offer with 2 host + 1 srflx ≈ 2+5+25+20+4+32+1+3·7+4 ≈ 114 bytes ≈ 152 chars. The full link is ≈ 200 chars, which fits a QR code at ECC level M around version 9. Fine.

### 6.4 Extracting fields from the local SDP (`core/sdp/extract.ts`)

Input: `pc.localDescription.sdp` after gathering. The bootstrap SDP has exactly one `m=application` section.
- `ice-ufrag`, `ice-pwd`, `fingerprint`, `setup`: look in the media section first, then the session level (Firefox puts the fingerprint at session level).
- Fingerprint: choose the `sha-256` line; parse `AA:BB:...` into 32 bytes.
- `o=` line: `o=<user> <sess-id> <sess-version> IN IP4 <addr>`. Keep sess-id (string of digits) and sess-version.
- `mid` from `a=mid:`.
- Candidates: `a=candidate:` lines in that section. Keep component `1` and transport `udp` only. Parse the address, port and `typ`. Classify the family: IPv4 dotted / IPv6 contains `:` / mDNS matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$` (case-insensitive). Drop anything else. Dedupe by `type+addr+port`.
- **Selection order** (stop at `MAX_CANDIDATES`): host IPv4 (≤3), host mDNS (≤2), srflx IPv4 (≤2), host or srflx IPv6 (≤2), relay (≤3).

Unit tests use real SDPs captured from Chromium, Firefox and WebKit (`scripts/capture-sdp-fixtures.ts`, Phase 1) and check exact extracted values.

### 6.5 Building the remote SDP from a token (`core/sdp/build.ts`) — **NORMATIVE**

Use `\r\n` line endings and end with a trailing `\r\n`. `<setup>` comes from the token: an offer token is always `actpass`; an answer token carries the callee's actual value.

```
v=0
o=- <sess-id> <sess-version> IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE <mid>
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:<ufrag>
a=ice-pwd:<pwd>
a=ice-options:trickle
a=fingerprint:sha-256 <AA:BB:..:FF uppercase hex>
a=setup:<setup>
a=mid:<mid>
a=sctp-port:5000
a=max-message-size:262144
a=candidate:<i+1> 1 udp <priority> <address> <port> typ <type>[ raddr 0.0.0.0 rport 0]   (raddr only for non-host)
...
a=end-of-candidates
```
- `priority = typePref * 16777216 + (65535 - i) * 256 + 255` with typePref host 126, prflx 110, srflx 100, relay 0, where `i` is the index in the token's list.
- The address for mDNS is `<uuid-lowercase>.local`; IPv6 uses standard compressed text form.
- The real `sess-id` is reused so that later real offers over `ctl` (same sess-id, higher version) stay RFC 3264-consistent.

### 6.6 CallSession (`core/rtc/call-session.ts`)

A framework-free class with an event emitter. States (discriminated union):

```
idle
gathering                       (caller: building offer | callee: building answer)
awaiting-answer {offerToken, createdAt}        caller only
awaiting-connection {answerToken}              callee only
connecting                      (descriptions applied; waiting for ctl open)
negotiating-media               (ctl open; media offer/answer in flight)
connected
reconnecting                    (ICE restart in progress)
ended {reason: 'local-hangup' | 'remote-hangup'}
failed {reason: FailReason, diagnostics?: Diagnostics}
```
`FailReason`: `'connect-timeout' | 'ice-failed' | 'restart-timeout' | 'sas-commit-mismatch' | 'protocol-mismatch' | 'internal'`.

**Public API**
```ts
createOffer(): Promise<string>                 // caller: idle → gathering → awaiting-answer; returns token
acceptAnswer(input: string): Promise<void>     // caller: validates kind, offerRef; → connecting
acceptOffer(input: string): Promise<string>    // callee: idle → gathering → awaiting-connection; returns answer token
hangup(): void                                 // sends {t:'bye'} best-effort; → ended
attachLocalTracks(audio: MediaStreamTrack|null, video: MediaStreamTrack|null): Promise<void>  // replaceTrack on senders
sendMediaState(s: {mic: boolean; cam: boolean}): void
getTelemetry(): Promise<Telemetry>
events: state | remoteStream | remoteMediaState | sas | warning
```

**Bootstrap steps (caller)**
1. Create the PC (6.2). `pc.createDataChannel('ctl', { negotiated: true, id: 0, ordered: true })`.
2. `await pc.setLocalDescription()` (implicit offer). Wait for gathering (`gather.ts`): resolve on `iceGatheringState === 'complete'` or `GATHER_TIMEOUT_MS`, whichever comes first.
3. Extract (6.4), then encode the token (6.3, kind offer). Store `offerRef = SHA-256(ufrag:pwd)[0..4]`.
4. `acceptAnswer`: decode, require kind answer, require `offerRef` match (otherwise `TokenMismatchError`: "This reply code belongs to a different invite"). Keep `commit`. `await pc.setRemoteDescription({ type: 'answer', sdp: build(token) })`. Start `CONNECT_TIMEOUT_MS`.

**Bootstrap steps (callee)**
1. Decode, require kind offer. Create the PC and the same negotiated `ctl` channel.
2. `await pc.setRemoteDescription({ type: 'offer', sdp: build(token) })`, then `await pc.setLocalDescription()` (implicit answer), then gather.
3. Generate `nB = crypto.getRandomValues(16 bytes)`, `commit = SHA-256(nB)[0..16]`, `offerRef` from the offer's ufrag:pwd. Encode the answer token.
4. Start a 2-minute soft timer to show the hint "Waiting… did the caller enter your reply code?" (not a failure).

**After `ctl` opens (both)**
- Send `{t:'hello', proto: PROTOCOL_VERSION, app: <semver>}`. If the peer's `proto` differs → `failed('protocol-mismatch')`.
- Start the SAS exchange (6.7).
- Caller only: `pc.addTransceiver('audio', {direction: 'sendrecv'})` and `pc.addTransceiver('video', {direction: 'sendrecv'})`, then `replaceTrack` the current local tracks (or `null`). This triggers `negotiationneeded`.
- Perfect negotiation (`negotiation.ts`) follows the MDN pattern verbatim: **caller is impolite, callee is polite.** Messages go over `ctl` as `{t:'sdp', type, sdp}` and `{t:'ice', c}`.
- **Callee hook, critical:** after `setRemoteDescription(offer)` and *before* `setLocalDescription()` (answer), for each transceiver with `receiver.track.kind` audio/video and a null `currentDirection`: set `direction = 'sendrecv'` and `await sender.replaceTrack(localTrackOfKind ?? null)`. That way one negotiation round gives two-way media.
- Remote stream: keep **one** `MediaStream` for the session. On `ontrack`, `remoteStream.addTrack(event.track)` if not already present. Do not rely on `event.streams` (no msid is sent). Emit `remoteStream` once.
- Then → `connected`.

**Mic/cam semantics (no renegotiation ever after setup)**
- Mic mute: `audioTrack.enabled = false`, then send `{t:'media', mic: false, cam}`.
- Cam off: MediaController **stops** the video track; the session calls `videoSender.replaceTrack(null)` and sends state. Cam on: a new track goes through `replaceTrack(newTrack)`.
- Audio-only mode is simply "cam off from the start".

**Connection monitoring**
- `pc.connectionState` (falling back to `iceConnectionState` on browsers without it):
  - `disconnected` for ≥ `DISCONNECT_GRACE_MS` → `reconnecting`. The caller calls `pc.restartIce()`, and negotiation runs over `ctl` if it is still open.
  - `failed`, or `reconnecting` for more than `RESTART_TIMEOUT_MS`, or `ctl` closes unexpectedly → `failed('ice-failed' | 'restart-timeout')` with diagnostics. The UI offers "Start a new invite" (manual mode) or auto-rejoins (relay mode, 7.4).
- `ctl` `{t:'bye'}` received → `ended('remote-hangup')`.
- `pagehide` → `hangup()`. During a call, `beforeunload` shows the browser's confirm dialog.

**Teardown**: close `ctl`, `pc.close()`, clear timers, remove listeners. Local tracks belong to MediaController and are **not** stopped by the session.

### 6.7 Safety code (SAS) with commit–reveal — **NORMATIVE**

Purpose: detect a man in the middle who tampered with the invite or reply (e.g. a hostile chat channel). Without the commitment, an attacker could grind certificates until short codes collide; the commitment makes a 6-digit code sound (attacker success ≈ 1 in 10⁶ per call).

1. Callee: `nB` (16 random bytes); its answer token carries `commit = SHA-256(nB)[0..16]`.
2. When `ctl` opens, the caller sends `{t:'sas1', n: b64url(nA)}` with `nA` = 16 random bytes.
3. The callee, **only after receiving `sas1`**, replies `{t:'sas2', n: b64url(nB)}`.
4. The caller checks that `SHA-256(nB)[0..16] == commit`. On mismatch → `failed('sas-commit-mismatch')` with a red "Security check failed — this call may be intercepted".
5. Both compute `h = SHA-256( utf8("tincan-sas-v1") ‖ fpCaller(32) ‖ fpCallee(32) ‖ nA(16) ‖ nB(16) )`, where `fpCaller`/`fpCallee` are the sha-256 fingerprints taken from the **actual** local/remote descriptions according to role. `code = (u32be(h[0..4]) mod 1_000_000)` zero-padded to 6 digits, displayed as `"123 456"`.
6. UI: a shield badge with states "Unverified" (grey), then the user taps "Codes match" → "Verified" (green, local only). Optional, never blocks the call. If the user taps "Codes don't match", the app ends the call and shows an explanation.

Unit tests: fixed vectors (given fp/nonces → expected code), commit mismatch, wrong-order message handling (a `sas2` without a prior `sas1` is ignored).

### 6.8 Control protocol over `ctl` — **NORMATIVE**

JSON text messages of at most `MAX_CTL_MESSAGE_BYTES`. Anything larger, unparseable or failing its guard is dropped (logged in debug mode).
```ts
type Ctl =
  | { t: 'hello'; proto: number; app: string }
  | { t: 'sdp'; type: 'offer' | 'answer'; sdp: string }
  | { t: 'ice'; c: RTCIceCandidateInit | null }
  | { t: 'sas1'; n: string } | { t: 'sas2'; n: string }
  | { t: 'media'; mic: boolean; cam: boolean }
  | { t: 'bye' };
```
Unknown `t` → ignored (forward compatibility).

### 6.9 Stats (`core/rtc/stats.ts`) — pure

`parseStats(report: RTCStatsReport-like Map, prev: StatsSnapshot | null, nowMs) → { telemetry, snapshot }`
- Selected pair: `transport.selectedCandidatePairId` (Chrome/Safari); otherwise a candidate-pair with `selected === true` (Firefox); otherwise `state === 'succeeded' && nominated`.
- RTT: `pair.currentRoundTripTime * 1000`.
- Bitrates in/out (kbps) from **deltas** of `bytesReceived` (inbound-rtp audio+video) and `bytesSent` (outbound-rtp) against `prev`.
- Video in: `frameWidth`, `frameHeight`, `framesPerSecond`. Packet loss % from **deltas** of `packetsLost`/`packetsReceived` in this interval, not cumulative totals.
- Route: if the local or remote candidate is `relay` → `'relay'`; both `host` → `'direct-lan'`; otherwise `'direct-nat'`. Flag `ipv6` when the address contains `:`. Also report the codec (`codecId` → `mimeType`).
- Quality dot: good / fair / poor from RTT (<150 / <400 / ≥400 ms) and loss (<2 / <8 / ≥8 %); the worse of the two wins.
- Tests: JSON fixtures of stats reports captured from Chromium and Firefox in Phase 2's e2e run (save one sample each).

### 6.10 Failure diagnostics (`core/rtc/diagnostics.ts`) — pure

Input: local candidate types gathered, remote candidate types (from the token), TURN configured?, the online flag, the final ICE state. Output: one key from:
- `offline-no-stun`: no srflx locally and `navigator.onLine === false` → "You're offline. Calls only work on the same Wi-Fi/hotspot."
- `stun-blocked`: no srflx locally while online → "Your network blocks STUN. Try another network or add a TURN server."
- `peer-stun-blocked`: the same, but for the remote side.
- `strict-nat`: both have srflx, no TURN → "Your networks don't allow a direct connection (common on mobile data / office networks). A TURN relay is needed." Link to `docs/turn.md`.
- `turn-failed`: TURN configured but no relay candidate → "Your TURN server didn't respond. Check settings."
- `unknown`.

### 6.11 MediaController (`core/media/media-controller.ts`)

- `start({audio: true, video: boolean, deviceIds?, quality})` uses ported constraints: audio `{echoCancellation, noiseSuppression, autoGainControl: true}`, video by quality preset: `auto` 720p30 (default), `data-saver` 360p15, `high` 1080p30.
- On `video: true` failing with `NotFoundError`/`OverconstrainedError`: retry with `{video: true}`. If that fails too: continue **audio-only** and show a toast. `NotAllowedError` → a permission help panel with per-browser steps. `NotReadableError` → "Camera is used by another app".
- `setMicEnabled(b)`: `track.enabled`.
- `setCamEnabled(false)`: `track.stop()`, then emit `{video: null}`. `setCamEnabled(true)`: acquire video only, then emit.
- `flipCamera()`: **stop the current video track first**, then `getUserMedia({video: {facingMode: {exact: next}}})`, falling back to `{ideal: next}`. Emit. Only show when ≥2 video inputs exist.
- `setDevice(kind, deviceId)`: for audioinput/videoinput, re-acquire that kind with `{deviceId: {exact}}`, stop the old track **after** success (desktop) or **before** (mobile — detect with `navigator.maxTouchPoints > 0`). Speaker: `videoEl.setSinkId(id)`, shown only if `'setSinkId' in HTMLMediaElement.prototype`.
- `devicechange` listener refreshes the device list. If the active device disappears, fall back to the default.
- `visibilitychange → visible`: if the cam should be on but `readyState === 'ended'` (iOS kills it in background), re-acquire and emit. The same for audio.
- `track.onended` (unplugged, OS revoked): same handling.
- Sender bitrate: on emit, the session sets `sender.setParameters()` (after `getParameters()`) with `encodings[0].maxBitrate`: auto 1.5 Mbps, data-saver 300 kbps, high 2.5 Mbps.
- Local preview mirrored (`scaleX(-1)`) only for the front camera (`facingMode === 'user'` or unknown on desktop).

### 6.12 Platform helpers (`core/platform/*`) — all feature-detected

- `wake-lock.ts`: request on `connected`; re-request on `visibilitychange → visible`; release on end. Silently no-op if unsupported.
- `pip.ts`: show the button only if `document.pictureInPictureEnabled`. Chrome: register `navigator.mediaSession.setActionHandler('enterpictureinpicture', …)` for automatic PiP when the tab is hidden (wrap in try/catch). Safari: set the `autopictureinpicture` attribute on the remote video.
- `media-session.ts`: handlers for `togglemicrophone`, `togglecamera` and `hangup` where supported (try/catch each). Call `setMicrophoneActive`/`setCameraActive` on change.
- `share.ts`: `navigator.share({title, text, url})` if available, else fall back to copy.
- `clipboard.ts`: `writeText` with a fallback of a selected `<textarea>` plus the "Press Ctrl/Cmd+C" hint. `readText` behind a "Paste" button. Always keep a visible textarea fallback (Safari/Firefox show their own paste prompt).

### 6.13 Settings (`core/settings/settings.ts`)

Key `tincan.settings.v1` in localStorage, with a typed schema, defaults and per-field validation on load (invalid → default). Wrap in try/catch (private mode).
```ts
{ stun: string[]; turn: {urls: string; username?: string; credential?: string; enabled: boolean}[];
  forceRelay: boolean; relayEnabled: boolean; relays: string[];
  quality: 'auto' | 'data-saver' | 'high'; startMicOn: boolean; startCamOn: boolean;
  preferredDevices: { audioinput?: string; videoinput?: string; audiooutput?: string };
  showStats: boolean; }
```
The Settings screen warns: "TURN passwords are stored unencrypted in this browser."

---

## 7. Relay mode (opt-in, Phase 6) — **NORMATIVE**

### 7.1 Link and keys
- The caller creates `secret` = 16 random bytes. Link: `<base URL>#r=<b64url(secret)>` (22 chars).
- HKDF-SHA-256 (WebCrypto) with `salt = utf8("tincan-relay-v1")`:
  - `roomTag = HKDF(secret, info = "room")` → 16 bytes → hex (32 chars). Public; relays can see it.
  - `key = HKDF(secret, info = "enc")` → AES-GCM-256 key. Never leaves the device.

### 7.2 Nostr events
- A throwaway Nostr keypair per page load (`nostr-tools` `generateSecretKey`, `finalizeEvent`).
- Event: `kind: 25050` (ephemeral range, so relays do not store it), `tags: [["x", roomTag]]`, `content: b64url(iv(12) ‖ AES-GCM ciphertext)`, `created_at: now`.
- Subscribe on all configured relays to `{kinds: [25050], "#x": [roomTag], since: now - 10}`. Ignore own pubkey, events older than `RELAY_MAX_EVENT_AGE_S`, decryption failures and duplicates (dedupe by event id).
- `nostr-tools` and the relay code load only via dynamic `import()` when relay mode is used.

### 7.3 Encrypted messages
```ts
type RelayMsg =
  | { v: 1; t: 'hello'; from: string /*16 hex instance id*/; ts: number }
  | { v: 1; t: 'offer';  from: string; to: string; sid: string; token: string }
  | { v: 1; t: 'answer'; from: string; to: string; sid: string; token: string }
  | { v: 1; t: 'bye'; from: string };
```

### 7.4 Room logic (`relay-room.ts`, a pure reducer, fully unit-tested)
- On join: publish `hello` every `RELAY_HELLO_INTERVAL_MS` until paired (after 10 min slow down to every 10 s; keep going until the user cancels).
- On a `hello` from another id while unpaired: `paired = id`; **role = caller if myId < theirId**, otherwise callee. Reply with one `hello` (rate limit 1 per 2 s) so late joiners see us.
- Caller: `createOffer()`, `sid` = 8 random hex chars. Publish `offer` every `RELAY_RESEND_MS` until a matching `answer` arrives or `ctl` opens.
- Callee: on an `offer` with `to == me` from `paired`: a new `sid` → (re)create the session, then publish the `answer`. A duplicate `sid` → republish the same `answer`.
- A `hello` from a third id while paired → ignore it, and show the toast "Someone else opened this link" once.
- On session `failed`: return to `waiting`, keep the local media, start the `hello` loop again, accept re-pairing with any id (a refreshed peer gets a new id). This is the auto-reconnect.
- `bye` → end the call; stay in the room only if the user taps "Wait for them to rejoin".
- No relay answers its subscription (no EOSE) within 8 s → show "Couldn't reach the relays" with a [Switch to manual invite] button.

### 7.5 Consent
Opening a `#r=` link while `relayEnabled === false` shows a dialog: what relays see (your IP address to the relay, timing, an encrypted blob) and what they don't (call contents, SDP, who you're calling). Buttons: [Allow for this call] [Cancel]. It is never stored silently.

---

## 8. UI specification

### 8.1 Screens and flow

State `screen` in the store: `home | lobby | create | join | in-call | ended | settings | about`. No router library. Push a `history` entry when entering `in-call` so the Android back button triggers "End call?" instead of closing the app.

**On load**: parse the fragment → `#o=` → `lobby` (role callee, offer stored); `#a=` → the tab-bridge flow (8.3); `#r=` → consent check → `lobby` (relay). Then `replaceState` to strip the fragment.

- **Home**: [Start a call] (primary), [Join with a code] (scan or paste), gear icon → Settings, info → About. An install hint for iOS (shown when not standalone): "Add to Home Screen" instructions.
- **Lobby** (permission requested here, never on page load): camera preview, mic/cam toggles, [Audio only] switch, device picker, mic level meter (an AnalyserNode bar), quality preset. A mode selector "Manual code | Automatic (relays)", defaulting to the setting. [Continue].
- **Create (caller, manual)**:
  1. Spinner "Finding network routes…" (≤3 s).
  2. "**Step 1 — Send this invite**": QR code (link), [Share], [Copy link], and a collapsible raw code. The age shows after 5 min; a warning appears after `OFFER_SOFT_EXPIRY_MS` with [New invite].
  3. "**Step 2 — Enter their reply**": [Scan reply QR], a paste textarea that auto-submits as soon as the content decodes as a valid answer, and a [Paste] button.
  4. "Connecting…", then in-call. Errors appear inline (`ErrorPanel`), with a retry action where it makes sense.
- **Join (callee, manual)**: after the Lobby → spinner → "**Send this reply back**": QR, [Share] (link `#a=`), [Copy], and "Waiting for <caller> to enter it…" → in-call.
- **Relay variant** of Create/Join: one screen: "Share this link" (caller) / "Connecting via relays…" (callee), then status lines (relays connected n/N → peer found → connecting).
- **In-call**: the remote video fills the stage (`object-fit: contain`; double-tap toggles cover). The local tile is in a corner (draggable to the 4 corners, snapping). Remote mic/cam-off indicators; when the remote cam is off, show an avatar placeholder. Top bar: quality dot, safety shield, timer. Bottom ControlBar: mic, cam, flip (only with ≥2 cams), end (red), and "more" (devices, PiP, stats HUD toggle, safety code). A "Reconnecting…" banner. The stats HUD is a translucent overlay showing route (LAN / direct / relay + IPv6), RTT, bitrate in/out, resolution and fps, loss, and codec.
- **Ended**: reason, duration, [New call], [Home]. For `failed`: the diagnostics message plus actions ([New invite], [Settings → TURN], docs link).
- **Settings**: STUN list, TURN list with [Test] (port the POC test: pass when a `relay` candidate appears within 5 s), force relay (disabled unless TURN is enabled), relay signaling toggle and relay list (with [Test] = connect + EOSE within 5 s), quality, default mic/cam, show stats, [Reset all].
- **About**: version, protocol version, **link to the source code repository (required by AGPL §13)**, license, privacy summary.

### 8.2 QR
- Generate with `qrcode.react` (`QRCodeSVG`, `level="M"`, with margin), encoding the **full link**, so phones' native camera apps also work.
- Scan: use `BarcodeDetector` if `'BarcodeDetector' in window` and it supports `qr_code`; otherwise use **jsQR in a Web Worker** (`qr-decode.worker.ts`, lazy-loaded). Camera via `getUserMedia({video: {facingMode: 'environment'}})`, scanning frames at ~8 fps from an offscreen canvas. Release the camera on close. Also support [Upload image]. **If the call's own camera is live, reuse that track for scanning on desktop; on mobile, stop the scan stream before returning to the call.**
- No WASM and no CDN fetches; everything is precached.

### 8.3 Tab bridge for answer links (`core/signaling/tab-bridge.ts`)
- The caller tab in `awaiting-answer` listens on `BroadcastChannel('tincan-bridge')`.
- A tab opened with `#a=<token>` posts `{t: 'answer', token}` and waits 700 ms for `{t: 'accepted'}` (sent by the caller tab only if the `offerRef` matches its pending offer).
  - Accepted → this tab shows "Done — go back to your call tab. You can close this one."
  - Not accepted → this tab shows: "Open Tincan where you started the call and paste this reply:" + the code + [Copy]. (Common on iOS, where the home-screen PWA and Safari don't share storage or channels. Document this in the README.)

### 8.4 i18n
`src/i18n/en.ts` exports a flat `const en = { 'home.start': 'Start a call', … } as const`. `t(key: keyof typeof en, params?)` does `{name}` interpolation. The locale is picked from `navigator.languages` (only `en` exists). Numbers and durations use `Intl`. The `<html lang>` is set from the locale.

### 8.5 Accessibility and polish
- Every icon button has `aria-label` and `title`; touch targets are ≥ 44px; focus rings are visible.
- An `aria-live="polite"` region announces connection state changes.
- Desktop keyboard shortcuts: `M` mic, `V` camera, `Ctrl/Cmd+D` hang up (with confirm), `S` stats.
- Respect `prefers-reduced-motion`. Dark theme only in v1. System font stack (no web fonts, no external requests).
- `safe-area-inset-*` padding for notches. Use `100dvh`, not `100vh`.

---

## 9. PWA, security and hosting

- **Vite**: `base: '/tincan-call/'` (from env `VITE_BASE`, default `/`, so forks and custom domains work). Remove the POC `allowedHosts`.
- **Dev on phones** needs HTTPS (getUserMedia and crypto.subtle require a secure context): add the script `dev:https` using `@vitejs/plugin-basic-ssl` and `--host`.
- **vite-plugin-pwa**: `registerType: 'prompt'`, `injectRegister: false`; register manually through `virtual:pwa-register/react` in `UpdatePrompt.tsx`. Show "Update available — Reload" **only when `screen` is not `in-call`/`create`/`join`**. Precache `**/*.{js,css,html,png,svg,webmanifest}` including the worker chunk.
- **Manifest**: `name`, `short_name: 'Tincan'`, `id: './'`, `start_url: './'`, `scope: './'`, `display: 'standalone'`, `background_color` and `theme_color` matching the dark theme, **no `orientation`**, icons 192/512 PNG plus a 512 maskable PNG. Generate them from one SVG with `@vite-pwa/assets-generator` (minimal-2023 preset), including `apple-touch-icon-180x180.png`.
- **CSP** (meta tag, since GitHub Pages can't set headers):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' wss:; worker-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'`.
  For e2e tests against the mock relay, the test build adds `ws://localhost:*` through a Vite env flag. Production never does.
- `<meta name="referrer" content="no-referrer">`.
- Frame busting: if `window.top !== window.self`, render only "Open Tincan directly" with a link (GitHub Pages can't send `frame-ancestors`).
- No analytics, no telemetry, no external fonts or CDNs. The only network requests are the app's own files, STUN/TURN (ICE), and relays (when enabled).
- **Threat model** (`docs/threat-model.md`): covers a passive network observer (DTLS-SRTP), a hostile chat channel (safety code), malicious relays (E2E-encrypted signaling; they still see IP and timing), a malicious peer (sees your IP; can't do anything beyond the protocol; all input validated), GitHub Pages compromise (out of scope; mention reproducible builds and release tags), and a third person with the relay link (room is locked to the first pair).

---

## 10. Testing strategy

### 10.1 Unit tests (Vitest, node environment, `test/unit/**`)
Required suites: base64url, crc32 (vector: `"123456789"` → `0xCBF43926`), token roundtrip plus every rejection path (too long, bad version, reserved bits, CRC, bad lengths, >12 candidates), sdp extract against **real** chrome/firefox/webkit fixtures, sdp build (snapshot plus priority math), candidate selection order and cap, SAS vectors and commit check, control-message guards (valid/invalid/oversize), stats parser (fixtures, deltas, Firefox "selected" variant), diagnostics table, settings load/validate/defaults, relay crypto (roundtrip; a wrong key fails), relay-room reducer (pairing, role, dedupe, resend, third peer, re-pair after failure), link parsing (`#o=`/`#a=`/`#r=`, chat text around the link). Coverage gate: **≥ 90% lines for `src/core/{encoding,token,sdp}` and `rtc/{sas,stats,diagnostics,control}`, and `relay-room`.**

### 10.2 E2E (Playwright, `test/e2e/**`)
- Chromium launch args: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--disable-features=WebRtcHideLocalIpsWithMdns`.
- Firefox prefs: `media.navigator.streams.fake: true`, `media.navigator.permission.disabled: true`, `media.peerconnection.ice.obfuscate_host_addresses: false`.
- Two browser contexts (or two browser types) in one test, against `vite preview` with an empty STUN list (loopback host candidates only, so CI is deterministic).
- Required `data-testid`s: `start-call`, `lobby-continue`, `invite-code`, `invite-link`, `reply-input`, `reply-code`, `call-state`, `remote-video`, `sas-code`, `btn-mic`, `btn-cam`, `btn-hangup`, `remote-mic-off`, `remote-cam-off`, `error-panel`, `ended-reason`.
- Scenarios:
  1. **manual-call**: chromium↔chromium. A starts; B opens A's link; A pastes B's reply; both reach `connected`; `remote-video` has `videoWidth > 0` and `currentTime` keeps advancing; `sas-code` is equal on both.
  2. **cross-browser**: chromium→firefox and firefox→chromium (same assertions). Try webkit↔chromium; if WebKit on Linux CI lacks WebRTC, mark it `test.fixme` with a comment and cover it in the manual matrix.
  3. **errors**: a truncated token → corrupt message; an answer pasted as an offer → kind message; a reply for a different invite → mismatch message.
  4. **media state**: A turns its cam off → B sees `remote-cam-off`; mic off → `remote-mic-off`.
  5. **hangup**: A hangs up → B shows `ended-reason` = remote hangup within 2 s.
  6. **audio-only**: A starts audio-only, B normal; connected; A turns its cam on mid-call → B's remote video gets frames.
  7. **relay** (Phase 6): a mock relay (`scripts/mock-nostr-relay.ts`, a ~80-line `ws` server implementing `EVENT`/`REQ`/`EOSE`/`CLOSE` and tag filtering) — both open the `#r=` link → connected; then A reloads → auto-reconnect → connected again.
  8. **offline** (Phase 5): load, `context.setOffline(true)`, reload → the app shell renders; two contexts still connect over loopback.

### 10.3 Manual device matrix (`docs/testing.md`; run before every release)
Devices: iPhone (Safari tab + home-screen PWA), Android (Chrome tab + installed PWA), desktop Chrome, Firefox, Safari.
Scenarios per pair (at minimum iOS↔Android, iOS↔desktop Firefox, Android↔desktop Safari): same Wi-Fi; Wi-Fi↔4G; 4G↔4G; offline phone hotspot (no internet); rotate the phone mid-call (remote aspect is correct, no crop); flip the camera; connect a Bluetooth headset mid-call; background the app for 30 s on iOS and return (camera recovers); toggle airplane mode for 5 s (reconnect behaviour as specified); PiP; wake lock (screen stays on for 5 min); a 30-minute soak (no memory growth > 50 MB, no audio drift); the iOS answer-link → paste fallback; installing the PWA; offline launch.

---

## 11. CI/CD

- `ci.yml` (PRs and main): `pnpm install --frozen-lockfile` → `lint` (ESLint flat config + typescript-eslint + react-hooks) → `typecheck` (`tsc --noEmit`) → `test` (vitest with coverage gate) → `playwright install --with-deps chromium firefox webkit` → `e2e` → `build` → bundle budget check (`scripts/check-size.mjs`: initial JS ≤ 180 KB gzip; the relay chunk is excluded).
- `deploy.yml` (push to main, and tags): build with `VITE_BASE=/tincan-call/`, then `actions/upload-pages-artifact` + `actions/deploy-pages`.
- Dependabot weekly (npm + github-actions), grouped minor/patch.
- Pin exact versions in `package.json` (no `^`) for reproducible builds. The lockfile is committed.
- TypeScript **6.0.x** (typescript-eslint currently supports `<6.1`; do **not** use TS 7).

---

## 12. Implementation phases (9 phases: Phase 0 – Phase 8)

Each phase ends with a commit, and all previous acceptance criteria still pass.

### Phase 0 — Repository bootstrap
1. Copy everything except `PLAN.md` to `../tincan-poc/` (reference only), then delete it here. Move `PLAN.md` to `docs/PLAN.md`.
2. `git init`, set the default branch `main`, add `.gitignore` (node_modules, dist, coverage, playwright-report, test-results, .env*).
3. Scaffold Vite 8 + React 19 + TS 6.0.x (strict flags from Rules §3) + Tailwind 4 (`@tailwindcss/vite`), plus ESLint 9 flat config, Prettier, Vitest, Playwright config (projects: chromium, firefox, webkit) and zustand.
4. Scripts: `dev`, `dev:https`, `build`, `preview`, `lint`, `typecheck`, `test`, `test:watch`, `e2e`, `capture-fixtures`.
5. A placeholder `App.tsx` showing APP_NAME. `config.ts`, `i18n/` skeleton.
6. Add LICENSE (AGPL-3.0 full text), README stub, CODE_OF_CONDUCT (Contributor Covenant 2.1), CONTRIBUTING, SECURITY (private vulnerability reporting through GitHub Security Advisories), issue/PR templates, dependabot, `ci.yml` and `deploy.yml`.

**Acceptance criteria:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass; one trivial Playwright test (page title) passes on chromium and firefox; `dist/` assets reference the `/tincan-call/` base when `VITE_BASE` is set.

### Phase 1 — Pure core: encoding, token, SDP, SAS, control, stats, diagnostics, settings
1. Implement `core/encoding/*`, `core/token/token.ts` (6.3), `core/sdp/{extract,build,candidates}.ts` (6.4, 6.5), `core/rtc/{sas,control,stats,diagnostics}.ts` (6.7–6.10; sas.ts is pure given inputs), `core/settings/settings.ts` (6.13), and `core/signaling/link.ts` (fragment parse/build, input extraction regex).
2. `scripts/capture-sdp-fixtures.ts`: launch chromium, firefox and webkit with Playwright; in each, create a PC with a negotiated DC, `setLocalDescription()`, wait for gathering, and save the offer SDP; also produce an answer against a chromium offer. Write to `test/fixtures/sdp/`. Commit the fixtures.
3. Cross-engine **fixture round trip** test: extract(chrome offer) → encode → decode → build → string-compare the key attributes; also `extract(build(x))` deep-equals `x`.

**Acceptance criteria:** all unit suites listed in 10.1 for these modules pass, the coverage gate passes, and no DOM imports exist in `src/core/{encoding,token,sdp}` (add an ESLint `no-restricted-globals`/`no-restricted-imports` rule for `src/core/**` banning `react` and `window`/`document`, except in `platform/` and `media/`).

### Phase 2 — CallSession engine + debug harness
1. `gather.ts`, `negotiation.ts` (MDN perfect negotiation), `call-session.ts` (6.6), `ice-config.ts` (6.2, from settings).
2. `src/debug.html` + `src/debug.tsx` (built only in dev and test; excluded from the production build): two buttons and textareas to drive caller/callee, with `<video>` elements, raw state and SAS. Use fake tracks from a `canvas.captureStream()` + `AudioContext` oscillator when `?fake=1`.
3. Save one `getStats()` dump per browser to `test/fixtures/stats/` from the e2e run and add tests for them.

**Acceptance criteria:** Playwright scenarios 1, 2 (chromium↔firefox both directions), 4, 5 pass **against the debug harness**. The SAS codes match. Calling `hangup()` leaves no live tracks or open PCs (assert `pc.connectionState === 'closed'` and the absence of timers via an exposed debug counter).

### Phase 3 — MediaController + platform helpers
1. `core/media/*` (6.11), `core/platform/*` (6.12).
2. Wire it into the debug harness: mic/cam toggles, flip, device selects, audio-only start.

**Acceptance criteria:** e2e scenario 6 passes on the harness; unit tests for the quality presets → constraints mapping; a manual check on one Android and one iPhone over the HTTPS dev server: flip camera, cam off turns the camera light off, background/foreground recovery on iOS. Report results in the phase summary.

### Phase 4 — Real UI
1. `state/store.ts` (zustand): `screen`, `role`, `mode`, session state mirror, local/remote media state, telemetry, sas, errors, toasts, settings. Actions call into MediaController/CallSession.
2. All screens and components in 8.1–8.5, the QR generate/scan (8.2), the tab bridge (8.3), share/clipboard, error panels with diagnostics, the stats HUD, the safety code UI, `beforeunload`, the back-button handling and keyboard shortcuts.
3. Move the e2e scenarios 1–6 from the debug harness to the real UI (using the `data-testid`s).

**Acceptance criteria:** e2e 1–6 pass on the real UI (chromium, firefox, cross). Lighthouse (CLI in CI or manual) Accessibility ≥ 95. No hardcoded user-facing strings (`grep` check: JSX text nodes in `src/ui/**` other than `{t(...)}` fail a lint rule — use `eslint-plugin-i18next` `no-literal-string` in `jsx-text-only` mode). Manual: a full call phone↔laptop using only QR codes in the same room.

### Phase 5 — PWA, offline and hardening
1. Section 9: manifest, icons, SW prompt-update, CSP, referrer, frame-busting, fragment stripping audit.
2. iOS "Add to Home Screen" hint; offline indicator; an `About` page with the source link.

**Acceptance criteria:** e2e scenario 8 passes; Lighthouse installability passes; Chrome DevTools shows no CSP violations during a full call; an update test (deploy build A, open the app, start a call, deploy build B) shows **no** reload during the call and offers the update after hangup (manual, documented in `docs/testing.md`).

### Phase 6 — Relay mode
1. `scripts/relay-smoke.ts` (Node): for each relay in `DEFAULT_RELAYS`, publish a kind-25050 event with an `x` tag and check that a second connection receives it. Update `DEFAULT_RELAYS` to the ones that pass (keep ≥3).
2. `relay-crypto.ts`, `relay-room.ts` (pure reducer), `nostr-transport.ts` (lazy, `nostr-tools` `SimplePool`), the Settings relay section, the consent dialog, Lobby mode selector and the relay screens.
3. `scripts/mock-nostr-relay.ts` and e2e scenario 7.

**Acceptance criteria:** the relay-room reducer is at ≥ 90% coverage; e2e 7 passes (including auto-reconnect after a reload); the bundle check confirms `nostr-tools` is **not** in the initial chunk; a manual call between two phones on different networks through public relays works.

### Phase 7 — TURN, force-relay, diagnostics UX
1. The Settings TURN editor + [Test], force relay, the 5 s gather timeout when TURN is configured.
2. Diagnostics wired into the Ended/failed screen.
3. `docs/turn.md`: coturn on a $5 VPS (Docker compose, `static-auth-secret` vs long-term creds, ports 3478/udp+tcp, 5349 TLS, relay port range, firewall), hosted alternatives (Cloudflare Realtime TURN, Metered) with a note that free-tier keys must never be committed.

**Acceptance criteria:** with a local coturn in Docker (documented in `docs/testing.md`), a call with `forceRelay` connects and the HUD shows `relay`; with a bogus TURN, the diagnostics key `turn-failed` is shown.

### Phase 8 — Release v1.0.0
1. The full manual device matrix (10.3). File issues for failures; fix the blockers.
2. Docs: README (pitch, a screenshot/GIF, how it works diagram, limitations from §1, privacy summary, self-hosting/forking with `VITE_BASE`, development), PRIVACY.md, `docs/protocol.md` (copy the normative sections), `docs/threat-model.md`, CHANGELOG.
3. A security pass: run `pnpm audit`, re-read all input validation paths, confirm no tokens are ever logged (debug logging is off in production builds).
4. Tag `v1.0.0`, create a GitHub Release with notes, enable GitHub Pages, and add repo topics (`webrtc`, `p2p`, `pwa`, `video-call`, `serverless`, `nostr`).

**Acceptance criteria:** every box in `docs/testing.md` is ticked or has a linked issue labelled `known-limitation`; CI is green on the tag; the live URL works on all 5 target platforms.

---

## 13. Known risks and mitigations

| Risk | Mitigation |
|---|---|
| A browser rejects the synthetic SDP (e.g. a missing attribute) | Phase 1 fixtures from all 3 engines plus Phase 2 cross-engine e2e catch it early. If WebKit needs an extra attribute, add it to the template and to `protocol.md`, bumping the token version only if the *token* changes. |
| A browser emits a non-UUID mDNS hostname | Those candidates are dropped; srflx/host IPs still work. Logged in debug mode. |
| The NAT mapping goes stale if the invite sits for minutes | Peer-reflexive discovery usually rescues it. The soft-expiry warning plus [New invite]. |
| Public Nostr relays drop ephemeral events or rate-limit | Several relays in parallel, resends, the smoke script before release, the editable list, the fallback button to manual mode. |
| iOS Safari quirks (autoplay, background camera kill, separate PWA storage) | Specific handling in 6.11, 8.3 and the Rules; the manual matrix covers them. |
| The SW update breaks a call | `prompt` mode, offered only outside calls. |
| Scope creep from chat/files/screen share | Explicitly out of v1. The control protocol ignores unknown `t`, so they can be added later as new message types without breaking v1 peers. |

---

## 14. Post-v1 backlog (not now)
Text chat and file transfer (binary DC with streams to the File System Access API/OPFS), screen share (desktop), small mesh groups (≤4), saved contacts with persistent DTLS certs, a "restart token" for manual-mode reconnection without a full re-handshake, more relay transports (WebTorrent trackers), translations, light theme, a Document PiP mini-UI.
