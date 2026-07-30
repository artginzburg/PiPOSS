/**
 * The toolbar button and the registered command — what `src/background.ts` exists for
 * (RRR §4.1, §4.2).
 *
 * These tests load **both** the background and the content script into the same realm and
 * let them talk over the faked messaging API. A background that posts `piposs:toggel` and
 * a content script listening for `piposs:toggle` would each pass a unit test of its own
 * and be a silent no-op in Safari; only an end-to-end pass over the real message value
 * catches it.
 *
 * Every test here has to be explicit about **whether the site is granted**: a declared
 * content script does not run until the user allows the site, and on a fresh install no
 * site is. So a test either seeds `tabsWithContentScript` ({@link grantedSite}) or lets
 * the button inject its way in ({@link ungrantedSite}) — RRR §4.1.
 *
 * `_execute_action` needs no test of its own: with no `default_popup` declared, Safari
 * routes the command through the same `action.onClicked` event, so the keyboard path *is*
 * the click path. The manifest declaration is `manifest.test.ts`'s business.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTENT_SCRIPT_FILE, CONTENT_SCRIPT_FRAME_FLAG } from '../src/core/inject';
import { TOGGLE_PIP } from '../src/core/messages';
import { type FakeBrowser, installFakeBrowser, uninstallFakeBrowser } from './helpers/fake-browser';
import { appendVideo } from './helpers/video';

/** A tab id that is not 0, so a falsy-vs-undefined mix-up cannot hide. */
const TAB_ID = 7;

/**
 * Evaluates `src/content.ts` as a browser evaluates a freshly injected copy: a new module
 * instance whose top-level code runs again. `vi.resetModules()` is what makes it *new* —
 * without it vitest hands back the cached module, the top-level code never re-runs, and
 * the idempotency tests below pass without testing anything.
 */
async function loadContentScript(): Promise<void> {
  vi.resetModules();
  await import('../src/content');
}

async function loadBackground(): Promise<void> {
  vi.resetModules();
  await import('../src/background');
}

/**
 * Forgets that any content script has claimed this frame. The claim lives on the frame's
 * global, so a real page load starts clean; jsdom reuses one global for the whole file.
 */
function newPageLoad(): void {
  delete (globalThis as Record<string, unknown>)[CONTENT_SCRIPT_FRAME_FLAG];
  document.body.innerHTML = '';
}

/** A granted site: the declared content script is already running in the tab. */
async function grantedSite(): Promise<FakeBrowser> {
  const fake = installFakeBrowser({
    tabsWithContentScript: [TAB_ID],
    loadContentScript,
  });
  await loadContentScript();
  await loadBackground();
  return fake;
}

/**
 * An ungranted site — the fresh-install state. Nothing is listening in the tab, the
 * declared content script has *not* run, only the background is alive.
 */
async function ungrantedSite(
  overrides: { loadContentScript?: (tabId: number) => void | Promise<void> } = {},
): Promise<FakeBrowser> {
  const fake = installFakeBrowser({
    loadContentScript: overrides.loadContentScript ?? loadContentScript,
  });
  await loadBackground();
  return fake;
}

beforeEach(() => {
  newPageLoad();
});

afterEach(() => {
  uninstallFakeBrowser();
  newPageLoad();
});

