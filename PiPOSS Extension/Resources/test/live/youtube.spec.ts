/**
 * RRR §5.1 and the second half of §5.3, in a browser that actually does layout.
 *
 * `pnpm run test:live`. Never `pnpm run test` — see `playwright.config.ts` for the two
 * independent mechanisms that keep it out, both asserted below.
 *
 * jsdom never lays anything out, so `getBoundingClientRect()` there is `0×0` for everything.
 * RRR §5.1 is about *rendered* geometry and §5.3's "≤ 60 runs over 10 s of playback" is about
 * live churn, so neither has a jsdom answer; everything else about the YouTube module is
 * measured in `test/youtube.test.ts`, which runs on every commit.
 *
 * **This suite is not the guard for §5.1; it is the reality check on it.**
 * `test/youtube.test.ts` asserts the *cause* — the module writes no inline style anywhere in
 * the player subtree — with no network and no YouTube. This file asserts the *effect* and is
 * allowed to skip. That is why every skip path prints a reason instead of quietly passing: a
 * suite that reports success when it measured nothing is worse than no suite.
 *
 * The bundle is injected the way a content script actually loads — at document start, in an
 * **isolated world**. `test/live/player.ts`'s header explains why that is load-bearing, and one
 * test here pins it, because a main-world harness produced a confident false finding once.
 */
import { readFileSync } from 'node:fs';

import { type Page, expect, test } from '@playwright/test';

import {
  type ContentScriptWorld,
  FIXTURE_URL,
  LIVE_URL,
  MEASUREMENT_WINDOW_MS,
  OURS,
  PIP_BUTTON,
  PLAYER,
  RUN_BUDGET,
  RUN_COUNTER_INIT,
  SIBLING,
  TOLERANCE_PX,
  WEBKIT_SPY_INIT,
  WIDTH_MODES,
  YOUTUBE_MODULE,
  applyLegacyGeometry,
  assertProductionWorld,
  bundleSource,
  captureListenerFires,
  enterFixtureMode,
  injectAsContentScript,
  measure,
  readCounters,
  requireBundle,
  servePlayerFixture,
  setModeCalls,
  skipWithReason,
  waitForLiveMode,
  waitForMountedButton,
  witnessClick,
} from './player';

/**
 * The captured player, served under YouTube's own hostname so the shipped bundle recognises it
 * (RRR §4.5 keys on `location.hostname`), with no network behind it. The deterministic half of
 * the suite: it reaches all three width modes on demand and works on a disconnected machine.
 */
