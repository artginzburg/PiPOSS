import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FakePresentationController,
  PresentationMode,
  WebKitPresentationController,
  lastPresentationModeOf,
  togglePiP,
  watchPresentation,
} from '../src/core/presentation';
import { stripComments } from './helpers/paths';
import { makeWebKitVideo } from './helpers/video';

function makeVideo(): HTMLVideoElement {
  return document.createElement('video');
}

describe('WebKitPresentationController', () => {
  it('asks WebKit about picture-in-picture support and returns its answer', () => {
    const controller = new WebKitPresentationController();

    const yes = makeWebKitVideo({ supports: true });
    expect(controller.supportsPiP(yes.video)).toBe(true);
    expect(yes.supportsArgs).toEqual(['picture-in-picture']);

    const no = makeWebKitVideo({ supports: false });
    expect(controller.supportsPiP(no.video)).toBe(false);
    expect(no.supportsArgs).toEqual(['picture-in-picture']);
  });

  it('reads the current mode from webkitPresentationMode', () => {
    const controller = new WebKitPresentationController();
    const { video } = makeWebKitVideo({ mode: 'fullscreen' });
    expect(controller.getMode(video)).toBe('fullscreen');
  });

  it('forwards setMode to webkitSetPresentationMode unchanged', () => {
    const controller = new WebKitPresentationController();
    const { video, setArgs } = makeWebKitVideo({});
    controller.setMode(video, PresentationMode.PIP);
    controller.setMode(video, 'fullscreen');
    expect(setArgs).toEqual(['picture-in-picture', 'fullscreen']);
  });

  it('drives a full toggle through the real controller against a stubbed element', () => {
    const controller = new WebKitPresentationController();
    const { video, setArgs } = makeWebKitVideo({ mode: PresentationMode.INLINE });

    togglePiP(video, controller);
    expect(setArgs).toEqual(['picture-in-picture']);
    expect(lastPresentationModeOf(video)).toBe('inline');

    togglePiP(video, controller);
    expect(setArgs).toEqual(['picture-in-picture', 'inline']);
    // Leaving PiP does not touch the record: the value is the mode we entered
    // from, and it stays that until the next entry overwrites it (BF01).
    expect(lastPresentationModeOf(video)).toBe('inline');
  });

  it('subscribes to WebKit’s own presentation report, and unsubscribes on stop', () => {
    // Delegation only: we register for *that* event name on *that* element and the handle
    // we hand back really deregisters. WebKit's own dispatch is not ours to test (RRR §6).
    const controller = new WebKitPresentationController();
    const { video } = makeWebKitVideo({});
    let reports = 0;

    const stop = controller.onModeChange(video, () => {
      reports += 1;
    });

    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    expect(reports).toBe(1);

    stop();

    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    expect(reports).toBe(1);
  });

  it('follows WebKit’s reports through a hand-made fullscreen and an outside PiP entry', () => {
    // Driven by the events WebKit would send rather than by the fake's
    // `externalModeChange`. The one test that pins the event name against the production
    // listener; a typo in either makes it red.
    const controller = new WebKitPresentationController();
    const { video, setArgs } = makeWebKitVideo({ mode: PresentationMode.INLINE });
    const report = (): boolean => video.dispatchEvent(new Event('webkitpresentationmodechanged'));

    togglePiP(video, controller); // inline → PiP
    report();
    togglePiP(video, controller); // PiP → inline
    report();

    video.webkitPresentationMode = 'fullscreen'; // the user, by hand
    report();
    video.webkitPresentationMode = PresentationMode.PIP; // Safari's own control
    report();

    togglePiP(video, controller);

    expect(setArgs).toEqual(['picture-in-picture', 'inline', 'fullscreen']);
    expect(video.webkitPresentationMode).toBe('fullscreen');
  });
});