describe('the toolbar button on a site the user has already granted', () => {
  it('toggles PiP in the clicked tab, exactly as the hotkey does', async () => {
    const fake = await grantedSite();
    const { setArgs } = appendVideo();

    await fake.action.click({ id: TAB_ID });

    expect(setArgs).toEqual(['picture-in-picture']);
    // The restore record is not assertable from here: since BF02 it lives in module state,
    // and `loadContentScript` evaluates `src/content` as a *fresh* instance whose state
    // this file cannot see. The next test covers it behaviourally instead.
  });

  /**
   * The record, asserted through the only thing this file can see: the modes the page was
   * actually put into.
   *
   * **It has to start in `fullscreen`.** Clicking twice from inline and requiring `inline`
   * back is worthless — `inline` is both the recorded restore target *and* `togglePiP`'s
   * fallback when there is no record, so it passes with the record destroyed. Measured by
   * BF02's reviewer: two mutations that annihilate the record killed 21 and 9 tests
   * respectively and not one was in this file.
   */
  it('restores the presentation it came from, not merely inline', async () => {
    const fake = await grantedSite();
    const { setArgs } = appendVideo({ mode: 'fullscreen' });

    await fake.action.click({ id: TAB_ID });
    await fake.action.click({ id: TAB_ID });

    expect(setArgs).toEqual(['picture-in-picture', 'fullscreen']);
  });

  it('toggles back out on a second click, like a second keypress', async () => {
    const fake = await grantedSite();
    const { setArgs } = appendVideo();

    await fake.action.click({ id: TAB_ID });
    await fake.action.click({ id: TAB_ID });

    expect(setArgs).toEqual(['picture-in-picture', 'inline']);
  });

  it('sends exactly one message, of the agreed type, to the clicked tab', async () => {
    const fake = await grantedSite();
    appendVideo();

    await fake.action.click({ id: TAB_ID });

    expect(fake.tabs.sentMessages).toEqual([{ tabId: TAB_ID, message: { type: TOGGLE_PIP } }]);
  });

  it('never injects when the message was delivered', async () => {
    const fake = await grantedSite();
    appendVideo();

    await fake.action.click({ id: TAB_ID });

    expect(fake.scripting.executeScriptCalls).toEqual([]);
  });

  it('addresses the whole tab, never frame 0 — an embedded player lives in an iframe', async () => {
    const fake = await grantedSite();
    appendVideo();

    await fake.action.click({ id: TAB_ID });

    // `{ frameId: 0 }` would restrict delivery to the top document, where a page with an
    // embedded player has no video at all.
    expect(fake.tabs.sentMessages[0]?.options).toBeUndefined();
  });

  it('stays silent when the tab holds no eligible video (RRR §4.1)', async () => {
    const fake = await grantedSite();
    // Two paused videos: `pickVideo` returns null, so there is nothing to do.
    const first = appendVideo({ paused: true });
    const second = appendVideo({ paused: true });

    await expect(fake.action.click({ id: TAB_ID })).resolves.toBeUndefined();

    expect(first.setArgs).toEqual([]);
    expect(second.setArgs).toEqual([]);
    expect(fake.forbiddenApiCalls).toEqual([]);
  });

  it('stays silent on a page with no video at all', async () => {
    const fake = await grantedSite();

    await expect(fake.action.click({ id: TAB_ID })).resolves.toBeUndefined();

    expect(fake.forbiddenApiCalls).toEqual([]);
  });

  it('does nothing when the clicked tab has no id', async () => {
    const fake = await grantedSite();
    appendVideo();

    await expect(fake.action.click({})).resolves.toBeUndefined();

    expect(fake.tabs.sentMessages).toEqual([]);
    expect(fake.scripting.executeScriptCalls).toEqual([]);
  });

  it('never reaches for badges, notifications or tabs.query', async () => {
    const fake = await grantedSite();
    appendVideo();

    await fake.action.click({ id: TAB_ID });

    // A badge or a notification would break RRR §4.1's "nothing is shown", and
    // `tabs.query` would make the button depend on a host permission the user may never
    // have granted — the clicked tab arrives as the listener's argument, which is what
    // `activeTab` covers.
    expect(fake.forbiddenApiCalls).toEqual([]);
  });
});