test.describe('the geometry invariant, on the captured player (RRR §5.1)', () => {
  test.beforeEach(requireBundle);

  for (const mode of WIDTH_MODES) {
    test(`our glyph box equals the neighbour's in ${mode.name} width mode`, async ({ page }) => {
      await servePlayerFixture(page);
      await page.setViewportSize(mode.viewport);
      await page.goto(FIXTURE_URL);
      await waitForMountedButton(page);

      // The mode is established *and witnessed* before anything is measured: the reference
      // button's computed padding must change with the mode, which is the fixture's own CSS
      // rule responding. A renamed class or changed selector then fails here instead of
      // measuring the default mode three times and reporting "all three modes pass".
      const defaultPadding = await enterFixtureMode(page, WIDTH_MODES[0]);
      const padding = await enterFixtureMode(page, mode);

      if (mode.playerClass === null) {
        // Nothing to distinguish it from, so the weaker statement: the captured CSS contract is
        // live at all. Not an absolute expectation — just "not unstyled".
        expect(padding, 'the captured CSS contract applies to the reference glyph').not.toBe('0px');
      } else {
        expect(
          padding,
          `${mode.playerClass} must actually change the geometry contract, or this ` +
            'test is silently measuring the default mode',
        ).not.toBe(defaultPadding);
      }

      const measured = await measure(page);
      report(mode.name, padding, measured);

      // DECISIONS 9: in an unsized or hidden viewport the player hides its buttons and every box
      // reads zero, at which point `|0 - 0| <= 1` passes and the suite reports success having
      // measured nothing. Both boxes are asserted to exist before they are compared.
      expect(measured.ours.width, 'our glyph must be rendered, not hidden').toBeGreaterThan(0);
      expect(measured.ours.height, 'our glyph must be rendered, not hidden').toBeGreaterThan(0);
      expect(measured.sibling.width, 'the reference glyph must be rendered').toBeGreaterThan(0);
      expect(measured.sibling.height, 'the reference glyph must be rendered').toBeGreaterThan(0);

      // The invariant itself: equality with a neighbour, never a pixel value (DECISIONS 11, 121).
      expect(measured.deltaWidth, `${OURS} vs ${SIBLING} width`).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(measured.deltaHeight, `${OURS} vs ${SIBLING} height`).toBeLessThanOrEqual(
        TOLERANCE_PX,
      );
    });
  }

  test('the button is placed where its own priority says, next to the reference', async ({
    page,
  }) => {
    await servePlayerFixture(page);
    await page.goto(FIXTURE_URL);
    await waitForMountedButton(page);

    // Which is also what makes `.ytp-size-button` the honest thing to compare against
    // (DECISIONS 135): after placement it is PiP's immediate next sibling, so the comparison is
    // between two glyphs in the same box rather than two arbitrary controls.
    const next = await page.evaluate(
      (selector) => document.querySelector(selector)?.nextElementSibling?.className ?? null,
      PIP_BUTTON,
    );

    expect(next).toContain('ytp-size-button');
  });

  /**
   * The canary: proof that the assertion above can fail. Without it, "all three modes pass" is
   * indistinguishable from "the comparison is vacuous" (DECISIONS 11). So the pre-T06 write is
   * re-applied to our glyph — the real bug from `docs/research/youtube-player-2026-07.md`,
   * `padding: calc(pill - 6px) 6px` with `box-sizing: border-box` — and the comparison must
   * notice.
   */
  test('the comparison detects the pre-T06 geometry write (canary)', async ({ page }) => {
    await servePlayerFixture(page);
    await page.goto(FIXTURE_URL);
    await waitForMountedButton(page);

    const before = await measure(page);
    expect(before.deltaWidth).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(before.deltaHeight).toBeLessThanOrEqual(TOLERANCE_PX);

    await applyLegacyGeometry(page);
    const after = await measure(page);

    console.log(
      `canary: healthy ${box(before.ours)} vs ${box(before.sibling)}; ` +
        `with the pre-T06 write ${box(after.ours)} vs ${box(after.sibling)}`,
    );

    const noticed = after.deltaWidth > TOLERANCE_PX || after.deltaHeight > TOLERANCE_PX;

    expect(noticed, 'the ±1 px comparison must reject the bug it exists to catch').toBe(true);
  });

  /**
   * The click path on a plain player, as the control for the live test of the same property.
   * `test/youtube.test.ts` covers this in jsdom (DECISIONS 123); it is worth having here too
   * because the pair — a plain `<div>` player and YouTube's real one, same browser, same
   * assertion — is what makes the live result interpretable rather than merely green.
   */
  test('our capture listener answers the click and lets nothing else answer it', async ({
    page,
  }) => {
    await servePlayerFixture(page);
    await page.goto(FIXTURE_URL);
    await waitForMountedButton(page);

    const ran = await witnessClick(page);

    // `body-capture` is above the player, so it runs before us and must still run — it is what
    // distinguishes "we suppressed the rest" from "the click never landed".
    expect(ran).toEqual(['body-capture']);
  });
});

/**
 * The two facts that keep this file out of `pnpm run test` (RRR §9), plus the one that keeps the
 * run counter honest. All three are cheap, and all three are things a later edit could break
 * with no other test noticing.
 */