describe('FakePresentationController', () => {
  it('reports support and records every call', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    expect(controller.supportsPiP(video)).toBe(true);
    expect(controller.getMode(video)).toBe('inline');
    controller.setMode(video, PresentationMode.PIP);

    expect(controller.calls).toEqual([
      { method: 'supportsPiP', video },
      { method: 'getMode', video },
      { method: 'setMode', video, mode: 'picture-in-picture' },
    ]);
    expect(controller.setModeCalls).toEqual([{ video, mode: 'picture-in-picture' }]);
  });

  it('remembers the mode it was told to set', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    controller.setMode(video, 'fullscreen');
    expect(controller.getMode(video)).toBe('fullscreen');
    expect(controller.modeOf(video)).toBe('fullscreen');
  });

  it('can be seeded with a starting mode without recording a call', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    controller.setInitialMode(video, PresentationMode.PIP);
    expect(controller.calls).toEqual([]);
    expect(controller.modeOf(video)).toBe('picture-in-picture');
  });

  it('can pretend picture-in-picture is unsupported', () => {
    const controller = new FakePresentationController({ supported: false });
    const video = makeVideo();
    expect(controller.supportsPiP(video)).toBe(false);
  });

  it('reports external mode changes to its subscribers, per video', () => {
    const controller = new FakePresentationController();
    const a = makeVideo();
    const b = makeVideo();
    const seen: VideoPresentationMode[] = [];

    controller.onModeChange(a, () => {
      seen.push(controller.modeOf(a));
    });

    controller.externalModeChange(a, 'fullscreen');
    controller.externalModeChange(b, PresentationMode.PIP);

    expect(seen).toEqual(['fullscreen']);
    expect(controller.modeOf(b)).toBe('picture-in-picture');
  });

  it('keeps subscribing and unsubscribing out of the call log', () => {
    // `calls` is asserted by exact equality in several suites, so bookkeeping must
    // not appear in it. `listenerCount` is the observable that matters instead.
    const controller = new FakePresentationController();
    const video = makeVideo();

    const stop = controller.onModeChange(video, () => undefined);
    expect(controller.listenerCount(video)).toBe(1);
    controller.externalModeChange(video, PresentationMode.PIP);
    stop();

    expect(controller.listenerCount(video)).toBe(0);
    expect(controller.calls).toEqual([]);
  });

  it('does not report our own setMode, so an unreported transition stays testable', () => {
    // A deliberate divergence: real Safari would report this. Firing it here would make
    // every toggle look observed and hide the eventless path.
    const controller = new FakePresentationController();
    const video = makeVideo();
    let reports = 0;

    controller.onModeChange(video, () => {
      reports += 1;
    });

    controller.setMode(video, PresentationMode.PIP);
    controller.setInitialMode(video, 'fullscreen');

    expect(reports).toBe(0);
  });

  it('tracks videos independently', () => {
    const controller = new FakePresentationController();
    const a = makeVideo();
    const b = makeVideo();

    controller.setMode(a, PresentationMode.PIP);
    expect(controller.modeOf(a)).toBe('picture-in-picture');
    expect(controller.modeOf(b)).toBe('inline');
  });
});

