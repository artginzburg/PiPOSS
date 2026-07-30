/**
 * RRR §4.6: when `autoPipOnTabHide` is on and the tab stops being visible while a video is playing,
 * that video goes into Picture in Picture on its own.
 *
 * The only surface that acts with **no user action at that moment**, and that asymmetry decides every
 * judgement below: an unwanted PiP window is loud, happens on every tab switch, and is the uninstall
 * case RRR §4.6 names, while one that fails to appear is a shrug with two manual triggers next to it.
 * Where a signal is ambiguous, do nothing.
 *
 * **The three exclusions are paused, muted, shorter than five seconds, and the length rule does not
 * subsume the muted one.** A `<video muted autoplay loop>` is how a *replaced GIF* ships — GitHub,
 * Reddit, Imgur and Twitter serve animations as silent looping video, routinely twenty seconds to a
 * minute, so the length rule catches almost none of them. And the muted rule is nearly the same set as
 * what WebKit allows: every media element on macOS starts with `RequireUserGestureForFullscreen`
 * (`HTMLMediaElement.cpp:713`), and the *only* thing that clears it is
 * `removeBehaviorRestrictionsAfterFirstUserGesture` (`:9037`), whose mask names that restriction
 * (`:9048`) and which runs from `play()`, `setVolume` and `setMutedInternal` under
 * `processingUserGestureForMedia()`. Never re-added, so one real click opens the gate for that
 * element's lifetime, `visibilitychange` included; the gate stays shut only for a video that
 * autoplayed muted and was never touched — exactly what this rule already declines to act on.
 * Measured in `docs/research/webkit-pip-user-gesture-2026-07.md`; pedantically the implication holds
 * by default, not universally (*Allow All Auto-Play*, or no audio track, breaks it permissively).
 *
 * **That note carries one warning this module must keep:** entry goes through
 * `webkitSetPresentationMode`, and the standard `requestPictureInPicture()` is *stricter* — raw
 * transient activation, no first-gesture escape hatch, `NotAllowedError`. "Modernising" that call
 * would delete this feature.
 *
 * The price is accepted: watching deliberately with the sound off gets nothing here. "Muted and never
 * interacted with" was considered and rejected (T10's report): the honest version misses the
 * commonest deliberate-muted case — muting from a custom player's own control, not from the video
 * element — while adding a false-positive path and page-wide listeners. A video with **no audio
 * track** is not `muted`, so this fires for it; `muted` is the only check reliable everywhere, while
 * `audioTracks` is patchily implemented and can report nothing for ordinary cross-origin media.
 *
 * `visibilitychange` does not say *why*, and no API distinguishes a tab switch from a minimised
 * window, a sleeping display or an app switch. All are honoured: in every case the user stopped
 * looking, and a PiP window floats above other windows. RRR §4.6's `visibilityState === 'hidden'`
 * rather than `document.hidden`, which is merely `visibilityState !== 'visible'` and so also true for
 * a prerendered document nobody saw.
 *
 * Videos are looked up when the tab hides, so there is nothing to watch and no `MutationObserver`
 * here. Coming back does **not** take the video out of PiP: the user may have kept it floating.
 */
import { type PresentationController, PresentationMode, togglePiP } from './presentation';
import { DEFAULTS, type Settings, followSettings } from './settings';
import { getVideos } from './video';

/**
 * Shorter than this and a video is decorative, whatever else it looks like (RRR §4.6).
 * Exported so a test can pin the boundary rather than restate the number.
 */
export const MIN_AUTO_PIP_DURATION_SECONDS = 5;

/**
 * Is this a video a user is plausibly watching right now? The three rules of RRR §4.6 and
 * nothing else. Pure DOM reads, so it says nothing about presentation mode — that is
 * {@link pickAutoPipVideo}'s part, because it needs the controller.
 */
export function isAutoPipEligible(video: HTMLVideoElement): boolean {
  if (video.paused) return false;
  if (video.muted) return false;

  return !isTooShort(video);
}