test.describe('the suite’s own boundaries', () => {
  test('vitest excludes test/live and collects only *.test.ts', () => {
    const config = readFileSync(new URL('../../vitest.config.ts', import.meta.url), 'utf8');

    expect(config).toContain("exclude: ['test/live/**']");
    expect(config).toContain("include: ['test/**/*.test.ts']");
  });

  test('package.json exposes the live suite only as `test:live`', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts['test:live']).toContain('playwright test');
    expect(manifest.scripts.test).not.toContain('playwright');
  });

  /**
   * The run counter matches on a selector string that the module it counts also owns, and
   * nothing but this test connects the two copies. A mismatch does not fail — it counts zero,
   * and `attributed <= 60` then passes having measured nothing, which is the precise shape of a
   * test that lies. So the constant is read out of the module and compared, and the run count
   * carries a lower bound as well.
   */
  test('the counted selector is the one src/sites/youtube.ts queries', () => {
    const module = readFileSync(YOUTUBE_MODULE, 'utf8');

    expect(module).toContain(`const PLAYER = '${PLAYER}';`);
    expect(RUN_COUNTER_INIT).toContain(`selector === '${PLAYER}'`);
  });

  /**
   * The harness's own injection world, asserted **offline**, because the live version below lives
   * behind the network and a guard that skips on a disconnected machine leaves a reverted
   * `worldName` unguarded — the same shape as the defect it prevents.
   *
   * The three DOM-wrapper readings cannot catch that here: a plain `<div>` has no expandos in
   * *either* world, so they read the same in both. What catches it is `frameClaimed` —
   * `claimFrame()` sets its flag on the content script's own global and globals are per-world, so
   * present in ours and **absent from the page's** states directly which world the bundle's
   * top-level code ran in. Asserted both ways; the wrapper *contrast* is live-only.
   */
  test('the bundle runs in an isolated world (offline, on the captured player)', async ({
    page,
  }) => {
    requireBundle();

    const world = await servePlayerFixture(page);
    await page.goto(FIXTURE_URL);
    await waitForMountedButton(page);

    const { isolated, page: main } = await assertProductionWorld(world);
    const fires = await captureListenerFires(world, 'isolated', PLAYER);

    console.log(
      `fixture, isolated world: frameClaimed=${String(isolated.frameClaimed)} ` +
        `ownAddEventListener=${String(isolated.ownAddEventListener)} ` +
        `ownKeys=${isolated.ownKeys} native=${String(isolated.nativeAddEventListener)} ` +
        `captureListenerFires=${String(fires)}; page world: frameClaimed=` +
        `${String(main.frameClaimed)} ownKeys=${main.ownKeys} (a plain <div> has no expandos ` +
        'in either world, which is why the wrapper contrast is a live-only assertion)',
    );

    // The two that actually pin the world, and the reason this runs without a network at all.
    expect(isolated.frameClaimed, 'the bundle’s top-level code ran in our world').toBe(true);
    expect(main.frameClaimed, 'and not in the page’s — globals are per-world').toBe(false);

    expect(isolated.ownAddEventListener, 'a content script sees no expandos').toBe(false);
    expect(isolated.nativeAddEventListener, 'the inherited prototype method').toBe(true);
    expect(isolated.ownKeys, 'no own properties visible from our world').toBe(0);
    expect(fires, `a capturing listener on ${PLAYER} fires in our world`).toBe(true);
  });

  /**
   * The same fact against YouTube's real player, where it has teeth: they graft hundreds of own
   * properties onto `#movie_player`, `addEventListener` among them, and a registration made
   * through *that* function never reaches the DOM. The page-world half is what only a live page
   * can give, and what proves the two worlds really differ — without it, a `worldName` silently
   * falling back to the page's context would look like a pass.
   */
  test('the bundle runs in an isolated world, as it does in Safari', async ({ page }) => {
    requireBundle();

    const world = await openLiveWatchPage(page);

    const { isolated, page: main } = await assertProductionWorld(world);
    const fires = {
      isolatedPlayer: await captureListenerFires(world, 'isolated', PLAYER),
      pagePlayer: await captureListenerFires(world, 'page', PLAYER),

      // The control, and it has to be a node *above* the player: our own capture listener is on
      // the player and calls `stopPropagation`, so a page-world probe anywhere below it comes
      // back `false` for **our** reason rather than the interesting one — the same trap that
      // produced the false finding this test prevents, one level down. `body` runs before us, so
      // a `false` there can only mean the probe itself is broken.
      pageBody: await captureListenerFires(world, 'page', 'body'),
    };

    console.log(
      [
        'the player element, from each world:',
        `  the bundle's top-level code ran in: ours=${String(isolated.frameClaimed)} ` +
          `page=${String(main.frameClaimed)}`,
        `  isolated (ours):  ownAddEventListener=${String(isolated.ownAddEventListener)} ` +
          `ownKeys=${isolated.ownKeys} native=${String(isolated.nativeAddEventListener)} ` +
          `captureListenerFires=${String(fires.isolatedPlayer)}`,
        `  page (YouTube’s): ownAddEventListener=${String(main.ownAddEventListener)} ` +
          `ownKeys=${main.ownKeys} native=${String(main.nativeAddEventListener)} ` +
          `captureListenerFires=${String(fires.pagePlayer)}`,
        `  control: from the page world a capturing listener on body fires: ` +
          `${String(fires.pageBody)} — so the page world can register listeners and the ` +
          'synthetic click really propagates; only the player swallows the registration',
      ].join('\n'),
    );

    expect(isolated.frameClaimed, 'the bundle’s top-level code ran in our world').toBe(true);
    expect(main.frameClaimed, 'and not in the page’s — globals are per-world').toBe(false);

    // Our world: an ordinary DOM element, which is why T06's choice of the player in the capture
    // phase is correct and stays.
    expect(isolated.ownAddEventListener, 'no expandos are visible to a content script').toBe(false);
    expect(isolated.nativeAddEventListener, 'the inherited prototype method').toBe(true);
    expect(isolated.ownKeys, 'no own properties visible from our world').toBe(0);
    expect(fires.isolatedPlayer, `a capturing listener on ${PLAYER} fires in our world`).toBe(true);

    // The page's world: the opposite on every count — the evidence that the isolated world is
    // real rather than a silent fallback.
    expect(main.ownAddEventListener, 'YouTube’s expando is there in the page world').toBe(true);
    expect(main.ownKeys, 'YouTube’s JS Player API, as own properties').toBeGreaterThan(100);
    expect(fires.pagePlayer, 'the same registration is swallowed in the page world').toBe(false);
    expect(fires.pageBody, 'the control: the page world can register a listener at all').toBe(true);
  });
});