describe('togglePiP', () => {
  it('does nothing at all when picture-in-picture is unsupported', () => {
    const controller = new FakePresentationController({ supported: false });
    const video = makeVideo();

    togglePiP(video, controller);

    expect(controller.setModeCalls).toEqual([]);
    expect(lastPresentationModeOf(video)).toBeUndefined();
    // And it did not even start watching: an unsupported video is not ours.
    expect(controller.listenerCount(video)).toBe(0);
  });

  it('enters picture-in-picture from inline and stores the previous mode', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    togglePiP(video, controller);

    expect(controller.setModeCalls).toEqual([{ video, mode: 'picture-in-picture' }]);
    expect(lastPresentationModeOf(video)).toBe('inline');
  });

  it('enters picture-in-picture from fullscreen and stores fullscreen', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();
    controller.setInitialMode(video, 'fullscreen');

    togglePiP(video, controller);

    expect(controller.setModeCalls).toEqual([{ video, mode: 'picture-in-picture' }]);
    expect(lastPresentationModeOf(video)).toBe('fullscreen');
  });

  it('restores the mode the browser reported it entered PiP from', () => {
    // The browser reports the transitions and the record follows them — never a value
    // this test wrote onto the element (BF02).
    const controller = new FakePresentationController();
    const video = makeVideo();

    watchPresentation(video, controller);
    controller.externalModeChange(video, 'fullscreen');
    controller.externalModeChange(video, PresentationMode.PIP);

    expect(lastPresentationModeOf(video)).toBe('fullscreen');

    togglePiP(video, controller);

    expect(controller.setModeCalls).toEqual([{ video, mode: 'fullscreen' }]);
  });

  it('falls back to inline when leaving picture-in-picture with nothing stored', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();
    controller.setInitialMode(video, PresentationMode.PIP);

    togglePiP(video, controller);

    expect(controller.setModeCalls).toEqual([{ video, mode: 'inline' }]);
  });

  it('does not touch the stored mode while leaving PiP', () => {
    // Recorded only when *entering*, so the record keeps saying what the video will be
    // restored to. Writing the pre-call mode unconditionally produced the wedge of
    // DECISIONS 29 (BF01).
    const controller = new FakePresentationController();
    const video = makeVideo();

    watchPresentation(video, controller);
    controller.externalModeChange(video, PresentationMode.PIP);
    expect(lastPresentationModeOf(video)).toBe('inline');

    togglePiP(video, controller);

    expect(controller.setModeCalls).toEqual([{ video, mode: 'inline' }]);
    expect(lastPresentationModeOf(video)).toBe('inline');
  });

  it('records nothing at all when leaving PiP it never saw entered', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();
    controller.setInitialMode(video, PresentationMode.PIP);

    togglePiP(video, controller);

    expect(lastPresentationModeOf(video)).toBeUndefined();
  });

  it('round-trips inline → PiP → inline → PiP through repeated toggles', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    togglePiP(video, controller);
    togglePiP(video, controller);
    togglePiP(video, controller);

    expect(controller.setModeCalls.map((call) => call.mode)).toEqual([
      'picture-in-picture',
      'inline',
      'picture-in-picture',
    ]);
    expect(lastPresentationModeOf(video)).toBe('inline');
  });

  it('round-trips fullscreen → PiP → fullscreen through repeated toggles', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();
    controller.setInitialMode(video, 'fullscreen');

    togglePiP(video, controller);
    togglePiP(video, controller);
    togglePiP(video, controller);

    expect(controller.setModeCalls.map((call) => call.mode)).toEqual([
      'picture-in-picture',
      'fullscreen',
      'picture-in-picture',
    ]);
    expect(lastPresentationModeOf(video)).toBe('fullscreen');
  });

  it('reconciles a transition nothing reported, so a stale record cannot survive a toggle', () => {
    // The half that does not depend on the event existing: every toggle folds in the mode
    // it reads live before acting. Without it a *stale* belief about the current mode
    // silences the next entry — the mode we asked for looks like the mode we already had —
    // and the user is restored to a fullscreen he left minutes ago.
    const controller = new FakePresentationController();
    const video = makeVideo();
    controller.setInitialMode(video, 'fullscreen');

    togglePiP(video, controller); // fullscreen → PiP
    togglePiP(video, controller); // PiP → fullscreen
    expect(lastPresentationModeOf(video)).toBe('fullscreen');

    // And now a transition with no report at all — the residual BF02 cannot remove.
    controller.setInitialMode(video, PresentationMode.INLINE);

    togglePiP(video, controller); // inline → PiP

    expect(lastPresentationModeOf(video)).toBe(PresentationMode.INLINE);

    togglePiP(video, controller);

    expect(controller.modeOf(video)).toBe(PresentationMode.INLINE);
  });

  it('never lets the record hold picture-in-picture, however the video moves', () => {
    // Restoring PiP *from* PiP would ask WebKit for the mode the video is already in —
    // the wedge of DECISIONS 29. This pins it at the source rather than at a filter, and
    // over every transition rather than one forged value: the pre-BF01 shape of `note`
    // (record the previous mode on *every* transition, not only into PiP) makes it red on
    // the third assertion.
    const controller = new FakePresentationController();
    const video = makeVideo();

    watchPresentation(video, controller);

    for (const mode of [
      PresentationMode.PIP,
      PresentationMode.INLINE,
      'fullscreen',
      PresentationMode.PIP,
      'fullscreen',
      PresentationMode.PIP,
      PresentationMode.INLINE,
    ] satisfies VideoPresentationMode[]) {
      controller.externalModeChange(video, mode);
      expect(lastPresentationModeOf(video)).not.toBe(PresentationMode.PIP);
    }

    togglePiP(video, controller); // inline → PiP
    expect(lastPresentationModeOf(video)).not.toBe(PresentationMode.PIP);
    togglePiP(video, controller); // and out again
    expect(lastPresentationModeOf(video)).not.toBe(PresentationMode.PIP);
    expect(controller.modeOf(video)).toBe('inline');
  });

  it('restores a presentation mode it has never heard of, rather than flattening it', () => {
    // What makes the guard a *deny* of 'picture-in-picture' rather than an allowlist:
    // `previous === 'fullscreen' ? previous : INLINE` passes every other test in this
    // suite and would silently drop a WebKit mode added after this build.
    //
    // The cast belongs in the test: `VideoPresentationMode` is a closed 3-value union
    // today, and widening it to express "a fourth mode" would delete the condition being
    // pinned.
    const futureMode = 'a-mode-from-a-later-webkit' as unknown as VideoPresentationMode;
    const controller = new FakePresentationController();
    const video = makeVideo();
    controller.setInitialMode(video, futureMode);

    togglePiP(video, controller); // future mode → PiP
    togglePiP(video, controller); // PiP → back to the future mode

    expect(lastPresentationModeOf(video)).toBe(futureMode);
    expect(controller.setModeCalls.map((call) => call.mode)).toEqual([
      'picture-in-picture',
      futureMode,
    ]);
    expect(controller.modeOf(video)).toBe(futureMode);
  });

  it('leaves PiP after Safari’s own control re-entered it (DECISIONS 29)', () => {
    // The reported sequence: in, out, then the user re-enters PiP with the player's own
    // control — which never goes through togglePiP. One toggle must get back to the page.
    const controller = new FakePresentationController();
    const video = makeVideo();

    togglePiP(video, controller); // inline → PiP
    togglePiP(video, controller); // PiP → inline

    controller.setInitialMode(video, PresentationMode.PIP); // Safari's own control

    togglePiP(video, controller);

    expect(controller.modeOf(video)).toBe('inline');
    expect(controller.setModeCalls.map((call) => call.mode)).toEqual([
      'picture-in-picture',
      'inline',
      'inline',
    ]);
  });

  it('restores fullscreen when Safari’s own control re-entered PiP from fullscreen', () => {
    // Why the record is kept rather than cleared on the way out: an entry we did not
    // perform is restored to the right place instead of dropping the user to inline.
    const controller = new FakePresentationController();
    const video = makeVideo();
    controller.setInitialMode(video, 'fullscreen');

    togglePiP(video, controller); // fullscreen → PiP
    togglePiP(video, controller); // PiP → fullscreen

    controller.setInitialMode(video, PresentationMode.PIP); // Safari's own control

    togglePiP(video, controller);

    expect(controller.modeOf(video)).toBe('fullscreen');
  });

  it('restores fullscreen when the browser reported the fullscreen and the PiP entry (BF02)', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    togglePiP(video, controller); // inline → PiP
    togglePiP(video, controller); // PiP → inline

    controller.externalModeChange(video, 'fullscreen'); // the user, by hand
    controller.externalModeChange(video, PresentationMode.PIP); // Safari's own control

    togglePiP(video, controller);

    expect(controller.modeOf(video)).toBe('fullscreen');
  });

  it('writes nothing onto the element, so page script cannot read or forge the record', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    togglePiP(video, controller);
    togglePiP(video, controller);

    expect(video.getAttributeNames()).toEqual([]);
    expect(Object.keys(video.dataset)).toEqual([]);
  });

  it('ignores a restore mode the page wrote into the element’s data attribute', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    togglePiP(video, controller); // inline → PiP

    // `setAttribute`, not `dataset`, because that is what page script has: this is
    // the reach a hostile or merely buggy page had over `webkitSetPresentationMode`.
    video.setAttribute('data-last-presentation-mode', 'fullscreen');

    togglePiP(video, controller);

    expect(controller.setModeCalls.map((call) => call.mode)).toEqual([
      'picture-in-picture',
      'inline',
    ]);
  });

  it('enters PiP again after Safari’s own control left it', () => {
    // The user closes the PiP window himself, so the video is inline again without our
    // knowing. The next toggle is an entry, not an exit, and it re-records its origin.
    const controller = new FakePresentationController();
    const video = makeVideo();

    togglePiP(video, controller); // inline → PiP

    controller.setInitialMode(video, PresentationMode.INLINE); // Safari's own control

    togglePiP(video, controller);

    expect(controller.modeOf(video)).toBe('picture-in-picture');
    expect(controller.setModeCalls.map((call) => call.mode)).toEqual([
      'picture-in-picture',
      'picture-in-picture',
    ]);
    expect(lastPresentationModeOf(video)).toBe('inline');
  });
});