/**
 * Only a *finite* duration can be short. `Infinity` is a live stream and `NaN` is metadata
 * that has not arrived — neither is evidence of a decorative loop, and treating "unknown" as
 * "excluded" would drop real videos to catch nothing.
 */
function isTooShort(video: HTMLVideoElement): boolean {
  const { duration } = video;
  if (!Number.isFinite(duration)) return false;

  return duration < MIN_AUTO_PIP_DURATION_SECONDS;
}

/**
 * The video a tab hide should float, or `null`. Deliberately **not** `pickVideo` from
 * `core/video.ts`: that hands the hotkey a lone video whether it plays or not, because the user
 * pressed a key and meant *that* video. Nobody pressed anything here, and RRR §4.6 says "while a
 * video is playing", so a page with one paused video stays as it is. Otherwise the first eligible
 * video in document order, which is `pickVideo`'s own tie-break.
 *
 * The one rule that is not about eligibility: if **any** video on the page is already in PiP, nothing
 * happens. There is one PiP window, so acting would evict whatever the user put there — and if it is
 * *this* video, `togglePiP` would faithfully take it back out, the worst reading of a tab switch.
 */
export function pickAutoPipVideo(
  videos: ArrayLike<HTMLVideoElement>,
  controller: PresentationController,
): HTMLVideoElement | null {
  let candidate: HTMLVideoElement | null = null;

  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];

    if (controller.getMode(video) === PresentationMode.PIP) return null;
    if (candidate === null && isAutoPipEligible(video)) candidate = video;
  }

  return candidate;
}

export interface EnableAutoPipOptions {
  /** How PiP is reached. The composition root passes the WebKit one. */
  controller: PresentationController;

  /**
   * The document whose visibility to follow, and to look for videos in. Defaults to the
   * ambient one; a parameter because the content script runs in every frame
   * (`all_frames: true`), each with its own document.
   */
  target?: Document;
}

/** A live auto-PiP binding. Returned by {@link enableAutoPip}. */
export interface AutoPipBinding {
  /**
   * Whether the feature is on right now — `false` until the stored settings have arrived,
   * because `false` is both RRR §3's default and the safe direction.
   */
  readonly enabled: boolean;

  /** `followSettings`'s barrier: resolves once the stored settings have been applied. */
  readonly ready: Promise<void>;

  /** Detaches the visibility listener and the settings subscription. Idempotent. */
  disable(): void;
}

/**
 * Watches `target`'s visibility and floats the playing video when it goes hidden, for as long as the
 * setting says so. The listener is attached synchronously and starts **off** — the opposite of the
 * hotkey's choice (DECISIONS 85), read the other way: a hotkey dead for the first moments of a page
 * load fails at something the user is actively doing, whereas this feature acting before we know it
 * was wanted is the error that costs. The window is a few milliseconds of a freshly loaded page,
 * which is in any case visible.
 */
export function enableAutoPip({
  controller,
  target = document,
}: EnableAutoPipOptions): AutoPipBinding {
  let enabled = DEFAULTS.autoPipOnTabHide;

  const handleVisibilityChange = (): void => {
    if (!enabled) return;
    if (target.visibilityState !== 'hidden') return;

    const video = pickAutoPipVideo(getVideos(target), controller);
    if (!video) return;

    // Through `togglePiP`, never `controller.setMode` (DECISIONS 174). Setting the
    // mode here would be an entry `togglePiP` never saw, leaving its restore record
    // pointing at whatever mode the video was in the *last* time somebody toggled —
    // and the user's next hotkey press would put them into a mode they were never in.
    togglePiP(video, controller);
  };

  // `passive`: this never calls `preventDefault`, and saying so lets the browser
  // dispatch without waiting to find out.
  target.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });

  const { ready, unsubscribe } = followSettings((settings: Settings) => {
    enabled = settings.autoPipOnTabHide;
  });

  let attached = true;

  return {
    get enabled(): boolean {
      return enabled;
    },
    ready,
    disable(): void {
      if (!attached) return;
      attached = false;

      target.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribe();
    },
  };
}