/**
 * A real watch page. Everything here may skip, loudly.
 *
 * The half that can be wrong about YouTube — the network, an A/B layout, a bot interstitial, a
 * video that stops being public — and the only half that can measure the player's own width-mode
 * logic and the churn RRR §5.3's number depends on. It never clicks a consent or sign-in dialog:
 * agreeing to terms on the owner's behalf is not this suite's business, so an interstitial is a
 * skip with the reason quoted.
 */
test.describe('a real watch page', () => {
  test.beforeEach(requireBundle);

  test('the invariant holds against today’s YouTube', async ({ page }) => {
    await openLiveWatchPage(page);

    const established: string[] = [];

    for (const mode of WIDTH_MODES) {
      await page.setViewportSize(mode.viewport);

      // The mode we are in is the mode the *player* says we are in, polled until it settles —
      // never the mode we inferred from a viewport width (DECISIONS 9).
      const { inMode, classes } = await waitForLiveMode(page, mode);

      if (!inMode) {
        // Measured 2026-07-28: the player answers 1280×800 and everything wider with
        // `ytp-large-width-mode`, and stays there at 2560, 3840, 5120, 7680 and in theater mode
        // with a 3840 px-wide player. `ytp-big-mode` is not reachable on a watch page by
        // resizing at all — real fullscreen on a large display is the remaining candidate, and
        // an autonomous agent must not put a browser into fullscreen. So the fixture is where
        // big mode is measured, and this is the record of why.
        console.log(
          `NOT MEASURED — live ${mode.name}: the player chose "${classes}" at ` +
            `${mode.viewport.width}×${mode.viewport.height}. The captured-fixture test ` +
            'above measures this mode.',
        );
        continue;
      }

      const measured = await measure(page);
      report(`live/${mode.name}`, await livePadding(page), measured);

      // DECISIONS 9, confirmed live: in `ytp-xsmall-width-mode` a stylesheet rule puts
      // `display: none` on `.ytp-size-button` and `.ytp-fullscreen-button` — the containing
      // `.ytp-right-controls-right` stays `display: flex`, with a 0×40 box — so **both** glyphs
      // measure 0×0. Not a pass, since `|0-0| <= 1` would sail through; not a failure either,
      // since there is nothing rendered to compare. A mode this page cannot answer for, said
      // out loud.
      if (measured.ours.width === 0 && measured.sibling.width === 0) {
        console.log(
          `NOT MEASURED — live ${mode.name}: the player hides the size and fullscreen ` +
            'buttons in this mode, so both glyphs are 0×0 and there is no rendered ' +
            'geometry to compare (DECISIONS 9). The captured fixture measures this mode.',
        );
        continue;
      }

      // Asymmetric zero is the real thing this suite is for: our glyph gone while its neighbour
      // renders.
      expect(measured.ours.width, `live ${mode.name}: our glyph is rendered`).toBeGreaterThan(0);
      expect(measured.sibling.width, `live ${mode.name}: reference rendered`).toBeGreaterThan(0);
      expect(measured.deltaWidth, `live ${mode.name}: width`).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(measured.deltaHeight, `live ${mode.name}: height`).toBeLessThanOrEqual(TOLERANCE_PX);

      established.push(mode.name);
    }

    console.log(`live width modes measured: ${established.join(', ') || 'none'}`);

    if (established.length === 0) {
      skipWithReason(
        'no width mode produced rendered geometry on the live page, so nothing was ' +
          'measured there. This is not a pass — the captured-fixture tests above are ' +
          'what measured RRR §5.1 in this run.',
      );
    }
  });

  /**
   * RRR §5.3's second half — measurable here and nowhere else.
   *
   * DECISIONS 147 is explicit about why: the per-frame bound proven in jsdom does **not** imply
   * the total. At 60 Hz one run per frame permits 600 runs in 10 s, so the ≤ 60 figure holds only
   * because runs are driven by *mutations*, and how many a watch page makes is a property of
   * YouTube rather than of our code — the named risk being childList churn from live chat, ads
   * and the up-next rail exceeding six a second. So if this fails, the finding is **not** that
   * the scheduler broke (`test/observe.test.ts` proves the per-frame bound) but that per-frame
   * coalescing is insufficient for §5.3. The mutation count alongside the run count is what tells
   * those two apart.
   *
   * Four assertions rather than one, because "under budget" alone is satisfied by measuring
   * nothing — a review found this passing with a run count of zero after the counter's selector
   * changed by one word. So: the run count **above zero** (the counter is wired to the code), the
   * churn **above zero** (the observer is alive), the baseline **exactly zero**, and only then
   * does the budget mean anything.
   *
   * The baseline is now zero by construction, `document` being a per-world wrapper, so it buys
   * only a check that the isolation holds — the assumption the whole attribution rests on. It
   * costs a second page load and a second ten-second window: the first thing to drop if this
   * ever needs to be faster.
   */
  test('coalesced runs over 10 s of playback stay inside the budget (RRR §5.3)', async ({
    page,
  }) => {
    const withBundle = await measureWindow(page, { bundle: true });

    const baselinePage = await page.context().newPage();
    const baseline = await measureWindow(baselinePage, { bundle: false });
    await baselinePage.close();

    const attributed = Math.max(0, withBundle.runs - baseline.runs);

    console.log(
      [
        `runs over ${MEASUREMENT_WINDOW_MS / 1000}s of playback:`,
        `  with the bundle:   ${withBundle.runs} player queries`,
        `  page baseline:     ${baseline.runs} player queries (YouTube's own, other world)`,
        `  attributed to us:  ${attributed}  (budget ${RUN_BUDGET})`,
        `  childList churn:   ${withBundle.mutations} mutations ` +
          `(${(withBundle.mutations / (MEASUREMENT_WINDOW_MS / 1000)).toFixed(1)}/s) — ` +
          'this is what drives the runs',
        `  playback advanced: ${withBundle.advanced.toFixed(2)}s`,
      ].join('\n'),
    );

    expect(
      baseline.runs,
      'the counter lives in the isolated world, so the page’s own queries cannot reach it',
    ).toBe(0);

    expect(
      withBundle.mutations,
      'no childList churn at all means the observer is dead, and a run count of zero ' +
        'would then look like excellent news',
    ).toBeGreaterThan(0);

    expect(
      attributed,
      'zero runs means the counter is not wired to the code it counts — a selector that ' +
        'no longer matches, or a bundle that never mounted. Under budget for the wrong ' +
        'reason is the failure this assertion exists to catch.',
    ).toBeGreaterThan(0);

    expect(
      attributed,
      `${attributed} coalesced runs in ${MEASUREMENT_WINDOW_MS / 1000}s against a budget of ` +
        `${RUN_BUDGET}. If this is over, read the mutation count first: at ` +
        `${withBundle.mutations} childList mutations the finding is that per-frame ` +
        'coalescing is insufficient for §5.3, not that the scheduler failed.',
    ).toBeLessThanOrEqual(RUN_BUDGET);
  });

  /**
   * DECISIONS 135: exactly one presentation change per click, and nobody else answering. Our
   * handler captures on the player and calls `stopPropagation`, so YouTube's must not also answer
   * — for a while every click drove PiP twice through two different APIs (DECISIONS 122–123), and
   * this is the one property no jsdom test can check against a real player.
   *
   * Three readings, together saying "one handler answered, it was ours, and it asked once":
   *
   * 1. The page-world witnesses: only the one *above* the player runs.
   * 2. `document.pictureInPictureElement` is null — YouTube's handler uses the standard API, so
   *    had it run the video would be in Chromium's PiP.
   * 3. Our own `setMode` calls: exactly one, and `picture-in-picture`.
   *
   * Reading 3 needs the WebKit API Chromium lacks, so {@link WEBKIT_SPY_INIT} records in our own
   * world. It counts how many times our code *asked*; it is not evidence about what WebKit would
   * have done. Readings 1 and 2 are measured on the real thing, independently of the stub.
   *
   * **This test clicks exactly once, and it has to**: the stub's `webkitPresentationMode` getter
   * is a constant `'inline'`, so it cannot model a player already in PiP and therefore cannot
   * model a second click. That makes the assertion sound and makes this **not** toggle coverage —
   * do not extend it without giving the stub real state. `test/presentation.test.ts` owns the
   * toggle-and-restore path (RRR §6).
   */
  test('exactly one presentation change per click, and no second handler (DECISIONS 135)', async ({
    page,
  }) => {
    const world = await openLiveWatchPage(page, { spy: true });

    // `pickVideo` prefers a playing video, so a watch page carrying an ad or a preview would
    // otherwise make this depend on which one it picked.
    await startPlayback(page);

    const ran = await witnessClick(page);
    const calls = await setModeCalls(world);
    const inPiP = await page.evaluate(() => document.pictureInPictureElement !== null);

    console.log(
      `live click: page-world handlers that ran ${JSON.stringify(ran)}; ` +
        `our setMode calls ${JSON.stringify(calls)}; pictureInPictureElement set: ${String(inPiP)}`,
    );

    expect(ran, 'only the witness above the player may run; YouTube’s must not').toEqual([
      'body-capture',
    ]);
    expect(inPiP, 'YouTube’s own handler answered the click as well as ours').toBe(false);
    expect(calls, 'our code asked for exactly one presentation change').toEqual([
      'picture-in-picture',
    ]);
  });
});