describe('the toolbar button on a site the user has NEVER granted (RRR §4.1)', () => {
  it('injects the content script and retries, so the button still works', async () => {
    // The state of every site on a fresh install. `activeTab` does not start a declared
    // content script — the click grants the *ability* to inject, and without acting on it
    // the button is silently dead.
    const fake = await ungrantedSite();
    const { setArgs } = appendVideo();

    await fake.action.click({ id: TAB_ID });

    expect(setArgs).toEqual(['picture-in-picture']);
  });

  it('injects the declared bundle into every frame', async () => {
    const fake = await ungrantedSite();
    appendVideo();

    await fake.action.click({ id: TAB_ID });

    expect(fake.scripting.executeScriptCalls).toEqual([
      { target: { tabId: TAB_ID, allFrames: true }, files: [CONTENT_SCRIPT_FILE] },
    ]);
  });

  it('tries the message first and injects only after it fails', async () => {
    const fake = await ungrantedSite();
    appendVideo();

    await fake.action.click({ id: TAB_ID });

    // Two attempts at the same message: the one that proved the tab was ungranted,
    // and the retry that actually landed. Injecting first on every click would
    // re-inject on every site the user *has* granted.
    expect(fake.tabs.sentMessages).toEqual([
      { tabId: TAB_ID, message: { type: TOGGLE_PIP } },
      { tabId: TAB_ID, message: { type: TOGGLE_PIP } },
    ]);
    expect(fake.contentScripts.tabIds).toEqual([TAB_ID]);
  });

  it('gives up quietly when the injection itself is refused', async () => {
    const fake = await ungrantedSite();
    // Safari's own pages, the Extensions gallery, a PDF — places no extension may
    // touch however many permissions it holds.
    fake.scripting.executeScriptFailure = new Error(
      'Cannot access contents of url. Extension manifest must request permission.',
    );
    const { setArgs } = appendVideo();

    await expect(fake.action.click({ id: TAB_ID })).resolves.toBeUndefined();

    expect(setArgs).toEqual([]);
    expect(fake.forbiddenApiCalls).toEqual([]);
    // Only the first attempt. Retrying a message into a tab the injection could not
    // reach cannot succeed, so it would be noise on every click of a Safari page.
    expect(fake.tabs.sentMessages).toHaveLength(1);
  });

  it('injects at most once per click, even when the retry also finds nothing', async () => {
    // A loader that registers nothing: the tab becomes reachable but still has no
    // listener.
    const fake = await ungrantedSite({ loadContentScript: () => {} });
    const { setArgs } = appendVideo();

    await expect(fake.action.click({ id: TAB_ID })).resolves.toBeUndefined();

    expect(fake.scripting.executeScriptCalls).toHaveLength(1);
    expect(setArgs).toEqual([]);
  });

  /**
   * The unbounded-retry shape: injection reports success and delivery still never lands.
   * "Inject until it works" would spin for ever here.
   *
   * The 2 s timeout is deliberately short because the failure guarded against is
   * non-termination. It can fail at all only because the fake's `sendMessage` and
   * `executeScript` cross a macrotask; a microtask-only loop starves the timer queue and
   * hangs instead (DECISIONS 32).
   */
  const noLoopTimeoutMs = 2000;

  it(
    'does not loop when delivery keeps failing however often it injects',
    async () => {
      const fake = await ungrantedSite({ loadContentScript: () => {} });
      fake.tabs.sendMessageFailure = new Error(
        'Could not establish connection. Receiving end does not exist.',
      );

      await expect(fake.action.click({ id: TAB_ID })).resolves.toBeUndefined();

      expect(fake.scripting.executeScriptCalls).toHaveLength(1);
    },
    noLoopTimeoutMs,
  );

  /**
   * The guard on the guard (DECISIONS 61). Everything the test above can prove rests on
   * the fake's `tick()` being a **macrotask**. Downgrade it to `Promise.resolve()` and the
   * whole suite stays green while that test silently stops being one — measured: the
   * worker OOMs after about a minute with **zero failed tests and no named test**.
   */
  it('crosses a macrotask, which is the only reason the test above can fail instead of hang', async () => {
    const fake = await ungrantedSite({ loadContentScript: () => {} });

    let settled = false;
    const delivery = fake.tabs
      .sendMessage(TAB_ID, { type: TOGGLE_PIP })
      .then(
        () => 'resolved',
        () => 'rejected',
      )
      .then((outcome) => {
        settled = true;
        return outcome;
      });

    // Drain the microtask queue far more thoroughly than any retry loop would in one pass.
    // If `tick()` were `Promise.resolve()`, `sendMessage` would settle in the first few.
    for (let turn = 0; turn < 500; turn += 1) await Promise.resolve();

    expect(settled).toBe(false);

    // And it does settle once the timer queue gets a turn — otherwise this would also
    // "pass" against a `tick()` that never resolved at all.
    await expect(delivery).resolves.toBe('rejected');
    expect(settled).toBe(true);
  });
});

describe('the injected content script is idempotent (RRR §4.1)', () => {
  it('does not double-toggle when a second copy lands on a page that has one', async () => {
    const fake = await grantedSite();
    const { setArgs } = appendVideo();

    // What `scripting.executeScript` delivers to a page whose declared content script is
    // already running: a second full evaluation of the same file.
    await loadContentScript();

    await fake.action.click({ id: TAB_ID });

    // One toggle. Two would enter PiP and immediately leave it — a visible no-op, and the
    // button would look broken precisely on the sites that work.
    expect(setArgs).toEqual(['picture-in-picture']);
  });

  it('registers exactly one message listener however many copies arrive', async () => {
    const fake = await grantedSite();

    // The fake collapses the background and the page into one realm (deviation 5), so this
    // is the sum of both. "The content script contributes exactly one" is pinned separately
    // by the last tripwire test in this file, which loads *only* the content script — so
    // this baseline cannot drift into meaninglessness if a listener is added somewhere.
    const baseline = 1;
    expect(fake.runtime.onMessage.listenerCount).toBe(baseline);
    expect((globalThis as Record<string, unknown>)[CONTENT_SCRIPT_FRAME_FLAG]).toBe(true);

    await loadContentScript();
    await loadContentScript();
    await loadContentScript();

    // The `keyup` listener is guarded by the same claim but deliberately not exercised
    // here: `document` is shared by every test in this file, so a key event would fire the
    // listeners left by earlier tests too. `content.test.ts` owns the hotkey path.
    expect(fake.runtime.onMessage.listenerCount).toBe(baseline);
  });

  it('does claim a genuinely fresh frame — the guard is not simply always off', async () => {
    // A guard that refused *every* copy, the first included, would leave the two tests
    // above green with the extension entirely dead.
    const fake = await ungrantedSite();
    const { setArgs } = appendVideo();

    await fake.action.click({ id: TAB_ID });

    expect(setArgs).toEqual(['picture-in-picture']);
  });
});

