/**
 * The live-DOM suite's configuration — RRR §9's "Live DOM" row, and the only test
 * runner in this project that is not vitest.
 *
 * Two rules shape everything here:
 *
 * 1. **It must never run as part of `pnpm run test`.** RRR §9 requires the live
 *    suite to be a separate script that CI may skip. That is enforced twice over
 *    and neither half is redundant: `vitest.config.ts` excludes `test/live/**`, and
 *    the specs are named `*.spec.ts` while vitest only collects `*.test.ts`. Either
 *    alone would do it; both together mean the accident of moving a file or editing
 *    a glob does not silently pull a network-dependent, 30-second suite into the
 *    suite that has to pass on every commit. `test/live/youtube.spec.ts` asserts
 *    both facts, so this paragraph cannot quietly stop being true.
 * 2. **Chromium, headless, and nothing else.** RRR §2 settles Chromium. Headless is
 *    not a preference: this project's autonomous sessions must never open a GUI
 *    window or raise a dialog (CLAUDE.md), and a headed browser is exactly that.
 *    Safari is not an option at all — Playwright cannot drive a Safari extension —
 *    which is why this suite tests DOM and CSS placement and deliberately never
 *    touches `webkitSetPresentationMode`. See `test/live/player.ts` for what that
 *    does and does not buy.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/live',

  // `*.spec.ts`, against vitest's `*.test.ts`. Rule 1's second half.
  testMatch: /.*\.spec\.ts$/,

  // One worker, in order. The run-count test measures a ten-second wall-clock window
  // of real video playback, and a second browser decoding video on the same machine
  // is a confounder that would show up as an unexplained number rather than as a
  // failure. Parallelism would save fifteen seconds and cost the measurement.
  fullyParallel: false,
  workers: 1,

  // No retries, deliberately. A retried flake reports green, and the whole argument
  // for keeping this suite out of `pnpm run test` is that its flakiness is real and
  // should be *visible* — as a failure to read, or as an explicit skip with a
  // reason, never as a quiet second attempt.
  retries: 0,

  // A live page load plus two ten-second measurement windows plus a baseline pass.
  timeout: 180_000,

  reporter: [['list']],

  use: {
    browserName: 'chromium',
    headless: true,

    // Explicit, and every test sets its own again per width mode. DECISIONS 9: an
    // unsized or hidden viewport makes the player collapse to `ytp-tiny-mode` and
    // hide its buttons, and every measurement then reads zero — which looks like a
    // pass, not a failure. There is no default worth inheriting here.
    viewport: { width: 1280, height: 800 },

    launchOptions: {
      args: [
        // The run count needs the video actually playing, and a headless browser
        // has no user gesture to offer. Nothing else in the suite depends on it.
        '--autoplay-policy=no-user-gesture-required',
      ],
    },

    // The two things worth having when a live-page test fails at 3 a.m. and the page
    // it failed against no longer exists.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
