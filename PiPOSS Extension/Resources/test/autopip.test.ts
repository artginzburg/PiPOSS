/**
 * RRR §4.6: with `autoPipOnTabHide` on, a video that is playing when the tab stops being
 * visible floats out on its own — and stays floating when the user comes back.
 *
 * The feature fires with no user action, on every page, in every frame, which is what the
 * shape of this file follows from:
 *
 * - **Off by default** (RRR §3), so the *absence* of a stored value must produce a page
 *   that does nothing on a tab switch.
 * - **Every exclusion is pinned twice** — against the predicate and end to end through the
 *   listener — because the predicate is what a later refactor will "simplify".
 * - **Entry goes through `togglePiP`** (DECISIONS 174), because the restore record it
 *   maintains is what stops the next hotkey press putting the user into a mode they never
 *   chose. "the next manual toggle …" below is green through `togglePiP` and red against a
 *   direct `controller.setMode`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MIN_AUTO_PIP_DURATION_SECONDS,
  type AutoPipBinding,
  enableAutoPip,
  isAutoPipEligible,
  pickAutoPipVideo,
} from '../src/core/autopip';
import {
  FakePresentationController,
  PresentationMode,
  lastPresentationModeOf,
  togglePiP,
} from '../src/core/presentation';
import { DEFAULTS, SETTINGS_KEY, saveSettings } from '../src/core/settings';
import { installFakeBrowser, uninstallFakeBrowser } from './helpers/fake-browser';
import { macrotask } from './helpers/timing';
import {
  type PlaybackState,
  appendVideo as appendStubbedVideo,
  definePlayback,
} from './helpers/video';

/**
 * A video in a given playback state. {@link definePlayback}'s defaults are the *eligible*
 * case — playing, unmuted, long enough — so every test names only the property it is about.
 */
function makeVideo(state: PlaybackState = {}): HTMLVideoElement {
  const video = document.createElement('video');
  definePlayback(video, state);
  return video;
}

/** A video in the document, which is where {@link enableAutoPip} looks for it. */
function appendVideo(state: PlaybackState = {}): HTMLVideoElement {
  const video = makeVideo(state);
  document.body.appendChild(video);
  return video;
}

/**
 * Drives `document.visibilityState` and the event that reports it together — a test that
 * dispatched the event without moving the state would pass against a handler that never
 * checks it.
 */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

let controller: FakePresentationController;
let binding: AutoPipBinding | null = null;

/** Installs the fake with the given stored settings and starts the feature. */
async function start(stored: Record<string, unknown> = { autoPipOnTabHide: true }) {
  installFakeBrowser({ items: { [SETTINGS_KEY]: stored } });
  binding = enableAutoPip({ controller });
  await binding.ready;
  return binding;
}

