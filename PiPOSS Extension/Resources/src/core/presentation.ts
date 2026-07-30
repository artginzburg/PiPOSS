/**
 * The one place that knows about WebKit's presentation-mode API. `webkitSetPresentationMode`
 * exists only in WebKit, so nothing outside this module may touch it: everything else
 * depends on {@link PresentationController} and is therefore testable under jsdom (RRR §6).
 */

export const PresentationMode = {
  PIP: 'picture-in-picture',
  INLINE: 'inline',
} satisfies Record<string, VideoPresentationMode>;

export interface PresentationController {
  supportsPiP(video: HTMLVideoElement): boolean;
  getMode(video: HTMLVideoElement): VideoPresentationMode;
  setMode(video: HTMLVideoElement, mode: VideoPresentationMode): void;

  /**
   * Be told whenever the browser moves this video between presentations, *including* moves
   * nobody asked us to make: the player's own PiP button, the fullscreen control, the system PiP
   * window's close button. `cb` takes no arguments on purpose — the event carries no mode, so
   * {@link getMode} stays the only honest source. Returns its **own** unsubscribe rather than a
   * shared `off(video, cb)`, so the caller cannot get the pairing wrong.
   */
  onModeChange(video: HTMLVideoElement, cb: () => void): () => void;

  /* --------------------------------------------------------------------- *
   * The document's fullscreen state (BF19). A separate dimension from `getMode`, because
   * **on most sites "fullscreen" is not a presentation mode of the video at all.** Measured
   * in Safari 26 on YouTube, by the owner, with a console listener:
   *
   *     fullscreenchange | presentationMode = inline | document fullscreen = true
   *     modechanged      | presentationMode = picture-in-picture | document fullscreen = false
   *     modechanged      | presentationMode = inline | document fullscreen = false
   *
   * YouTube fullscreens its own *container* through the standard Fullscreen API, so
   * `video.webkitPresentationMode` stays `'inline'` and `webkitpresentationmodechanged` never
   * fires for it. BF02 modelled fullscreen as a video presentation mode — which
   * `webkitSetPresentationMode('fullscreen')` really is — and so could not see the kind of
   * fullscreen users actually use.
   *
   * Note line two: by the time PiP is reported the document has **already** left fullscreen,
   * and no `fullscreenchange` was delivered for that exit. So the element has to be captured
   * on the way in and kept until something says otherwise.
   * --------------------------------------------------------------------- */

  /** Document-scoped rather than per-video, because that is how the platform reports it. */
  onFullscreenChange(cb: () => void): () => void;

  /** The element currently presented fullscreen, or `null`. */
  fullscreenElement(): Element | null;

  /**
   * Put `element` back into fullscreen. Must be called while the user's gesture is still
   * being handled — the platform refuses otherwise, which is why the restore happens inside
   * {@link togglePiP} rather than from a later event.
   */
  enterFullscreen(element: Element): void;
}

/** The real implementation. Only ever selected by the composition root. */
export class WebKitPresentationController implements PresentationController {
  supportsPiP(video: HTMLVideoElement): boolean {
    return video.webkitSupportsPresentationMode(PresentationMode.PIP);
  }

  getMode(video: HTMLVideoElement): VideoPresentationMode {
    return video.webkitPresentationMode;
  }

  setMode(video: HTMLVideoElement, mode: VideoPresentationMode): void {
    video.webkitSetPresentationMode(mode);
  }

  onModeChange(video: HTMLVideoElement, cb: () => void): () => void {
    const listener = (): void => {
      cb();
    };

    video.addEventListener(MODE_CHANGE_EVENT, listener);

    return () => {
      video.removeEventListener(MODE_CHANGE_EVENT, listener);
    };
  }

