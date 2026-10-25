import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      // §10.1 gate.
      thresholds: {
        'src/core/encoding/**': { lines: 90 },
        'src/core/token/**': { lines: 90 },
        'src/core/sdp/**': { lines: 90 },
        'src/core/rtc/{sas,stats,diagnostics,control}.ts': { lines: 90 },
        'src/core/signaling/relay/relay-room.ts': { lines: 90 },
      },
    },
  },
});