beforeEach(() => {
  controller = new FakePresentationController();
  document.body.innerHTML = '';
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  binding?.disable();
  binding = null;
  uninstallFakeBrowser();
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('isAutoPipEligible', () => {
  it('draws the line at five seconds, the number RRR §4.6 names', () => {
    // The other duration tests spell the constant symbolically, which expresses the
    // boundary but leaves the *value* unpinned: at 4 the whole suite stayed green.
    expect(MIN_AUTO_PIP_DURATION_SECONDS).toBe(5);
  });

  it('accepts a playing, unmuted, long-enough video', () => {
    expect(isAutoPipEligible(makeVideo())).toBe(true);
  });

  it('rejects a paused video', () => {
    expect(isAutoPipEligible(makeVideo({ paused: true }))).toBe(false);
  });

  it('rejects a muted video', () => {
    expect(isAutoPipEligible(makeVideo({ muted: true }))).toBe(false);
  });

  it('rejects a video shorter than the minimum', () => {
    expect(isAutoPipEligible(makeVideo({ duration: 2 }))).toBe(false);
    // Literal, deliberately: a lowered threshold would still satisfy every assertion
    // written in terms of the constant, and 4.5 s is a plausible decorative loop.
    expect(isAutoPipEligible(makeVideo({ duration: 4.5 }))).toBe(false);
    expect(isAutoPipEligible(makeVideo({ duration: MIN_AUTO_PIP_DURATION_SECONDS - 0.01 }))).toBe(
      false,
    );
  });

  it('accepts a video of exactly the minimum duration', () => {
    // "shorter than 5 seconds" excludes; five seconds itself does not.
    expect(isAutoPipEligible(makeVideo({ duration: MIN_AUTO_PIP_DURATION_SECONDS }))).toBe(true);
  });

  it('accepts a live stream, whose duration is Infinity', () => {
    expect(isAutoPipEligible(makeVideo({ duration: Number.POSITIVE_INFINITY }))).toBe(true);
  });

  it('accepts a video whose duration is not known yet', () => {
    // `NaN` means "no metadata", not "short": excluding it would silently drop real videos.
    expect(isAutoPipEligible(makeVideo({ duration: Number.NaN }))).toBe(true);
  });
});

describe('pickAutoPipVideo', () => {
  it('returns null when there are no videos', () => {
    expect(pickAutoPipVideo([], controller)).toBeNull();
  });

  it('does not pick a lone paused video, unlike the hotkey (pickVideo)', () => {
    // `pickVideo` gives a lone video to the hotkey whether it plays or not, because the
    // user pressed a key and meant *that* video. Nobody pressed anything here, and RRR
    // §4.6 says "while a video is playing" — so the rules deliberately differ.
    expect(pickAutoPipVideo([makeVideo({ paused: true })], controller)).toBeNull();
  });

  it('returns the first eligible video when several exist', () => {
    const paused = makeVideo({ paused: true });
    const muted = makeVideo({ muted: true });
    const playing = makeVideo();
    const second = makeVideo();

    expect(pickAutoPipVideo([paused, muted, playing, second], controller)).toBe(playing);
  });

  it('returns null when a video on the page is already in PiP', () => {
    // Only one PiP window exists, so a second video would evict what the user is watching.
    const floating = makeVideo({ paused: true });
    const playing = makeVideo();
    controller.setInitialMode(floating, PresentationMode.PIP);

    expect(pickAutoPipVideo([floating, playing], controller)).toBeNull();
  });

  it('returns null when the eligible video is itself already in PiP', () => {
    const video = makeVideo();
    controller.setInitialMode(video, PresentationMode.PIP);

    expect(pickAutoPipVideo([video], controller)).toBeNull();
  });
});

describe('enableAutoPip', () => {
  it('does nothing when nothing is stored — off by default (RRR §3)', async () => {
    const video = appendVideo();
    const started = await start({});

    expect(started.enabled).toBe(false);

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
    expect(lastPresentationModeOf(video)).toBeUndefined();
  });

  it('does nothing when the setting is explicitly off', async () => {
    appendVideo();
    await start({ autoPipOnTabHide: false });

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('puts the playing video into PiP when the tab stops being visible', async () => {
    const video = appendVideo();
    const started = await start();

    expect(started.enabled).toBe(true);

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('does not fire while the document is still visible', async () => {
    appendVideo();
    await start();

    // A `visibilitychange` reporting "visible" is the *return*, and a page hears one for
    // other reasons too. The state, not the event, is the trigger.
    setVisibility('visible');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('does not fire in a prerendered document, which no user has ever seen', async () => {
    appendVideo();
    await start();

    // Why RRR §4.6 says `visibilityState === 'hidden'` and not `document.hidden`: `hidden`
    // is merely `visibilityState !== 'visible'`, so it is *true* here. The cast is needed
    // because `prerender` is a real platform value TypeScript's `DocumentVisibilityState`
    // has dropped — which is itself why the narrower check is the correct one.
    setVisibility('prerender' as DocumentVisibilityState);

    expect(controller.setModeCalls).toEqual([]);
  });

  it('does not restore when the user comes back, with autoRestoreOnTabReturn off (RRR §4.6)', async () => {
    const video = appendVideo();
    await start({ autoPipOnTabHide: true, autoRestoreOnTabReturn: false });

    setVisibility('hidden');
    expect(controller.modeOf(video)).toBe(PresentationMode.PIP);

    setVisibility('visible');

    // The default, and the answer for anyone who has not asked otherwise: the user may have
    // kept it floating on purpose. One entry, no exit.
    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
    expect(controller.modeOf(video)).toBe(PresentationMode.PIP);
  });

  it('does not fire again for a video it already floated', async () => {
    const video = appendVideo();
    await start({ autoPipOnTabHide: true, autoRestoreOnTabReturn: false });

    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');

    // The second hide finds the video already in PiP; taking it back out would be the
    // worst possible reading of "toggle".
    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('leaves a paused video alone', async () => {
    appendVideo({ paused: true });
    await start();

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('leaves a muted video alone', async () => {
    // The silent-hero / GIF-as-video case: `muted autoplay loop`, often far longer than
    // five seconds, on a great many ordinary pages.
    appendVideo({ muted: true });
    await start();

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('leaves a clip shorter than five seconds alone', async () => {
    appendVideo({ duration: 3 });
    await start();

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('does nothing on a page with no video', async () => {
    await start();

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('does nothing when the browser cannot do PiP for this video', async () => {
    controller.supported = false;
    appendVideo();
    await start();

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('skips the videos that are excluded and floats the one that is not', async () => {
    appendVideo({ muted: true });
    appendVideo({ duration: 1 });
    const watching = appendVideo();
    await start();

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([{ video: watching, mode: PresentationMode.PIP }]);
  });

  it('enters through togglePiP rather than setting the mode itself', async () => {
    const video = appendVideo();
    await start();

    setVisibility('hidden');

    // `togglePiP`'s fingerprint: it asks whether PiP is supported at all, and it
    // records the mode it is leaving. A direct `controller.setMode` does neither.
    expect(controller.calls.some((call) => call.method === 'supportsPiP')).toBe(true);
    expect(lastPresentationModeOf(video)).toBe(PresentationMode.INLINE);
  });

  it('enters through togglePiP, so the next manual toggle cannot restore a mode the user never chose', async () => {
    const video = appendVideo();
    await start();

    // An ordinary history that makes the record stale: watching fullscreen, hotkey in
    // (record := 'fullscreen'), hotkey out, then leaving fullscreen with the player's own
    // control, which never reaches us. The record is deliberately not cleared (DECISIONS 168).
    controller.setInitialMode(video, 'fullscreen');
    togglePiP(video, controller);
    togglePiP(video, controller);
    controller.setInitialMode(video, PresentationMode.INLINE);
    expect(lastPresentationModeOf(video)).toBe('fullscreen');

    setVisibility('hidden');

    expect(controller.modeOf(video)).toBe(PresentationMode.PIP);
    // Rewritten, because the entry went through `togglePiP` (DECISIONS 174).
    expect(lastPresentationModeOf(video)).toBe(PresentationMode.INLINE);

    togglePiP(video, controller);

    // Inline: where they actually were. A direct `setMode` would have left the stale record
    // standing and thrown them into fullscreen instead.
    expect(controller.modeOf(video)).toBe(PresentationMode.INLINE);
  });

  it('finds a video that appeared after the listener was attached', async () => {
    await start();

    // No observer, no cached list: the videos are looked up when the tab hides, which
    // is the only moment the answer matters.
    const video = appendVideo();
    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('does nothing before the stored setting has arrived', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { autoPipOnTabHide: true } } });
    const started = enableAutoPip({ controller });
    binding = started;
    const video = appendVideo();

    // For a feature that acts with no user action, `false` is both the default and the
    // conservative answer.
    expect(started.enabled).toBe(false);
    setVisibility('hidden');
    expect(controller.setModeCalls).toEqual([]);

    await started.ready;

    expect(started.enabled).toBe(true);
    setVisibility('visible');
    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('survives a page with no browser API at all', async () => {
    // A content script runs in frames where the extension APIs are absent; RRR §4.1
    // says the answer there is silence, not a throw.
    const video = appendVideo();
    binding = enableAutoPip({ controller });
    await binding.ready;

    expect(binding.enabled).toBe(false);
    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
    expect(lastPresentationModeOf(video)).toBeUndefined();
  });

  it('turns on without a page reload (RRR §3)', async () => {
    const video = appendVideo();
    const started = await start({ autoPipOnTabHide: false });

    await saveSettings({ autoPipOnTabHide: true });
    await macrotask();

    expect(started.enabled).toBe(true);

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('turns off without a page reload', async () => {
    appendVideo();
    const started = await start();

    await saveSettings({ autoPipOnTabHide: false });
    await macrotask();

    expect(started.enabled).toBe(false);

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
  });

  it('ignores a stale first read that lands after a change was applied', async () => {
    // DECISIONS 85 in the other direction: a slow read carrying the *previous* value must
    // not switch the feature back off a moment after the user turned it on.
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { autoPipOnTabHide: false } } });

    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realGet = fake.storage.local.get.bind(fake.storage.local);
    fake.storage.local.get = async (keys?: string | string[] | null) => {
      const items = await realGet(keys);
      await gate;
      return items;
    };

    const started = enableAutoPip({ controller });
    binding = started;

    fake.storage.onChanged.emit({
      [SETTINGS_KEY]: { newValue: { autoPipOnTabHide: true } },
    });
    expect(started.enabled).toBe(true);

    release();
    await started.ready;

    expect(started.enabled).toBe(true);
  });

  it('detaches the listener and the subscription on disable', async () => {
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { autoPipOnTabHide: true } } });
    const started = enableAutoPip({ controller });
    await started.ready;
    appendVideo();

    expect(fake.storage.onChanged.listenerCount).toBe(1);

    started.disable();
    started.disable(); // Idempotent.
    binding = null;

    setVisibility('hidden');

    expect(controller.setModeCalls).toEqual([]);
    expect(fake.storage.onChanged.listenerCount).toBe(0);
  });

  it('watches the document it is given', async () => {
    // `all_frames: true` means one binding per frame, each on its own document, so the
    // target has to be a parameter rather than the ambient global.
    const other = document.implementation.createHTMLDocument('other');
    const video = other.createElement('video');
    definePlayback(video);
    other.body.appendChild(video);
    Object.defineProperty(other, 'visibilityState', { value: 'hidden', configurable: true });

    appendVideo(); // The ambient document's video, which must be left alone.

    installFakeBrowser({ items: { [SETTINGS_KEY]: { autoPipOnTabHide: true } } });
    binding = enableAutoPip({ controller, target: other });
    await binding.ready;

    other.dispatchEvent(new Event('visibilitychange'));

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });
});

/**
 * RRR §4.6's opt-in return half: `autoRestoreOnTabReturn` puts back what auto-PiP took, and
 * nothing else.
 *
 * The shape of this file follows from what the setting is allowed to claim. "Nothing else" is
 * two conditions, and each has its own test here because either one alone is a feature that
 * closes a floating window the user chose to keep:
 *
 * - the video must be one **this binding floated** — never one already in PiP when the tab hid;
 * - it must have been in PiP **continuously since**, which is why a claim expires on the
 *   browser's own mode report rather than on a mode read at return time. The
 *   out-and-back-in-by-hand test below is red against a live-mode check and green against the
 *   subscription: both end with the video in PiP, and only the report tells them apart.
 */
describe('coming back to the tab', () => {
  /** Both halves on. The parent alone is the default `start()`. */
  const bothOn = { autoPipOnTabHide: true, autoRestoreOnTabReturn: true };

  it('takes its own floating video back out of PiP', async () => {
    const video = appendVideo();
    await start(bothOn);

    setVisibility('hidden');
    setVisibility('visible');

    expect(controller.setModeCalls).toEqual([
      { video, mode: PresentationMode.PIP },
      { video, mode: PresentationMode.INLINE },
    ]);
  });

  it('restores the presentation the video came from, not merely inline', async () => {
    const video = appendVideo();
    controller.setInitialMode(video, 'fullscreen');
    await start(bothOn);

    setVisibility('hidden');
    setVisibility('visible');

    // Through `togglePiP`, whose record holds where the video was — the same answer the hotkey
    // would give. A `setMode(INLINE)` written here would pass every other test in this block.
    expect(controller.modeOf(video)).toBe('fullscreen');
  });

  it('asks for the document fullscreen the user floated out of (BF19)', async () => {
    const video = appendVideo();
    const player = document.createElement('div');
    document.body.appendChild(player);
    player.appendChild(video);
    await start(bothOn);

    controller.externalFullscreenChange(player);
    setVisibility('hidden');
    setVisibility('visible');

    // The request is made; whether Safari grants it is another matter, and the reason the
    // options page says a fullscreen player usually comes back inline — `requestFullscreen`
    // wants a user gesture, and returning to a tab is not one.
    expect(controller.fullscreenRequests).toEqual([player]);
  });

  it('leaves alone a video that was already floating before the tab hid', async () => {
    const video = appendVideo();
    controller.setInitialMode(video, PresentationMode.PIP);
    await start(bothOn);

    setVisibility('hidden');
    setVisibility('visible');

    // Nothing was floated by us, so there is nothing to put back. This is the user's own
    // floating window, and the objection RRR §4.6 raises against the whole feature.
    expect(controller.setModeCalls).toEqual([]);
  });

  it('leaves alone a video the user took out of PiP and floated again by hand', async () => {
    const video = appendVideo();
    await start(bothOn);

    setVisibility('hidden');

    // The system PiP window's close button, then the player's own PiP control — both reach us
    // only as the browser's report. The video ends where it started, in PiP, but this one is
    // the user's choice and not ours to undo.
    controller.externalModeChange(video, PresentationMode.INLINE);
    controller.externalModeChange(video, PresentationMode.PIP);

    setVisibility('visible');

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
    expect(controller.modeOf(video)).toBe(PresentationMode.PIP);
  });

  it('does nothing when the video is no longer in PiP at all', async () => {
    const video = appendVideo();
    await start(bothOn);

    setVisibility('hidden');
    controller.externalModeChange(video, PresentationMode.INLINE);
    setVisibility('visible');

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('does nothing when the player has been rebuilt out of the document', async () => {
    const video = appendVideo();
    await start(bothOn);

    setVisibility('hidden');
    video.remove();
    setVisibility('visible');

    // We hold the element, so it still exists and still answers `getMode`; the user is looking
    // at whatever the page put in its place.
    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('restores once, not on every later return', async () => {
    const video = appendVideo();
    await start(bothOn);

    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('visible');

    expect(controller.setModeCalls).toEqual([
      { video, mode: PresentationMode.PIP },
      { video, mode: PresentationMode.INLINE },
    ]);
  });

  it('floats and restores again on the next round trip', async () => {
    const video = appendVideo();
    await start(bothOn);

    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');
    setVisibility('visible');

    expect(controller.setModeCalls).toEqual([
      { video, mode: PresentationMode.PIP },
      { video, mode: PresentationMode.INLINE },
      { video, mode: PresentationMode.PIP },
      { video, mode: PresentationMode.INLINE },
    ]);
  });

  it('ignores a prerendered document, which is neither hidden nor visible', async () => {
    const video = appendVideo();
    await start(bothOn);

    setVisibility('hidden');
    setVisibility('prerender' as DocumentVisibilityState);

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('reads the setting at the moment of return, which is how it is switched on', async () => {
    const video = appendVideo();
    const started = await start({ autoPipOnTabHide: true, autoRestoreOnTabReturn: false });

    setVisibility('hidden');
    await saveSettings({ autoRestoreOnTabReturn: true });
    await macrotask();
    expect(started.restoreEnabled).toBe(true);

    setVisibility('visible');

    // Not a corner case but *the* first-use path: turning this on means leaving the video's tab
    // for the options page, which is the tab switch that floats it. The live setting is what
    // the user is looking at; a value latched when the tab hid would answer their first try
    // with nothing happening.
    expect(controller.setModeCalls).toEqual([
      { video, mode: PresentationMode.PIP },
      { video, mode: PresentationMode.INLINE },
    ]);
  });

  it('turns on without a page reload (RRR §3)', async () => {
    const video = appendVideo();
    const started = await start({ autoPipOnTabHide: true, autoRestoreOnTabReturn: false });

    await saveSettings({ autoRestoreOnTabReturn: true });
    await macrotask();
    expect(started.restoreEnabled).toBe(true);

    setVisibility('hidden');
    setVisibility('visible');

    expect(controller.modeOf(video)).toBe(PresentationMode.INLINE);
  });

  it('turns off without a page reload', async () => {
    const video = appendVideo();
    const started = await start(bothOn);

    await saveSettings({ autoRestoreOnTabReturn: false });
    await macrotask();
    expect(started.restoreEnabled).toBe(false);

    setVisibility('hidden');
    setVisibility('visible');

    expect(controller.modeOf(video)).toBe(PresentationMode.PIP);
  });

  it('starts at the RRR §3 default, which is safe because its parent does not', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { autoRestoreOnTabReturn: false } } });
    const started = enableAutoPip({ controller });
    binding = started;
    appendVideo();

    // Unlike `enabled`, this one starts at the default rather than at `false` — and the window
    // where it disagrees with storage cannot act, because floating a video at all needs
    // `enabled`, which is still false. Both halves are asserted, since the first alone would
    // pass against a binding that floats videos before it has been told to.
    expect(started.enabled).toBe(false);
    expect(started.restoreEnabled).toBe(DEFAULTS.autoRestoreOnTabReturn);

    setVisibility('hidden');
    setVisibility('visible');
    expect(controller.setModeCalls).toEqual([]);

    await started.ready;
    expect(started.restoreEnabled).toBe(false);
  });

  it('drops its mode subscription on disable', async () => {
    const video = appendVideo();
    const started = await start(bothOn);

    setVisibility('hidden');
    // Two: `togglePiP`'s own watch, and this binding's claim.
    expect(controller.listenerCount(video)).toBe(2);

    started.disable();
    binding = null;

    expect(controller.listenerCount(video)).toBe(1);
  });
});

/**
 * The composition root, end to end. Last in the file and imported once (DECISIONS 90): the
 * import attaches listeners to this file's single jsdom document and never detaches them.
 *
 * Without this test the whole feature can be correct and unreachable — which is the state
 * the owner found the toggle in (DECISIONS 163).
 */
describe('the composition root wires auto-PiP', () => {
  it('floats the playing video when the tab hides, and puts it back when it returns', async () => {
    installFakeBrowser({
      items: { [SETTINGS_KEY]: { autoPipOnTabHide: true, autoRestoreOnTabReturn: true } },
    });

    const { setArgs } = appendStubbedVideo({ paused: false, mode: PresentationMode.INLINE });

    vi.resetModules();
    await import('../src/content');
    // The content script's own settings read has to land before the tab hides.
    await macrotask();

    setVisibility('hidden');
    setVisibility('visible');

    // Both halves through the shipped wiring, because a feature that is correct and unreachable
    // is the state the owner found the last toggle in (DECISIONS 163). The import happens once
    // per file, so this is the only place the return half can be seen end to end.
    expect(setArgs).toEqual([PresentationMode.PIP, PresentationMode.INLINE]);
  });
});
