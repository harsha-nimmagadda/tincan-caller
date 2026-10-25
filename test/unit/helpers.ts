import type { Token } from '../../src/core/token/types';

export const fp = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
export const offer: Token = {
  kind: 'offer',
  setup: 'actpass',
  mid: '0',
  ufrag: 'PQpP',
  pwd: 'VUUi0OhmwFt352QKFBnHdBgf',
  sessId: '154376669258529379',
  sessVersion: 2,
  fingerprint: fp,
  candidates: [
    { type: 'host', family: 'ipv4', address: '192.168.1.20', port: 50000 },
    {
      type: 'host',
      family: 'mdns',
      address: '2dcfdaed-d6b5-4c98-8d5c-80d597e2a4be.local',
      port: 39058,
    },
    { type: 'srflx', family: 'ipv4', address: '203.0.113.9', port: 61000 },
    { type: 'host', family: 'ipv6', address: '2001:db8::1', port: 40000 },
    { type: 'relay', family: 'ipv4', address: '198.51.100.7', port: 3478 },
  ],
};
export const answer: Token = {
  ...offer,
  kind: 'answer',
  setup: 'active',
  mid: 'data',
  commit: Uint8Array.from({ length: 16 }, (_, i) => i),
  offerRef: Uint8Array.of(1, 2, 3, 4),
};