describe('watchPresentation — the listener lifecycle', () => {
  it('adds exactly one listener per video, however many times it is asked', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    watchPresentation(video, controller);
    watchPresentation(video, controller);
    togglePiP(video, controller); // also a discovery
    togglePiP(video, controller);

    expect(controller.listenerCount(video)).toBe(1);
  });

  it('keeps the record a second watch would otherwise reset', () => {
    // Idempotence has to mean more than "no second listener": re-seeding `seen` from
    // a later mode would silently lose the restore target.
    const controller = new FakePresentationController();
    const video = makeVideo();

    watchPresentation(video, controller);
    controller.externalModeChange(video, 'fullscreen');
    controller.externalModeChange(video, PresentationMode.PIP);

    watchPresentation(video, controller);

    expect(lastPresentationModeOf(video)).toBe('fullscreen');
  });

  it('watches only the video it was given', () => {
    const controller = new FakePresentationController();
    const watchedVideo = makeVideo();
    const other = makeVideo();

    togglePiP(watchedVideo, controller);

    expect(controller.listenerCount(watchedVideo)).toBe(1);
    expect(controller.listenerCount(other)).toBe(0);
  });

  it('removes its listener on stop', () => {
    const controller = new FakePresentationController();
    const video = makeVideo();

    const watch = watchPresentation(video, controller);
    expect(controller.listenerCount(video)).toBe(1);

    watch.stop();

    expect(controller.listenerCount(video)).toBe(0);
  });

  it('stops following the browser once stopped, and forgets what it knew', () => {
    // The half a listener count cannot see: after `stop()` the reports must stop
    // *mattering*. A `stop()` that unsubscribed but kept the record would leave a stale
    // restore target behind.
    const controller = new FakePresentationController();
    const video = makeVideo();

    const watch = watchPresentation(video, controller);
    controller.externalModeChange(video, 'fullscreen');
    controller.externalModeChange(video, PresentationMode.PIP);
    expect(lastPresentationModeOf(video)).toBe('fullscreen');

    watch.stop();

    expect(lastPresentationModeOf(video)).toBeUndefined();

    controller.externalModeChange(video, PresentationMode.INLINE);
    controller.externalModeChange(video, PresentationMode.PIP);

    expect(lastPresentationModeOf(video)).toBeUndefined();

    // And the next toggle starts over: it finds a video in PiP with no known
    // origin, which means inline.
    togglePiP(video, controller);

    expect(controller.modeOf(video)).toBe('inline');
  });

  it('is idempotent, and a stale handle cannot disturb a later watch', () => {
    // A stale handle must not tear down a watch it never installed. Measured: a `stop()`
    // keyed on *presence* rather than on the record's identity leaves the listener
    // attached (so a count alone still reads 1) while deleting the record out from under
    // it — the watch goes silently dead, and that mutation survived the count-only
    // version of this test.
    const controller = new FakePresentationController();
    const video = makeVideo();

    const stale = watchPresentation(video, controller);
    stale.stop();
    stale.stop();

    watchPresentation(video, controller);
    stale.stop();

    expect(controller.listenerCount(video)).toBe(1);

    controller.externalModeChange(video, 'fullscreen');
    controller.externalModeChange(video, PresentationMode.PIP);

    expect(lastPresentationModeOf(video)).toBe('fullscreen');
  });

  it('unsubscribes through the controller’s own handle, not by guessing', () => {
    // The returned function is what gets called: a controller whose handle is ignored
    // leaves its subscriber attached.
    const controller = new FakePresentationController();
    const video = makeVideo();
    let unsubscribed = 0;

    const spy: typeof controller.onModeChange = (target, cb) => {
      const off = FakePresentationController.prototype.onModeChange.call(controller, target, cb);
      return () => {
        unsubscribed += 1;
        off();
      };
    };
    controller.onModeChange = spy;

    watchPresentation(video, controller).stop();

    expect(unsubscribed).toBe(1);
    expect(controller.listenerCount(video)).toBe(0);
  });
});

