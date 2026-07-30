/**
 * The plumbing for the one suite that runs in a browser which does layout — RRR §9's "Live
 * DOM" row. Nothing here asserts; `youtube.spec.ts` does.
 *
 * jsdom never lays anything out, so `getBoundingClientRect()` there is `0×0` for every element,
 * and RRR §5.1 — our glyph box equals a sibling control's within ±1 px — is the one requirement
 * it cannot in principle answer. Hence Chromium and Playwright (RRR §2 settles both; Playwright
 * cannot drive a Safari extension). `test/youtube.test.ts` remains the guard: it asserts the
 * cause, that the module writes no inline style anywhere in the player subtree, while this
 * measures the effect.
 *
 * ## The injection world, which is load-bearing
 *
 * `dist/content.js`, the **shipped bundle**, verbatim, at document start **in an isolated
 * world** ({@link injectAsContentScript}) — not `page.addInitScript`, which is the main world.
 * Measured on a live watch page, same load, same bundle, both worlds side by side:
 *
 * | | isolated world (production) | main world |
 * |---|---|---|
 * | `hasOwnProperty(player, 'addEventListener')` | false | true |
 * | `player.addEventListener` | the native prototype method | YouTube's own function |
 * | own keys on the player element | 0 | ~244 |
 * | our capture listener fires | **yes** | no |
 *
 * The ~244 expandos are YouTube's public JS Player API grafted onto `#movie_player`,
 * `addEventListener` among them; `EventTarget.prototype` is untouched. So in the main world our
 * registration disappears into YouTube's own bookkeeping and never reaches the DOM — a
 * main-world harness reports a defect that cannot happen where the product runs. This one did,
 * and the near-miss fix was to move the shipped click listener onto the button: a real
 * regression bought to satisfy a harness bug. **The harness was less faithful than the
 * fixture**; a plain `<div>` player was fine. {@link assertProductionWorld} pins it.
 *
 * Two further gaps from shipped behaviour. The bundle runs with no `browser` global at all,
 * which is not luck — every module that touches it degrades when it is absent, because RRR §4.1
 * requires silence on a page the extension cannot act on — so `youtubeButton` sits at its
 * default `true`, the state under test. And Chromium has no `webkitSetPresentationMode`, so the
 * toggle cannot run; where that matters {@link WEBKIT_SPY_INIT} installs a *recording stub*.
 *
 * ## Where the page comes from
 *
 * The split is the whole reason the geometry assertions are not flaky:
 *
 * 1. **The captured fixture, served as `https://www.youtube.com/watch`** through request
 *    interception — the same file the jsdom suite drives (DECISIONS 135), carrying the measured
 *    `<style>` contract including `--yt-delhi-pill-top-height: 8px` and the three width-mode
 *    rules. The real hostname matters because `mountYouTubeButton` keys on `location.hostname`
 *    (RRR §4.5) and returns an inert binding for `localhost`, so interception rather than a
 *    static server is what lets the shipped module run unmodified offline. All three width modes
 *    reachable.
 * 2. **A real watch page** for what a fixture cannot contain: the player's own width-mode logic,
 *    and live churn for §5.3's run count.
 *
 * The fixture is the guard; the live page is the reality check. Stated plainly so nobody reads a
 * green fixture run as evidence about today's YouTube.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type CDPSession, type Page, test } from '@playwright/test';

// Imported rather than copied: it is the only thing that can say "the bundle's top-level code
// ran *in this world*", and a second copy of the string would be one more thing to drift.
import { CONTENT_SCRIPT_FRAME_FLAG } from '../../src/core/inject';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The Resources directory — `dist/` and `test/fixtures/` hang off it. */
const RESOURCES = resolve(HERE, '..', '..');

/** The bundle the manifest ships and `core/inject.ts` injects. */
export const CONTENT_BUNDLE = resolve(RESOURCES, 'dist', 'content.js');

/** The same captured DOM the jsdom suite drives. One fixture, two renderers. */
export const FIXTURE = resolve(RESOURCES, 'test', 'fixtures', 'youtube-right-controls.html');

/** The module whose selector the run counter has to agree with. */
export const YOUTUBE_MODULE = resolve(RESOURCES, 'src', 'sites', 'youtube.ts');

/**
 * A watch URL on the real hostname, because that is what the module keys off. The video id is
 * deliberately not a real one: nothing is fetched, and a plausible id would invite someone to
 * "fix" the test by letting it hit the network.
 */