/**
 * Open a real watch page with the shipped bundle in it, the way Safari would, or skip saying why.
 *
 * Every exit below is a *reason*, printed. Between them they cover what RRR §9 means by "allowed
 * to be skipped": no network, an interstitial we will not click through, and a player DOM that
 * has changed beyond recognition.
 */
async function openLiveWatchPage(
  page: Page,
  options: { bundle?: boolean; spy?: boolean } = {},
): Promise<ContentScriptWorld> {
  const sources = [RUN_COUNTER_INIT];
  if (options.spy === true) sources.push(WEBKIT_SPY_INIT);
  if (options.bundle !== false) sources.push(bundleSource());

  const world = await injectAsContentScript(page, sources);

  try {
    await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (error) {
    skipWithReason(
      `${LIVE_URL} could not be loaded (${String(error).split('\n')[0]}). The network is ` +
        'unavailable or YouTube refused the request; the captured-fixture tests above ' +
        'still measured the invariant offline.',
    );
  }

  try {
    await page.waitForSelector(PLAYER, { timeout: 30_000 });
  } catch {
    const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 400);

    skipWithReason(
      `no ${PLAYER} appeared on ${LIVE_URL}. Either an interstitial is in the way — this ` +
        'suite does not click consent or sign-in dialogs — or the player has been ' +
        `renamed. The page said: ${JSON.stringify(text)}`,
    );
  }

  if (options.bundle !== false) {
    try {
      await waitForMountedButton(page);
    } catch {
      const state = await page.evaluate((selector) => {
        const button = document.querySelector<HTMLElement>(selector);

        return button === null
          ? 'absent'
          : `display=${JSON.stringify(button.style.getPropertyValue('display'))} parent=${
              button.parentElement?.className ?? 'none'
            }`;
      }, PIP_BUTTON);

      skipWithReason(
        `the bundle did not un-hide and place ${PIP_BUTTON} on the live page (it is ${state}). ` +
          'The player DOM has changed beyond what this suite recognises — that is a finding ' +
          'about YouTube, so it is reported rather than asserted here; ' +
          '`test/youtube.test.ts` remains the guard against a regression of ours.',
      );
    }
  }

  return world;
}

