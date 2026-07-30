/**
 * Watching a document without paying for every mutation it makes — RRR §5.3, the one quality
 * requirement in the whole document that is a *number*: at most **one run per animation frame
 * regardless of mutation volume**, and over 10 s of playback on a watch page **≤ 60 runs**.
 *
 * Nothing here knows what it watches or what it runs; the composition root wires it to
 * `sites/youtube.ts`'s `refresh`. A second site module would reuse it unchanged, which is why it
 * is in `core/` and why no selector appears below.
 *
 * **Coalescing is a correctness requirement, not a nicety.** The consumer writes to the DOM, and
 * `insertBefore` is itself a `childList` mutation, so a run feeds the observer that woke it.
 * `sites/youtube.ts` is convergent, so the feedback stops after one extra pass; but the day some
 * consumer is not, the shape of the loop decides whether a test *fails* or the process **hangs**.
 * Measured: DECISIONS 32 records vitest hanging for ever, with no timeout able to fire, because the
 * unthrottled observer re-entered through the microtask queue and starved the timer queue. Every hop
 * here is a **task** — a frame or a timer — so a runaway consumer yields the event loop on every
 * pass, stays bounded to one run per frame, and a timeout can actually fire.
 *
 * **There is a timer behind the animation frame** because `requestAnimationFrame` is the right clock
 * but not always *a* clock: it does not exist in every environment the content script is typed for;
 * it does not fire in a document that is not being painted, and `all_frames: true` puts us in frames
 * that never are; and Safari suspends it for a tab that is not visible. A frame-only scheduler in
 * those cases does not run late, it does not run *at all*, so each batch arms both and the first to
 * fire cancels the other.
 */

/**
 * How long a batch waits for an animation frame before a timer runs it anyway. A quarter of a second:
 * ~15 frames at 60 Hz, so it never pre-empts a frame that is coming, and 40 runs per 10 s at worst —
 * inside RRR §5.3's budget of 60 before the frame clock contributes anything. Exported so a test can
 * wait for exactly this.
 */
export const FALLBACK_DELAY_MS = 250;

/**
 * A scheduling handle, kept opaque: a number in a browser, an object under Node, and this module
 * only ever hands one back to the thing that issued it.
 */
type Handle = unknown;

/**
 * The clock a scheduler runs on — the subset of a window {@link coalesceByFrame} touches, so that
 * "there is no animation frame" is a case a test can construct rather than one we reason about
 * and hope. `requestAnimationFrame` is optional because that is the truth.
 */
export interface Frames {
  requestAnimationFrame?: (callback: () => void) => Handle;
  cancelAnimationFrame?: (handle: Handle) => void;
  setTimeout: (callback: () => void, delay: number) => Handle;
  clearTimeout: (handle: Handle) => void;
}

/** What {@link coalesceByFrame} and {@link observeSubtree} hand back. */
export interface CoalescedRuns {
  /**
   * Ask for a run. Any number of calls before the next frame produce exactly one; a call from
   * *inside* a run starts a new batch rather than joining the one that is ending, so a mutation
   * landing mid-run is never dropped.
   */
  schedule(): void;

  /**
   * Cancel anything pending, disconnect any observer, ignore every later {@link schedule}.
   * Idempotent, and safe to call from inside a run.
   */
  stop(): void;
}

/**
 * The ambient clock, read live. A double cast rather than a structural check: the real methods
 * take narrower handle types than {@link Frames} does, unobservable here because a handle only
 * ever goes back to its issuer. The *object* is the global itself, so `requestAnimationFrame` is
 * looked up at schedule time and an environment that installs it after load is read correctly.
 */
const AMBIENT = globalThis as unknown as Frames;

/** At most one `run` per animation frame, however many times `schedule` is called. */
export function coalesceByFrame(run: () => void, frames: Frames = AMBIENT): CoalescedRuns {
  let frame: Handle | undefined;
  let timer: Handle | undefined;
  let stopped = false;

  const cancelPending = (): void => {
    const pendingFrame = frame;
    const pendingTimer = timer;

    frame = undefined;
    timer = undefined;

    if (pendingFrame !== undefined) frames.cancelAnimationFrame?.(pendingFrame);
    if (pendingTimer !== undefined) frames.clearTimeout(pendingTimer);
  };

  const fire = (): void => {
    // The one guard against running a batch twice, load-bearing rather than defensive: both a
    // frame and a timer are armed per batch, so a clock that fires a callback it was told to
    // cancel — or fires both — arrives here at a batch already spent. It is also what makes a
    // delivery after `stop()` impossible, since `stop()` empties both.
    if (frame === undefined && timer === undefined) return;

    // Cancelled and forgotten *before* `run`, never after: a `schedule()` from inside `run` —
    // including the observer callback for `run`'s own DOM writes — must open the next batch, and
    // a `run` that throws must not leave a batch pending for ever.
    cancelPending();

    run();
  };

  return {
    schedule(): void {
      if (stopped) return;
      if (frame !== undefined || timer !== undefined) return;

      // Both, always: an optional call rather than a branch, because "there is no animation frame
      // here" and "the frame never comes" have to end the same way, and only the timer can end them.
      frame = frames.requestAnimationFrame?.(fire);
      timer = frames.setTimeout(fire, FALLBACK_DELAY_MS);
    },

    stop(): void {
      stopped = true;
      cancelPending();
    },
  };
}

/**
 * Watch `target`'s subtree and run `run` at most once per animation frame however much it mutates.
 *
 * `childList` and `subtree` only, which is what the consumer's trigger is: a player rebuilding its
 * controls replaces elements. Attributes are deliberately not watched — they change far more often
 * and would multiply the work this exists to bound.
 */
export function observeSubtree(
  target: Node,
  run: () => void,
  frames: Frames = AMBIENT,
): CoalescedRuns {
  const coalesced = coalesceByFrame(run, frames);

  const observer = new MutationObserver(() => {
    coalesced.schedule();
  });

  observer.observe(target, { subtree: true, childList: true });

  return {
    schedule(): void {
      coalesced.schedule();
    },
    stop(): void {
      observer.disconnect();
      coalesced.stop();
    },
  };
}