export const FIXTURE_URL = 'https://www.youtube.com/watch?v=piposs-fixture';

/** A real watch page. Overridable, so a video going private is a one-liner. */
export const LIVE_URL =
  process.env.PIPOSS_LIVE_URL ??
  // Big Buck Bunny, Blender Foundation, Creative Commons, ~10 minutes: long enough
  // for a 10 s measurement window and about as unlikely to be taken down as a
  // YouTube video gets.
  'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

/** Our button's glyph. */
export const OURS = '.ytp-pip-button svg';

/**
 * The neighbour every measurement is compared against: `.ytp-size-button`, because after
 * `place()` runs it is PiP's immediate next sibling (DECISIONS 135) — the closest thing in the
 * DOM to "the same kind of element in the same box". Always a **sibling**, never a pixel value
 * (DECISIONS 11, 121): an absolute expectation passes today and misreports after the next
 * redesign, which is the failure this suite exists to prevent.
 */
export const SIBLING = '.ytp-size-button svg';

export const PLAYER = '.html5-video-player';
export const PIP_BUTTON = '.ytp-pip-button';
export const RIGHT_GROUP = '.ytp-right-controls-right';

/** RRR §5.1's tolerance. */
export const TOLERANCE_PX = 1;

/** RRR §5.3's second half: coalesced runs over 10 s of playback. */
export const RUN_BUDGET = 60;
export const MEASUREMENT_WINDOW_MS = 10_000;

/** What a content script's world is called here. Any name would do. */
export const ISOLATED_WORLD = 'piposs-content-script';

/**
 * A width mode, with the viewport it is measured in.
 *
 * The viewport is explicit for every one, and that is DECISIONS 9 rather than tidiness: the
 * player collapses to `ytp-xsmall-width-mode`/`ytp-tiny-mode` in a small or unsized viewport
 * and hides most of its buttons, so a measurement taken in a default headless viewport reads
 * **zero for everything** and the ±1 px assertion passes on two zeroes. It has happened once
 * already. Every measurement is therefore also asserted non-zero, and the mode is asserted to
 * be in effect before anything is read.
 */
export interface WidthMode {
  /** RRR §5.1 names three; these are they. */
  readonly name: 'default' | 'xsmall' | 'big';

  /** The class the player carries in this mode, or none for the default. */
  readonly playerClass: string | null;

  readonly viewport: { width: number; height: number };
}

export const WIDTH_MODES: readonly WidthMode[] = [
  { name: 'default', playerClass: null, viewport: { width: 1280, height: 800 } },
  { name: 'xsmall', playerClass: 'ytp-xsmall-width-mode', viewport: { width: 480, height: 360 } },
  { name: 'big', playerClass: 'ytp-big-mode', viewport: { width: 2560, height: 1440 } },
];

/** The classes that say which width mode the player has put itself in. */
const MODE_CLASS = /width-mode|big-mode|tiny-mode/;

/** Just the mode-bearing classes, for a printable line instead of thirty classes. */
export function modeClasses(className: string): string {
  return (
    className
      .split(/\s+/)
      .filter((each) => MODE_CLASS.test(each))
      .join(' ') || '(no mode class)'
  );
}

/** What one measurement of the invariant looks like. */
export interface Measurement {
  ours: { width: number; height: number };
  sibling: { width: number; height: number };
  deltaWidth: number;
  deltaHeight: number;
}

/**
 * A handle on the world the bundle was injected into, so a test can read what the bundle sees
 * rather than what the page sees — and compare the two.
 */
export interface ContentScriptWorld {
  /** Evaluate in the isolated world, where the bundle runs. */
  evaluate<T>(expression: string): Promise<T>;

  /** Evaluate the same expression in the page's own world, for comparison. */
  evaluateInPage<T>(expression: string): Promise<T>;
}

/**
 * Run the shipped bundle the way Safari runs it: at document start, in an isolated world, with
 * the page's own scripts none the wiser.
 *
 * `Page.addScriptToEvaluateOnNewDocument` with a `worldName` is the CDP primitive that models a
 * content script. Playwright's `addInitScript` is the main world and therefore not a model of
 * anything this product does — see the header for what believing otherwise cost.
 *
 * `sources` are evaluated in order, so a counter or a stub can share the bundle's world.
 */