  /**
   * Both spellings, both needed at this deployment floor: unprefixed `fullscreenchange` is
   * what Safari 26 delivers (the owner's log above is an unprefixed listener firing), while
   * macOS 11's Safari 14 has only `webkitfullscreenchange`. Registering both costs one
   * listener and degrades to "no restore" rather than to nothing on an old system.
   *
   * `cb` may therefore fire twice for one change. It is idempotent by construction — it
   * reads {@link fullscreenElement} rather than trusting the event.
   */
  onFullscreenChange(cb: () => void): () => void {
    const listener = (): void => {
      cb();
    };

    for (const name of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(name, listener);

    return () => {
      for (const name of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(name, listener);
    };
  }

  fullscreenElement(): Element | null {
    return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
  }

  enterFullscreen(element: Element): void {
    // The promise is dropped, and the rejection with it: a refused request is the documented
    // outcome when the gesture has expired, and the user is then already out of PiP looking
    // at the page — the pre-BF19 behaviour, not worth an alert.
    void element.requestFullscreen?.().catch(() => {});
    if (!element.requestFullscreen) element.webkitRequestFullscreen?.();
  }
}

/**
 * See {@link WebKitPresentationController.onFullscreenChange}. Not in
 * `HTMLVideoElementEventMap`, and `document.addEventListener` does not spell-check names
 * either (BF10), so these two literals are unguarded by the compiler. A test pins them.
 */
const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

/**
 * WebKit's report that a video moved between presentations. The only occurrence of this name
 * in *executable* code, and it may not leave this file (RRR §6): it is as WebKit-only as
 * `webkitSetPresentationMode`.
 *
 * `satisfies keyof HTMLVideoElementEventMap` is what checks the *spelling*, and the obvious
 * alternative does not. Declaring the name in that map (as `src/webkit.d.ts` does) buys a
 * typed `event` parameter but not a checked name: `addEventListener` keeps a
 * `(type: string, …)` overload, so `'webkitpresentationmodechange'` — no `d` — compiles and
 * simply never fires. Measured: with the declaration alone, that mutation passed `tsc` and
 * the whole suite. `satisfies` is erased before emit, so the guard is free.
 */
const MODE_CHANGE_EVENT = 'webkitpresentationmodechanged' satisfies keyof HTMLVideoElementEventMap;

export interface FakePresentationCall {
  method: 'supportsPiP' | 'getMode' | 'setMode';
  video: HTMLVideoElement;
  mode?: VideoPresentationMode;
}

/**
 * The test double. Records every call and remembers the mode it was told to set, so a test can drive
 * repeated toggles. Unlike WebKit it applies the mode synchronously — the only intentional difference.
 */
export class FakePresentationController implements PresentationController {
  /** What `supportsPiP` answers for every video. */
  supported: boolean;

  readonly calls: FakePresentationCall[] = [];

  private readonly modes = new Map<HTMLVideoElement, VideoPresentationMode>();

  private readonly listeners = new Map<HTMLVideoElement, Set<() => void>>();

  constructor(options: { supported?: boolean } = {}) {
    this.supported = options.supported ?? true;
  }

  /** Just the `setMode` calls, in order — the usual assertion target. */
  get setModeCalls(): Array<{ video: HTMLVideoElement; mode: VideoPresentationMode }> {
    const calls: Array<{ video: HTMLVideoElement; mode: VideoPresentationMode }> = [];
    for (const call of this.calls) {
      if (call.method === 'setMode' && call.mode !== undefined) {
        calls.push({ video: call.video, mode: call.mode });
      }
    }
    return calls;
  }

  /**
   * A starting mode, recorded as no call **and reported to nobody** — a transition nothing
   * observed, the one case the browser cannot help with. For one it *would* report, use
   * {@link externalModeChange}.
   */
  setInitialMode(video: HTMLVideoElement, mode: VideoPresentationMode): void {
    this.modes.set(video, mode);
  }

  /**
   * An external transition the browser **reports**: the player's own PiP button, the fullscreen
   * control, closing the PiP window. No call recorded, then the subscribers fire, as WebKit does.
   */
  externalModeChange(video: HTMLVideoElement, mode: VideoPresentationMode): void {
    this.modes.set(video, mode);
    for (const listener of this.listeners.get(video) ?? []) listener();
  }

  /** Every `enterFullscreen` call, in order — the restore assertion (BF19). */
  readonly fullscreenRequests: Element[] = [];

  private fullscreen: Element | null = null;

  private readonly fullscreenListeners = new Set<() => void>();

  onFullscreenChange(cb: () => void): () => void {
    this.fullscreenListeners.add(cb);
    return () => {
      this.fullscreenListeners.delete(cb);
    };
  }

  fullscreenElement(): Element | null {
    return this.fullscreen;
  }

  enterFullscreen(element: Element): void {
    this.fullscreenRequests.push(element);
    // Deliberately sets no state and fires no listener: the real one is asynchronous and may be
    // refused, so a fake that made the request succeed would let a test assert a state the
    // platform does not promise. Tests wanting the success path say `externalFullscreenChange`.
  }

  /**
   * The document entering or leaving fullscreen because something other than us asked — the
   * player's fullscreen button, or Escape. `null` means "no longer fullscreen".
   */
  externalFullscreenChange(element: Element | null): void {
    this.fullscreen = element;
    for (const listener of this.fullscreenListeners) listener();
  }

  /** How many fullscreen subscribers exist — the leak assertion. */
  fullscreenListenerCount(): number {
    return this.fullscreenListeners.size;
  }

  /** How many subscribers this video currently has — the leak assertion. */
  listenerCount(video: HTMLVideoElement): number {
    return this.listeners.get(video)?.size ?? 0;
  }

  /** Reads a video's mode without recording a call. */
  modeOf(video: HTMLVideoElement): VideoPresentationMode {
    return this.modes.get(video) ?? PresentationMode.INLINE;
  }

  supportsPiP(video: HTMLVideoElement): boolean {
    this.calls.push({ method: 'supportsPiP', video });
    return this.supported;
  }

  getMode(video: HTMLVideoElement): VideoPresentationMode {
    this.calls.push({ method: 'getMode', video });
    return this.modeOf(video);
  }

  setMode(video: HTMLVideoElement, mode: VideoPresentationMode): void {
    this.calls.push({ method: 'setMode', video, mode });
    this.modes.set(video, mode);
  }

  /**
   * Subscribing is **not** recorded in {@link calls}, a log of presentation *operations* asserted
   * by exact equality in several suites; {@link listenerCount} is what a test needs instead. Also
   * deliberately, `setMode` does not fire the subscribers: real WebKit would, asynchronously, but
   * a synchronous fake would make every one of our own toggles look observed and hide whether the
   * code can cope when the report never comes (an older WebKit, a refused transition).
   */
  onModeChange(video: HTMLVideoElement, cb: () => void): () => void {
    let subscribers = this.listeners.get(video);
    if (!subscribers) {
      subscribers = new Set();
      this.listeners.set(video, subscribers);
    }
    subscribers.add(cb);

    return () => {
      subscribers.delete(cb);
    };
  }
}

/* ------------------------------------------------------------------------- *
 * The restore record — "where should this video go when it leaves PiP?", one answer per video,
 * held here and nowhere else.
 *
 * **In module scope rather than on the element (BF02).** The answer used to live in
 * `video.dataset`, i.e. in an attribute. A content script runs in an isolated world
 * (`core/inject.ts`), but **attributes are not isolated** — they are the document, shared with
 * page script. So any page could read where the user was about to be sent, and worse write it:
 * whatever string it put there went straight to `webkitSetPresentationMode`. A {@link WeakMap}
 * in module scope is reachable only from this file's closure, and being weak it releases the
 * entry with the element.
 *
 * **The browser maintains it; we do not infer it.** BF01 recorded the mode at *toggle* time, so
 * a move made with the player's or the system's own controls was invisible and the next toggle
 * restored a stale answer. `webkitpresentationmodechanged` **is** that observation.
 * ------------------------------------------------------------------------- */

interface Watched {
  /**
   * The mode this video was in when it last **entered** PiP — the restore target; `undefined` until
   * it has entered once under observation. By construction never `'picture-in-picture'`: {@link note}
   * only assigns it while moving *to* PiP *from* something else.
   */
  restore?: VideoPresentationMode;

  /** The mode last observed, so a report can be read as a transition *from* it. */
  seen: VideoPresentationMode;

  /**
   * The element the *document* currently presents fullscreen, when it contains this video;
   * `undefined` when the document is not fullscreen (BF19). An element rather than a boolean because
   * restoring means asking that same element to go fullscreen again — YouTube's fullscreen is its
   * player container, and the bare `<video>` would lose the site's controls.
   */
  pageFullscreen?: Element;

  /**
   * {@link pageFullscreen} as it stood when this video last **entered** PiP — the fullscreen to
   * put back. Separate for the reason the owner's log shows: entering PiP leaves document
   * fullscreen *without* a `fullscreenchange`, so the live value is stale by then.
   */
  restoreFullscreen?: Element;

  /** Undoes {@link PresentationController.onModeChange}. */
  unsubscribe: () => void;

  /** Undoes {@link PresentationController.onFullscreenChange}. */
  unsubscribeFullscreen: () => void;
}

/**
 * Keyed by the element, so a record cannot outlive its video and cannot be enumerated. The value
 * holds an `unsubscribe` closing over the key — a value-references-key cycle, exactly what
 * `WeakMap`'s ephemeron semantics exist to collect, so it does not pin the entry. Unlike an
 * attribute, module state is not shared between two evaluations of the content script in one
 * frame; they cannot happen, because `claimFrame()` in `core/inject.ts` admits one copy per frame.
 */
const watched = new WeakMap<HTMLVideoElement, Watched>();

/**
 * Fold one observation of `mode` into `video`'s record. Called from the browser's report, which is
 * the authority and the point of BF02 — and from {@link togglePiP}, off the mode it reads before
 * acting, which reconciles anything that happened before we subscribed and keeps the record correct
 * on a WebKit that never sends the event at all (without it, `fullscreen → toggle in → toggle out`
 * would drop the user to inline the moment that dependency failed).
 *
 * Idempotent in the mode: a report of the mode we already believe is not a transition and must not
 * shift `restore`. That is what lets the two callers overlap harmlessly — in Safari every one of
 * our own toggles is *also* reported.
 */
function note(video: HTMLVideoElement, mode: VideoPresentationMode): void {
  const record = watched.get(video);
  if (!record) return; // Not watched: nothing asked for a record, so there is none.
  if (record.seen === mode) return;

  if (mode === PresentationMode.PIP) {
    record.restore = record.seen;
    // Snapshotted here, not read at restore time: the document has usually left fullscreen
    // by now, silently, and this is the last moment the element is known.
    record.restoreFullscreen = record.pageFullscreen;
  }
  record.seen = mode;
}

/**
 * Fold one observation of the document's fullscreen element into `video`'s record.
 *
 * **Clearing only on a real event is the load-bearing part.** The owner's measurement shows Safari
 * leaving document fullscreen *without* firing `fullscreenchange` when PiP takes over, so clearing
 * on "not fullscreen any more" checked at any other moment would throw the element away in exactly
 * the case BF19 exists for. Clearing when the event *does* arrive is necessary: Escape fires it, and
 * without the clear a later, unrelated toggle would drag the user back into fullscreen. The
 * containment check keeps one document-scoped event out of the record of an unrelated video.
 */
function noteFullscreen(video: HTMLVideoElement, element: Element | null): void {
  const record = watched.get(video);
  if (!record) return;

  record.pageFullscreen = element?.contains(video) ? element : undefined;
}

/** What {@link watchPresentation} hands back. */
export interface PresentationWatch {
  /** Remove the listener and forget the record. Idempotent; a later report is then ignored. */
  stop(): void;
}

/**
 * Start following the browser's presentation reports for one video. **Idempotent**: a second
 * call on a watched video adds no listener and keeps the record it has. `initialMode` lets
 * {@link togglePiP} seed the record from the mode it already read.
 *
 * Called from {@link togglePiP} only, on the video being toggled — the only moment `core/` is
 * handed a video at all. `core/observe.ts` already knows when videos appear, but the
 * composition root installs it **only on YouTube** and deliberately so (DECISIONS 134), so
 * watching from an observer would either buy nothing off YouTube or reintroduce exactly the
 * cost that decision refused. Nor is there a leak to reap: `addEventListener` does not root
 * its target and {@link watched} holds its key weakly, so production never needs
 * {@link PresentationWatch.stop} — it exists because a lifecycle with no exit is untestable.
 *
 * **Two residuals, stated rather than hidden**, both degrading to today's
 * wrong-but-recoverable inline and never to BF01's wedge:
 *
 * 1. A video is watched from its first toggle, so earlier transitions are unobserved —
 *    `fullscreen by hand → Safari's PiP control → first ever toggle` lands inline. Closing
 *    that needs the discovery-time watching DECISIONS 134 rejected.
 * 2. **Reports that coalesce lose the intermediate mode**, because the callback reads the mode
 *    at *delivery* time — the event carries none. If Safari dispatches asynchronously and two
 *    transitions land in one turn, `hand-fullscreen` then Safari's PiP control records
 *    `restore = inline`, not `fullscreen`. The fake cannot model it (synchronous, once per
 *    transition). Whether Safari coalesces at all is the one untested assumption this feature
 *    rests on, and it is on the owner's list (RRR §10.2).
 */
export function watchPresentation(
  video: HTMLVideoElement,
  controller: PresentationController,
  initialMode: VideoPresentationMode = controller.getMode(video),
): PresentationWatch {
  const existing = watched.get(video);

  const record: Watched = existing ?? {
    seen: initialMode,
    unsubscribe: controller.onModeChange(video, () => {
      note(video, controller.getMode(video));
    }),
    unsubscribeFullscreen: controller.onFullscreenChange(() => {
      noteFullscreen(video, controller.fullscreenElement());
    }),
  };

  if (!existing) {
    watched.set(video, record);
    // Seeded, because the video may already sit inside a fullscreen element by the time
    // anything toggles it — and the first toggle is the first moment `core/` sees this video.
    noteFullscreen(video, controller.fullscreenElement());
  }

  return {
    stop(): void {
      // Identity, not presence. A handle stops *its* watch or nothing: a stale one — stopped
      // already, or superseded by a later `watchPresentation` — must not tear down a live
      // listener it never installed. Presence alone made that mistake, and a test caught it.
      if (watched.get(video) !== record) return;
      watched.delete(video);
      record.unsubscribe();
      record.unsubscribeFullscreen();
    },
  };
}

/**
 * The mode a toggle out of PiP would restore this video to, or `undefined` if nothing has
 * been observed yet. Exported for tests: a module export is reachable from our own bundle and
 * from nothing else.
 */
export function lastPresentationModeOf(video: HTMLVideoElement): VideoPresentationMode | undefined {
  return watched.get(video)?.restore;
}

/**
 * Toggles Picture in Picture for one video, restoring whatever mode it was in before.
 *
 * The branch is taken from the controller's **live** mode, never from the record
 * (DECISIONS 170): that makes an unobserved external transition merely something to reconcile
 * rather than a state machine that can desynchronise. It is also why nothing here depends on
 * `webkitSetPresentationMode` having applied — it is asynchronous in Safari, so the mode is
 * read once, before the call, and never re-read.
 *
 * A recorded `'picture-in-picture'` is still refused rather than restored — belt over braces
 * since BF02, but a *deny* of PiP rather than an allowlist of the modes we happen to know,
 * because a future WebKit mode must be forwarded, not flattened to inline (DECISIONS 171).
 *
 * The record is **not** cleared on the way out: it still names the presentation this video came
 * from, the best answer available for an entry we did not perform, and every observed entry
 * overwrites it. Nor is the mode noted on the way *out*, though it is on the way in, and that
 * asymmetry is load-bearing: they differ only when a request is **refused**, and a refused exit
 * with the mode noted would read as "was in PiP, now inline", so the next toggle would see PiP
 * again and overwrite the restore target with `inline`, losing the fullscreen the user came from.
 */
export function togglePiP(video: HTMLVideoElement, controller: PresentationController): void {
  if (!controller.supportsPiP(video)) return; // Current browser does not support Picture in Picture

  const currentPresentationMode = controller.getMode(video);

  // Discovery: the first toggle on this video is the first moment `core/` sees it.
  // Idempotent, and seeded with the mode already in hand.
  watchPresentation(video, controller, currentPresentationMode);
  note(video, currentPresentationMode);

  if (currentPresentationMode === PresentationMode.PIP) {
    const previous = lastPresentationModeOf(video);
    controller.setMode(
      video,
      previous === undefined || previous === PresentationMode.PIP
        ? PresentationMode.INLINE
        : previous,
    );

    // BF19: if the user came from the *document's* fullscreen — what "fullscreen" means on YouTube
    // and most players — put that back too. Consumed rather than merely read, so a second toggle
    // out of a plain inline PiP cannot drag the user into a fullscreen they left long ago. After
    // `setMode`, because entering fullscreen while the video is still in PiP is a request about a
    // state about to change underneath it; in the same turn, because `requestFullscreen` needs the
    // gesture still being handled. `isConnected`, because the record holds the element strongly
    // while the page may have replaced its player, and a detached element cannot be presented.
    const record = watched.get(video);
    const fullscreen = record?.restoreFullscreen;
    if (record) {
      record.restoreFullscreen = undefined;
      // `pageFullscreen` goes too, and that is the point rather than tidying: the request below is
      // asynchronous and may be refused, so afterwards we do not know whether the document is
      // fullscreen. If it succeeds the platform's own `fullscreenchange` sets it again — the only
      // evidence worth holding.
      record.pageFullscreen = undefined;
    }
    if (fullscreen?.isConnected) controller.enterFullscreen(fullscreen);
    return;
  }

  controller.setMode(video, PresentationMode.PIP);
  // Recorded as an observation of our own request rather than read back: see {@link note}.
  // Safari's report of the same transition lands later and is then a no-op.
  note(video, PresentationMode.PIP);
}
