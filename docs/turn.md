# TURN servers for Tincan

Roughly 10–20% of network pairs (mobile carrier NAT, corporate firewalls) cannot connect directly. A **TURN** server relays the call for them. Tincan does not bundle one: you bring your own and enter it in **Settings → TURN server**. Use **Test** to check it, and **Force relay** to hide your IP address from the other person (all media then flows through your server).

Media stays end-to-end encrypted (DTLS-SRTP) even through TURN; the server sees only encrypted packets, their size and timing, and both IP addresses.

> **Never commit TURN credentials** (not in this repo, not in a fork). Anything entered in Settings is stored unencrypted in that browser's localStorage.

## Self-host coturn (a ~$5 VPS)

Ports to open in the firewall: **3478 udp+tcp** (TURN), **5349 tcp** (TURN over TLS, optional), and the **relay range 49152–49999 udp**.

`docker-compose.yml`:

```yaml
services:
  coturn:
    image: coturn/coturn:latest
    network_mode: host # TURN needs the real public IP and many UDP ports
    restart: unless-stopped
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
      # for TLS: - /etc/letsencrypt:/etc/letsencrypt:ro
```

`turnserver.conf`:

```ini
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=49999
realm=turn.example.com
server-name=turn.example.com
fingerprint
no-cli
no-multicast-peers
# Do not let callers reach your private network through the relay:
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
# external-ip=<public IP>        # needed when the VPS is behind NAT (most clouds)
# cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

### Credentials: pick one

- **Long-term credentials** (simplest, one shared login): add
  `lt-cred-mech` and `user=alice:a-long-random-password`. Enter that username/password in Tincan's Settings. Anyone who gets the password can use your bandwidth, so use a long random one and rotate it.
- **Time-limited credentials** (`static-auth-secret`): add `use-auth-secret` and `static-auth-secret=<long random>`. Credentials are derived per user: username = `<unix expiry>:<name>`, password = `base64(HMAC-SHA1(secret, username))`. Better for sharing with several people, but you must generate the pair yourself (a one-line script) before entering it in Settings.

Then in Tincan: `turn:turn.example.com:3478` (or `turns:turn.example.com:5349` for TLS, which also passes strict firewalls that only allow 443/5349), your username and password, **Test**.

## Hosted alternatives

- **Cloudflare Realtime TURN** and **Metered** offer free tiers. Create a key in their dashboard and use the generated username/credential in Settings.
- Free-tier keys are secrets with your quota attached: keep them out of git, screenshots and bug reports.

## Troubleshooting

| Symptom                                           | Likely cause                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| **Test** fails                                    | Wrong address or login; UDP 3478 blocked; `external-ip` missing behind NAT |
| **Test** passes but calls with Force relay fail   | The relay port range is not open in the firewall                           |
| Calls fail with "Your TURN server didn't respond" | The server is down or the credentials expired                              |