export async function injectAsContentScript(
  page: Page,
  sources: readonly string[],
): Promise<ContentScriptWorld> {
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const { frameTree } = await cdp.send('Page.getFrameTree');
  const mainFrame = frameTree.frame.id;

  // The world is created per document, so its context id changes on every navigation. Only the
  // main frame's is of interest: the script is installed in every frame, and a watch page has
  // plenty of ad iframes.
  let contextId: number | undefined;

  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    const auxData = context.auxData as { frameId?: string } | undefined;

    if (context.name === ISOLATED_WORLD && auxData?.frameId === mainFrame) contextId = context.id;
  });

  for (const source of sources) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source, worldName: ISOLATED_WORLD });
  }

  const evaluate = async <T>(expression: string): Promise<T> => {
    if (contextId === undefined) {
      throw new Error(
        `the "${ISOLATED_WORLD}" world does not exist — the bundle was never evaluated, so ` +
          'nothing measured here is about the product',
      );
    }

    return evaluateIn<T>(cdp, expression, contextId);
  };

  return {
    evaluate,
    evaluateInPage: async <T>(expression: string): Promise<T> =>
      evaluateIn<T>(cdp, expression, undefined),
  };
}

/** One `Runtime.evaluate`, in a named context or in the page's default one. */
async function evaluateIn<T>(
  cdp: CDPSession,
  expression: string,
  contextId: number | undefined,
): Promise<T> {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    ...(contextId === undefined ? {} : { contextId }),
    returnByValue: true,
    awaitPromise: true,
  });

  if (exceptionDetails) throw new Error(`evaluate failed: ${exceptionDetails.text}`);

  return result.value as T;
}

/** The bundle's source, read at call time so a rebuild is always picked up. */
export function bundleSource(): string {
  return readFileSync(CONTENT_BUNDLE, 'utf8');
}

/**
 * Skip the whole test unless the shipped bundle exists.
 *
 * Called from **both** describes' `beforeEach`. Guarding only the fixture one meant
 * `rm dist/content.js` skipped six tests with a reason and crashed the live ones with `ENOENT`,
 * exiting 1 — and a skip path that exits 1 is not a skip path (RRR §9).
 */
export function requireBundle(): void {
  try {
    readFileSync(CONTENT_BUNDLE);
  } catch {
    skipWithReason(
      `the shipped bundle ${CONTENT_BUNDLE} is missing — run \`pnpm run build\` ` +
        '(or `pnpm run test:live`, which builds first). This suite deliberately ' +
        'measures the built bundle rather than the TypeScript sources.',
    );
  }
}

/**
 * Serve the captured fixture as a real YouTube watch page, with the shipped bundle in the world
 * Safari would use.
 *
 * Everything other than the watch URL is aborted rather than allowed through: the fixture
 * references nothing external, so any request that appears is either the page reaching the
 * network — flaky for no gain — or a sign the fixture has grown a dependency worth looking at.
 */
export async function servePlayerFixture(
  page: Page,
  extraSources: readonly string[] = [],
): Promise<ContentScriptWorld> {
  const body = fixturePage();

  await page.route('**/*', async (route) => {
    const url = route.request().url();

    if (url.startsWith('https://www.youtube.com/watch')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
      return;
    }

    await route.abort();
  });

  return injectAsContentScript(page, [...extraSources, bundleSource()]);
}

/** The fixture is a fragment; a browser wants a document. */
function fixturePage(): string {
  const fragment = readFileSync(FIXTURE, 'utf8');

  // No stylesheet, no font, no reset of our own beyond zeroing the body margin:
  // the point is that the only CSS in play is the contract the capture recorded.
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<title>PiPOSS live-DOM fixture</title>',
    '<style>body { margin: 0 }</style>',
    '</head><body>',
    fragment,
    '</body></html>',
  ].join('\n');
}

/**
 * Wait until the shipped bundle has un-hidden **and** placed the button — either alone can be
 * true while the module is mid-flight, since the mount only acts once the stored settings have
 * resolved (DECISIONS 127) and `place()` runs after the un-hiding. Read from the page world on
 * purpose: inline style and parentage are DOM state shared by every world, so this checks the
 * DOM rather than our own bookkeeping.
 */
