import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      // Phase 1 adds the >=90% gate for encoding, token, sdp, rtc/{sas,stats,diagnostics,control}.
    },
  },
});