/**
 * The record must be unreachable from page script, and half of that is textual: no part
 * of `src/` may write it back onto an element.
 *
 * Three defences against the DECISIONS 232 class of mistake, where a text gate matches
 * something other than what it meant: comments come out first (this module's own prose
 * necessarily discusses `data-last-presentation-mode`); the matcher is exercised on
 * known-bad samples in the same test; and the haystack is asserted non-empty.
 */
describe('the restore record is not written to the DOM (BF02)', () => {
  const SRC = join(import.meta.dirname, '../src');

  /** Every `.ts` under `src/`, recursively, as `[path, source]`. */
  function sources(dir: string = SRC): Array<[string, string]> {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.ts')
        ? [[path, readFileSync(path, 'utf8')] as [string, string]]
        : [];
    });
  }

  /**
   * The attribute spelling, which is the one `setAttribute` and CSS can reach.
   *
   * Deliberately **not** `/lastPresentationMode/`: that matched
   * {@link lastPresentationModeOf}, this module's own accessor, so the first version of
   * this gate failed on the fix rather than on the defect.
   */
  const ATTRIBUTE = /last-presentation-mode/;

  /**
   * Every `.dataset` use in the tree, with the key it names — or `undefined` for the
   * `dataset['…']` index form, which is forbidden outright because it is precisely
   * how one escapes the type-level guarantee asserted at the end of this block.
   */
  function datasetUses(source: string): Array<string | undefined> {
    return [...source.matchAll(/\.dataset\s*(?:\.\s*(\w+)|\[)/g)].map((match) => match[1]);
  }

  /** The only `data-*` key PiPOSS may keep on an element (RRR §4.5's button flag). */
  const ALLOWED_DATASET_KEY = 'pipossCustomButtonEnabled';

  it('can see the writes it forbids, and cannot see prose about them', () => {
    // The non-vacuity proof, run every time rather than once by hand.
    expect(stripComments("video.setAttribute('data-last-presentation-mode', mode);")).toMatch(
      ATTRIBUTE,
    );
    expect(datasetUses('video.dataset.lastPresentationMode = mode;')).toEqual([
      'lastPresentationMode',
    ]);
    expect(datasetUses("video.dataset['lastPresentationMode'] = mode;")).toEqual([undefined]);
    expect(datasetUses('el.dataset.pipossCustomButtonEnabled = "true";')).toEqual([
      ALLOWED_DATASET_KEY,
    ]);

    // And neither fires on the explanation of why the write is forbidden.
    const prose = '// never write dataset.lastPresentationMode or data-last-presentation-mode\n';
    expect(stripComments(prose)).not.toMatch(ATTRIBUTE);
    expect(datasetUses(stripComments(prose))).toEqual([]);
  });

  it('found a source tree to read', () => {
    const paths = sources().map(([path]) => path);

    expect(paths.length).toBeGreaterThan(5);
    expect(paths.some((path) => path.endsWith('core/presentation.ts'))).toBe(true);
    // Deliberately *not* asserted: that the tree contains at least one `dataset` use. It
    // contains none today, and requiring one would make the gate demand the very thing it
    // restricts. Non-vacuity is grounded in the sample-based test above instead.
  });

  it('names the record attribute in no source file, comments aside', () => {
    for (const [path, source] of sources()) {
      expect(stripComments(source), `${path} still names the old DOM-stored record`).not.toMatch(
        ATTRIBUTE,
      );
    }
  });

  it('uses no data-* key on a video but the YouTube button flag', () => {
    // A rename would defeat a gate that only knew the old attribute name, so what is
    // asserted is the whole `dataset` surface rather than one key.
    for (const [path, source] of sources()) {
      for (const key of datasetUses(stripComments(source))) {
        expect(
          key,
          `${path} indexes dataset dynamically, escaping the declared keys`,
        ).toBeDefined();
        expect(key, `${path} keeps an undeclared data-* key on an element`).toBe(
          ALLOWED_DATASET_KEY,
        );
      }
    }
  });

  it('declares exactly that one dataset key, which is what makes tsc the enforcement', () => {
    // `src/webkit.d.ts` types `HTMLVideoElement.dataset` as a closed object, so
    // `video.dataset.anythingElse = …` is a compile error and `pnpm run lint:ts` is
    // the real gate for the property form. This asserts that the declaration stays
    // closed — widen it to `Record<string, string>` and the compiler stops helping.
    const declaration = stripComments(readFileSync(join(SRC, 'webkit.d.ts'), 'utf8'));
    const dataset = /dataset:\s*\{([^}]*)\}/.exec(declaration);

    expect(dataset, 'src/webkit.d.ts no longer declares dataset as a closed object').not.toBeNull();
    expect([...(dataset?.[1] ?? '').matchAll(/(\w+)\??\s*:/g)].map((match) => match[1])).toEqual([
      ALLOWED_DATASET_KEY,
    ]);
  });

  it('leaves a toggled video with no attributes at all', () => {
    // The runtime half, and the one that catches a write under a different name: a
    // toggled `<video>` must be textually identical to one we never touched.
    const controller = new FakePresentationController();
    const video = makeVideo();

    controller.setInitialMode(video, 'fullscreen');
    togglePiP(video, controller);
    togglePiP(video, controller);
    togglePiP(video, controller);

    expect(video.getAttributeNames()).toEqual([]);
    expect(video.outerHTML).toBe('<video></video>');
  });
});

