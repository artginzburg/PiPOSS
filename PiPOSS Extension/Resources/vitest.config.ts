import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    // The live-DOM Playwright suite (RRR §9) lives under test/live and is never
    // part of `pnpm run test`.
    exclude: ['test/live/**'],
  },
});
