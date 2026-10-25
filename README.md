# Tincan

Serverless, peer-to-peer 1:1 video calling PWA. No accounts, no backend: you exchange a small invite
link or QR code and the call goes directly between the two browsers.

> **Status:** under development (Phase 0 of [docs/PLAN.md](docs/PLAN.md)). Not usable yet.

## Limitations (by design)

1. **No ringing.** Without a server nothing can wake a closed app, so both people must have Tincan open.
2. **Some networks need TURN.** About 10–20% of network pairs (mobile carrier NAT, corporate firewalls) cannot connect directly. Without a bring-your-own TURN server those calls fail.
3. **Peers see each other's IP address** (inherent to P2P). "Force relay" hides it but needs TURN.
4. **Manual mode cannot auto-reconnect** after a network change; start a new invite.

## Development

Requires Node 24 and pnpm.

```bash
pnpm install
pnpm dev          # dev server
pnpm dev:https    # HTTPS on the LAN, for testing on phones
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm e2e          # Playwright (run `pnpm exec playwright install` once)
```

Forks or custom domains: set `VITE_BASE` (e.g. `VITE_BASE=/tincan-call/ pnpm build`).

## License

[AGPL-3.0-only](LICENSE). If you run a modified version as a network service, you must offer its source to its users.