export async function waitForMountedButton(page: Page): Promise<void> {
  await page.waitForFunction(
    ([pip, group]) => {
      const button = document.querySelector<HTMLElement>(pip as string);
      if (!button) return false;

      const shown = button.style.getPropertyValue('display') === '';
      const placed = button.parentElement?.matches(group as string) === true;

      return shown && placed;
    },
    [PIP_BUTTON, RIGHT_GROUP],
    { timeout: 15_000 },
  );
}

/**
 * Put the player into one width mode and confirm it is actually in it.
 *
 * On the fixture there is no player script, so the class is ours to set — and reading back a
 * class we just wrote proves nothing. What is checked instead is that the mode's CSS is *in
 * effect*: the reference button's computed padding must differ from the default mode's. That is
 * the fixture's `<style>` contract responding, so a width-mode rule that stopped matching fails
 * here rather than silently measuring the default mode three times.
 */
export async function enterFixtureMode(page: Page, mode: WidthMode): Promise<string> {
  await page.setViewportSize(mode.viewport);

  await page.evaluate(
    ([selector, className, all]) => {
      const player = document.querySelector<HTMLElement>(selector as string);
      if (!player) throw new Error(`no ${selector as string}`);

      for (const other of all as string[]) player.classList.remove(other);
      if (className !== null) player.classList.add(className as string);
    },
    [
      PLAYER,
      mode.playerClass,
      WIDTH_MODES.map((each) => each.playerClass).filter((each) => each !== null),
    ] as const,
  );

  return siblingPadding(page);
}

/** The reference button's computed padding — the witness that a mode took effect. */
export async function siblingPadding(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const svg = document.querySelector(selector);
    if (!svg) throw new Error(`no ${selector}`);

    return getComputedStyle(svg).padding;
  }, SIBLING);
}

/**
 * Wait for the live player to put *itself* into `mode`, and report what it did.
 *
 * Polled rather than slept, because the player re-classifies itself asynchronously after a
 * resize and a fixed wait is either too short (measuring the previous mode) or wasted. The
 * default mode is "none of the narrowing or big classes", which is how the player expresses it:
 * it carries `ytp-large-width-mode` there, and naming that class as the expectation would be a
 * guess about YouTube's vocabulary rather than a reading of it.
 */
export async function waitForLiveMode(
  page: Page,
  mode: WidthMode,
  timeoutMs = 6_000,
): Promise<{ inMode: boolean; classes: string }> {
  const deadline = Date.now() + timeoutMs;
  let classes = '';

  do {
    classes = await page.evaluate((selector) => {
      const player = document.querySelector(selector);

      return player === null ? '' : player.className;
    }, PLAYER);

    const inMode =
      mode.playerClass === null
        ? !/ytp-(xsmall|tiny)-width-mode|ytp-tiny-mode|ytp-big-mode/.test(classes)
        : classes.includes(mode.playerClass);

    if (inMode) return { inMode: true, classes: modeClasses(classes) };

    await page.waitForTimeout(250);
  } while (Date.now() < deadline);

  return { inMode: false, classes: modeClasses(classes) };
}

/** The two boxes RRR §5.1 compares, and the difference between them. */
export async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(
    ([ours, sibling]) => {
      const box = (selector: string): { width: number; height: number } => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`no ${selector}`);

        const rect = element.getBoundingClientRect();

        return { width: rect.width, height: rect.height };
      };

      const a = box(ours);
      const b = box(sibling);

      return {
        ours: a,
        sibling: b,
        deltaWidth: Math.abs(a.width - b.width),
        deltaHeight: Math.abs(a.height - b.height),
      };
    },
    [OURS, SIBLING] as const,
  );
}

/**
 * Re-apply the pre-T06 geometry write to our button's glyph, and nothing else.
 *
 * The bug of `docs/research/youtube-player-2026-07.md`, character for character:
 * `padding: calc(var(--yt-delhi-pill-top-height, 12px) - 6px) 6px` with
 * `box-sizing: border-box`, from a `halfSvgSizeDiff = (36 - 24) / 2` that stopped being true.
 * With the pill height at its measured 8 px that computes `2px 6px` on a border box and
 * collapses the glyph.
 *
 * It exists so the canary test can prove the comparison is able to fail. The numbers are the
 * *broken* ones and may be literals here: RRR §5.4's no-geometry-constants gate is about
 * `src/sites/youtube.ts`, and this file is the record of what that module must never do again.
 */