/** One ten-second measurement window over playing video. */
async function measureWindow(
  page: Page,
  options: { bundle: boolean },
): Promise<{ runs: number; mutations: number; advanced: number }> {
  const world = await openLiveWatchPage(page, { bundle: options.bundle });
  await startPlayback(page);

  const before = await readCounters(world);
  const startedAt = await currentTime(page);

  // Wall clock, not a polling loop: anything touching the page during the window would add
  // mutations of its own and be counted as churn.
  await page.waitForTimeout(MEASUREMENT_WINDOW_MS);

  const after = await readCounters(world);
  const advanced = (await currentTime(page)) - startedAt;

  if (advanced < MEASUREMENT_WINDOW_MS / 1000 / 2) {
    skipWithReason(
      `playback advanced only ${advanced.toFixed(2)}s during a ${
        MEASUREMENT_WINDOW_MS / 1000
      }s window, so this was not 10 s of playback and the run count would not mean what ` +
        'RRR §5.3 asks for. Likely an ad, a stalled stream or a paused player.',
    );
  }

  return {
    runs: after.playerQueries - before.playerQueries,
    mutations: after.mutations - before.mutations,
    advanced,
  };
}

/** Get the video playing, or say why it would not. */
async function startPlayback(page: Page): Promise<void> {
  await page.waitForSelector('video', { timeout: 30_000 });

  await page.evaluate(() => {
    const video = document.querySelector('video');
    // Muted, because an unmuted autoplay is refused outright and because a machine that is
    // asleep-adjacent should not start making noise.
    if (video) {
      video.muted = true;
      void video.play().catch(() => undefined);
    }
  });

  try {
    await page.waitForFunction(
      () => {
        const video = document.querySelector('video');

        return video !== null && !video.paused && video.currentTime > 0;
      },
      undefined,
      { timeout: 20_000 },
    );
  } catch {
    skipWithReason(
      'the video never started playing in headless Chromium (codec, autoplay policy or ' +
        'an ad). RRR §5.3 asks for 10 s of *playback*, so measuring a paused player ' +
        'would report a number that does not answer the requirement.',
    );
  }
}

async function currentTime(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
}

/** The live reference glyph's computed padding, for the record. */
async function livePadding(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const svg = document.querySelector(selector);

    return svg === null ? 'none' : getComputedStyle(svg).padding;
  }, SIBLING);
}

/**
 * Print the numbers. The measurement is the deliverable as much as the pass is: the assertion
 * says the invariant holds, and only the printed boxes say *what* held, in which mode, and how
 * far from the tolerance. A green run with no numbers cannot be told apart from a green run that
 * measured two zeroes.
 */
function report(
  mode: string,
  padding: string,
  measured: {
    ours: { width: number; height: number };
    sibling: { width: number; height: number };
    deltaWidth: number;
    deltaHeight: number;
  },
): void {
  console.log(
    `${mode.padEnd(14)} ours ${box(measured.ours)}  sibling ${box(measured.sibling)}  ` +
      `Δ ${measured.deltaWidth.toFixed(2)}×${measured.deltaHeight.toFixed(2)} px  ` +
      `(reference padding ${padding})`,
  );
}

function box(size: { width: number; height: number }): string {
  return `${size.width.toFixed(2)}×${size.height.toFixed(2)}`;
}