describe('the message contract', () => {
  it('pins the wire string', () => {
    // Both sides import the constant, so a rename cannot desynchronise them — but it would
    // break an extension mid upgrade, so the literal is pinned to make it a deliberate act.
    expect(TOGGLE_PIP).toBe('piposs:toggle');
  });

  it('is ignored by the content script when the type does not match exactly', async () => {
    const fake = await grantedSite();
    const { setArgs } = appendVideo();

    const nearMisses: unknown[] = [
      { type: 'piposs:toggel' },
      { type: 'piposs:toggle ' },
      { type: 'PiPOSS:toggle' },
      { type: 'toggle' },
      { type: undefined },
      { kind: TOGGLE_PIP },
      TOGGLE_PIP,
      {},
      null,
      undefined,
      42,
    ];
    for (const message of nearMisses) {
      fake.runtime.onMessage.emit(message, { id: 'org.artginzburg.PiPOSS.Extension' });
    }

    expect(setArgs).toEqual([]);
  });

  it('is acted on when the type matches, whatever else the message carries', async () => {
    const fake = await grantedSite();
    const { setArgs } = appendVideo();

    fake.runtime.onMessage.emit(
      { type: TOGGLE_PIP, somethingAFutureVersionAdded: true },
      { id: 'org.artginzburg.PiPOSS.Extension' },
    );

    expect(setArgs).toEqual(['picture-in-picture']);
  });

  it('does not claim it will reply', async () => {
    const fake = await grantedSite();
    appendVideo();

    // Returning `true` (or a promise) from an `onMessage` listener tells the browser to
    // hold the channel open for a reply that never comes; the sender then waits until the
    // channel is torn down.
    const returned = fake.runtime.onMessage.emit(
      { type: TOGGLE_PIP },
      { id: 'org.artginzburg.PiPOSS.Extension' },
    );

    // One entry per listener. The length is asserted alongside the value because an empty
    // array would also satisfy a `.every()`.
    expect(fake.runtime.onMessage.listenerCount).toBe(1);
    expect(returned).toEqual([undefined]);
  });
});

/*
 * No first-run test, and the reason is the one thing worth keeping: `runtime.onInstalled` fires
 * **per Safari profile**, so an install-time options tab opens in every profile at once.
 */

describe("the fake's own tripwires", () => {
  it('records every forbidden API call, so the silence assertions cannot go stale', () => {
    // Without this, a tripwire could quietly stop working and every `forbiddenApiCalls`
    // assertion above would read as a pass for ever (DECISIONS 49's pattern).
    const fake = installFakeBrowser();

    fake.action.setBadgeText({ text: '!' });
    fake.action.setTitle({ title: 'no video here' });
    fake.notifications.create({ title: 'hi' });
    fake.tabs.query({ active: true });

    expect(fake.forbiddenApiCalls).toEqual([
      'action.setBadgeText',
      'action.setTitle',
      'notifications.create',
      'tabs.query',
    ]);
  });

  it('refuses to inject when the test supplied no loader, instead of granting silently', async () => {
    // An `executeScript` that marked the tab reachable without running anything would let
    // a test "prove" the ungranted case works with nothing in fact injected.
    const fake = installFakeBrowser();

    await expect(
      fake.scripting.executeScript({ target: { tabId: TAB_ID }, files: [CONTENT_SCRIPT_FILE] }),
    ).rejects.toThrow(/supplied no loadContentScript/);

    expect(fake.contentScripts.tabIds).toEqual([]);
  });

  it('does not deliver to a tab whose content script never ran, listener or not', async () => {
    // Deviation 5: delivery is gated on the registry, not on "is anything listening in
    // this realm" — which is what made the ungranted case structurally invisible before.
    const fake = installFakeBrowser({ loadContentScript });
    await loadContentScript();

    expect(fake.runtime.onMessage.listenerCount).toBe(1);
    await expect(fake.tabs.sendMessage(TAB_ID, { type: TOGGLE_PIP })).rejects.toThrow(
      /Could not establish connection/,
    );
  });
});