export async function applyLegacyGeometry(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const svg = document.querySelector<SVGElement>(selector);
    if (!svg) throw new Error(`no ${selector}`);

    svg.style.padding = 'calc(var(--yt-delhi-pill-top-height, 12px) - 6px) 6px';
    svg.style.boxSizing = 'border-box';
  }, OURS);
}

/**
 * Count coalesced `refresh()` runs, instrumented as `countRefreshRuns()` in
 * `test/observe.test.ts` is: wrap `document.querySelectorAll` and count the calls carrying the
 * player selector, of which the mount makes exactly one per run (DECISIONS 147).
 *
 * Injected **into the bundle's own isolated world**, ahead of it, which is what makes the count
 * clean rather than approximate: `document` is a per-world wrapper, so this patch is invisible
 * to YouTube's scripts and their own `.html5-video-player` queries cannot reach it even in
 * principle. The baseline pass measures that rather than assuming it.
 *
 * The selector below must be the one `src/sites/youtube.ts` queries, or the count is silently
 * zero and the budget assertion passes having measured nothing. Two things stop that: a test
 * reads the module's own `PLAYER` constant and requires it to equal this one, and the run count
 * is asserted **greater than zero** as well as under budget.
 */
export const RUN_COUNTER_INIT = `
  (() => {
    const real = document.querySelectorAll.bind(document);
    globalThis.__pipossPlayerQueries = 0;
    document.querySelectorAll = function counted(selector) {
      if (selector === '${PLAYER}') globalThis.__pipossPlayerQueries += 1;
      return real(selector);
    };

    // The churn that *drives* the runs, counted with the same options \`core/observe.ts\`
    // uses — what makes a failure diagnosable rather than mysterious. DECISIONS 147 names
    // the risk as live chat, ads and the up-next rail exceeding six childList mutations a
    // second, which is a property of the page rather than of our scheduler, so without this
    // number a failure cannot be told apart from a broken coalescer. A lower bound on it is
    // asserted too, so a dead observer cannot make the run count look good either.
    globalThis.__pipossMutations = 0;
    new MutationObserver((records) => {
      globalThis.__pipossMutations += records.length;
    }).observe(document, { subtree: true, childList: true });
  })();
`;

/**
 * A recording stub of the WebKit presentation API, installed in our own world.
 *
 * Chromium has no `webkitSetPresentationMode`, so without this the shipped toggle cannot run at
 * all and DECISIONS 135's question — how many presentation changes does one click cause? — has
 * no answer here. Per-world prototypes make it honest: this is on the isolated world's
 * `HTMLVideoElement.prototype`, so the bundle sees it and the page does not, and YouTube's own
 * standard-API path stays untouched and separately observable through
 * `document.pictureInPictureElement`.
 *
 * It records calls. It does **not** put anything into Picture-in-Picture.
 */
export const WEBKIT_SPY_INIT = `
  (() => {
    globalThis.__pipossSetModeCalls = [];
    HTMLVideoElement.prototype.webkitSupportsPresentationMode = function () { return true; };
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitPresentationMode', {
      configurable: true,
      get() { return 'inline'; },
    });
    HTMLVideoElement.prototype.webkitSetPresentationMode = function (mode) {
      globalThis.__pipossSetModeCalls.push(mode);
    };
  })();
`;

/** One reading of both counters installed by {@link RUN_COUNTER_INIT}. */
export interface Counters {
  playerQueries: number;
  mutations: number;
}

/** Reads the counters, from the world they live in. */
export async function readCounters(world: ContentScriptWorld): Promise<Counters> {
  return world.evaluate<Counters>(
    '({ playerQueries: globalThis.__pipossPlayerQueries, mutations: globalThis.__pipossMutations })',
  );
}

/** Every mode our code asked the platform to switch to, in order. */
export async function setModeCalls(world: ContentScriptWorld): Promise<string[]> {
  return world.evaluate<string[]>('globalThis.__pipossSetModeCalls');
}

/** What one world says about the player element, and about the bundle. */
export interface WorldReading {
  ownAddEventListener: boolean;
  ownKeys: number;
  nativeAddEventListener: boolean;