/**
 * BF19 — the long way back into fullscreen.
 *
 * A site fullscreens its own player container through the standard Fullscreen API, so
 * `webkitPresentationMode` stays `'inline'` and no `webkitpresentationmodechanged` is
 * delivered — which is the fullscreen people actually use, and the one BF02's
 * video-mode-following record is blind to. Measured in Safari 26 on YouTube:
 *
 *     start            | presentationMode = inline              | document fullscreen = false
 *     fullscreenchange | presentationMode = inline              | document fullscreen = true
 *     modechanged      | presentationMode = picture-in-picture  | document fullscreen = false
 *     modechanged      | presentationMode = inline              | document fullscreen = false
 *
 * Two facts from those four lines drive the whole design. `presentationMode` never becomes
 * `'fullscreen'`; and the document leaves fullscreen **with no event of its own** when PiP
 * takes over — there is no `fullscreenchange | false` line between the second and third.
 */
describe('togglePiP and the document’s fullscreen (BF19)', () => {
  /** The measured sequence's starting point; every test here is a prefix of it. */
  function youtubeShapedPage(): {
    video: HTMLVideoElement;
    player: HTMLElement;
    controller: FakePresentationController;
  } {
    const player = document.createElement('div');
    const video = document.createElement('video');
    player.appendChild(video);
    document.body.appendChild(player);
    const controller = new FakePresentationController();
    controller.setInitialMode(video, PresentationMode.INLINE);
    return { video, player, controller };
  }

  /**
   * Our own toggle, **plus Safari's report of it** — the fourth line of the log above.
   *
   * The fake stays deliberately silent on `setMode` so the eventless path stays exercised
   * elsewhere, which makes it the test's job to speak for Safari here. It matters: without
   * the report the record's `seen` stays at `picture-in-picture` after a toggle out, and
   * the next PiP report reads as "no transition" and moves nothing.
   */
  function toggleAndLetSafariReport(
    video: HTMLVideoElement,
    controller: FakePresentationController,
  ): void {
    togglePiP(video, controller);
    controller.externalModeChange(video, controller.getMode(video));
  }

  it('restores the page fullscreen the user came from, not inline', () => {
    const { video, player, controller } = youtubeShapedPage();

    // In and out of PiP with our own toggle — the short path, which always worked.
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);

    // The user goes fullscreen by hand: the site fullscreens its container, so the video's
    // mode does not change and only the document event fires.
    controller.externalFullscreenChange(player);
    expect(controller.getMode(video)).toBe(PresentationMode.INLINE);

    // Safari's own PiP control, in the measured order — the document is already out of
    // fullscreen by the time the mode change is reported, and nothing announced that.
    controller.externalModeChange(video, PresentationMode.PIP);

    // Our toggle. It must put the container back.
    togglePiP(video, controller);

    expect(controller.getMode(video)).toBe(PresentationMode.INLINE);
    expect(controller.fullscreenRequests).toEqual([player]);
  });

  it('asks for fullscreen after leaving PiP, never before', () => {
    const { video, player, controller } = youtubeShapedPage();
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);
    controller.externalFullscreenChange(player);
    controller.externalModeChange(video, PresentationMode.PIP);

    const before = controller.calls.length;
    togglePiP(video, controller);

    // The fullscreen request is not on this protocol's `calls` list, so the ordering is
    // asserted through the mode: by the time anything was requested, the video had already
    // been taken out of PiP.
    expect(controller.calls.length).toBeGreaterThan(before);
    expect(controller.getMode(video)).toBe(PresentationMode.INLINE);
    expect(controller.fullscreenRequests).toHaveLength(1);
  });

  it('does not drag the user into a fullscreen they had already left', () => {
    const { video, player, controller } = youtubeShapedPage();

    // A toggle first, so the record exists and the events below actually reach it. Found by
    // mutating: without it the mutation "never clear on a real fullscreenchange" survived —
    // with no record `noteFullscreen` returns early, so the clearing branch is never
    // entered and the test passes against a build that never clears at all.
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);

    // Fullscreen, then out of it deliberately — Escape, which *does* fire the event, which
    // is what makes clearing safe (entering PiP does not, see the block comment).
    controller.externalFullscreenChange(player);
    controller.externalFullscreenChange(null);

    // A completely unrelated PiP session afterwards. Nothing may drag the user back.
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);

    expect(controller.fullscreenRequests).toEqual([]);
  });

  it('consumes the record, so a second toggle out does not re-enter fullscreen', () => {
    const { video, player, controller } = youtubeShapedPage();
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);
    controller.externalFullscreenChange(player);
    controller.externalModeChange(video, PresentationMode.PIP);
    toggleAndLetSafariReport(video, controller);
    expect(controller.fullscreenRequests).toEqual([player]);

    // In and out again, this time from plain inline.
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);
    expect(controller.fullscreenRequests).toEqual([player]);
  });

  it('ignores a fullscreen element that does not contain this video', () => {
    const { video, controller } = youtubeShapedPage();
    const somethingElse = document.createElement('div');
    document.body.appendChild(somethingElse);

    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);
    controller.externalFullscreenChange(somethingElse);
    controller.externalModeChange(video, PresentationMode.PIP);
    togglePiP(video, controller);

    expect(controller.fullscreenRequests).toEqual([]);
  });

  it('does not ask a detached element to go fullscreen', () => {
    const { video, player, controller } = youtubeShapedPage();
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);
    controller.externalFullscreenChange(player);
    controller.externalModeChange(video, PresentationMode.PIP);

    // The site replaces its player between entering PiP and leaving it.
    player.remove();
    togglePiP(video, controller);

    expect(controller.fullscreenRequests).toEqual([]);
  });

  it('seeds from a fullscreen that began before the first toggle', () => {
    const { video, player, controller } = youtubeShapedPage();

    // The record is created while the document is already fullscreen, so no event will
    // ever announce it.
    controller.externalFullscreenChange(player);
    toggleAndLetSafariReport(video, controller);
    toggleAndLetSafariReport(video, controller);

    expect(controller.fullscreenRequests).toEqual([player]);
  });

  it('unsubscribes the fullscreen listener when the watch stops', () => {
    const { video, controller } = youtubeShapedPage();
    const watch = watchPresentation(video, controller);
    expect(controller.fullscreenListenerCount()).toBe(1);
    watch.stop();
    expect(controller.fullscreenListenerCount()).toBe(0);
  });
});