  /**
   * Did the shipped bundle's top-level code run *in this world*?
   *
   * `claimFrame()` sets {@link CONTENT_SCRIPT_FRAME_FLAG} on the content script's own global and
   * globals are per-world, so this answers "which world is the product in?" directly rather than
   * by inference from the DOM wrappers. It is also the only one of these readings that works on
   * the **fixture**: a plain `<div>` player has no expandos in either world, so the three
   * columns above are identical there and cannot tell a reverted `worldName` from a correct one.
   */
  frameClaimed: boolean;
}

/**
 * Read the player element, and the bundle's own footprint, from both worlds. The main-world
 * column is the evidence that the two worlds really differ, and therefore that the isolated
 * world is doing something rather than a `worldName` that silently fell back to the page.
 */
export async function assertProductionWorld(
  world: ContentScriptWorld,
): Promise<{ isolated: WorldReading; page: WorldReading }> {
  const probe = `(() => {
    const player = document.querySelector('${PLAYER}');
    if (!player) throw new Error('no ${PLAYER}');
    return {
      ownAddEventListener: Object.prototype.hasOwnProperty.call(player, 'addEventListener'),
      ownKeys: Object.keys(player).length,
      nativeAddEventListener: player.addEventListener === EventTarget.prototype.addEventListener,
      frameClaimed: globalThis['${CONTENT_SCRIPT_FRAME_FLAG}'] === true,
    };
  })()`;

  return {
    isolated: await world.evaluate<WorldReading>(probe),
    page: await world.evaluateInPage<WorldReading>(probe),
  };
}

/**
 * Does a capturing click listener registered in one world on `selector` actually fire? The probe
 * registers one, dispatches a synthetic bubbling click at the PiP button, and reports whether it
 * ran — synthetic on purpose, because a real click would also trigger whatever the page does
 * with it and this asks only about registration.
 */
export async function captureListenerFires(
  world: ContentScriptWorld,
  where: 'isolated' | 'page',
  selector: string,
): Promise<boolean> {
  const probe = `(() => {
    const node = document.querySelector('${selector}');
    const source = document.querySelector('${PIP_BUTTON}');
    if (!node || !source) return false;
    let ran = 0;
    const listener = () => { ran += 1; };
    node.addEventListener('click', listener, true);
    source.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    node.removeEventListener('click', listener, true);
    return ran > 0;
  })()`;

  return where === 'isolated'
    ? world.evaluate<boolean>(probe)
    : world.evaluateInPage<boolean>(probe);
}

/**
 * Install three witnesses for a click on the PiP button **in the page's own world** and return
 * which of them ran.
 *
 * They stand in for the handlers our capture listener has to beat (DECISIONS 122–124), and they
 * live in the page world because YouTube's do: one bubbling on the button, as YouTube's own is;
 * one bubbling at `document`; and one capturing on `body`, which is *above* the player and must
 * therefore still run — the control that shows the click was delivered rather than lost.
 *
 * That this works across worlds is the point rather than a caveat: there is one event dispatch
 * over one DOM, so `stopPropagation` from a content script silences page listeners. If it did
 * not, no content script could intercept anything.
 */
export async function witnessClick(page: Page): Promise<string[]> {
  await page.evaluate(
    ([button]) => {
      const log: string[] = [];
      (window as unknown as { __pipossClickLog: string[] }).__pipossClickLog = log;

      document.querySelector(button as string)?.addEventListener('click', () => {
        log.push('button-bubble');
      });
      document.addEventListener('click', () => log.push('document-bubble'));
      document.body.addEventListener('click', () => log.push('body-capture'), true);
    },
    [PIP_BUTTON] as const,
  );

  await page.locator(PIP_BUTTON).click();
  await page.waitForTimeout(300);

  return page.evaluate(
    () => (window as unknown as { __pipossClickLog: string[] }).__pipossClickLog,
  );
}

/**
 * Skip this test, saying why, out loud.
 *
 * RRR §9 allows this suite to be skipped and requires the skip to carry an explicit message.
 * Playwright records the reason as an annotation, which the list reporter abbreviates, so it is
 * printed too: a suite that quietly reports success when it measured nothing is worse than no
 * suite, and the printed line is what makes the difference visible in CI output.
 */
export function skipWithReason(reason: string): never {
  console.log(`SKIP (${test.info().title}): ${reason}`);
  test.info().annotations.push({ type: 'skip-reason', description: reason });
  test.skip(true, reason);

  // `test.skip(true, …)` throws; this is unreachable and only tells the compiler so.
  throw new Error(reason);
}
