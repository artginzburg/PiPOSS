/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://www.youtube.com/watch?v=piposs" }
 */

/**
 * RRR §5.3, the one quality requirement stated as a number: **at most one run per animation
 * frame regardless of mutation volume**, and ≤ 60 runs over 10 s of playback. So this file
 * asserts counts, and the counts are exact.
 *
 * Four **measured** facts about this environment shape every test below, three of which
 * would otherwise make an obvious test vacuous:
 *
 * 1. **A `MutationObserver` already batches synchronous mutations**: 1000 `appendChild`
 *    calls in a row produce exactly **one** callback. So "1000 mutations, one run" is true
 *    of the *unthrottled* observer too, and driving a synchronous burst proves nothing about
 *    coalescing. The load-bearing drive is 1000 mutations across 1000 microtask checkpoints,
 *    which produces **1000** callbacks — and which the unthrottled composition root turned
 *    into 1000 runs of `refresh()`.
 * 2. **A microtask checkpoint is not an animation frame.** Frame callbacks are invoked from
 *    a task, so no amount of `await Promise.resolve()` lets one run. That is what makes
 *    `expect(runs).toBe(0)` immediately after a burst an assertion rather than a race: with
 *    coalescing the count is necessarily 0, without it it is however many batches arrived.
 * 3. **jsdom under vitest does have `requestAnimationFrame`**, firing every ~18 ms, so the
 *    frame path is the default here and the fallback has to be constructed deliberately —
 *    twice: a clock with no frames at all, and a clock whose frames never fire.
 * 4. **Re-entrancy must fail, not hang** (DECISIONS 32/128). Under a microtask-only loop the
 *    timer queue is starved so completely that no test timeout can fire: a previous
 *    experiment ate memory until the worker died with zero failed tests. Two tests cover it,
 *    both written to fail — the convergent consumer settles at an exact count, and the
 *    non-convergent one is bounded per frame *and* asserts that a timer scheduled before it
 *    started still ran. A starved event loop cannot pass that.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type CoalescedRuns,
  FALLBACK_DELAY_MS,
  type Frames,
  coalesceByFrame,
  observeSubtree,
} from '../src/core/observe';
import { frame } from './helpers/timing';

const OBSERVE_SOURCE = readFileSync(join(import.meta.dirname, '../src/core/observe.ts'), 'utf8');

/** The volume RRR §5.3 and PLAN T07 name. */
const MUTATIONS = 1000;

/** The selector every run of `sites/youtube.ts`'s `refresh()` opens with (DECISIONS 134). */
const PLAYER = '.html5-video-player';

/** A clock whose frames and timers fire when the test says so, and never otherwise. */
interface FakeClock extends Frames {
  /** Invokes every callback queued for the next frame, as one frame. */
  runFrame(): void;
  /** Invokes every pending timer, whatever its delay. */
  runTimers(): void;
  pendingFrames(): number;
  pendingTimers(): number;
  /** The delays of the pending timers, in the order they were requested. */
  delays(): number[];
}

/**
 * A controllable clock. Each queue is emptied *before* its callbacks are invoked, as a real
 * one is: a callback that asks for another frame gets the next frame, not this one. Without
 * that the "one run per frame" assertions could pass by accident.
 */
function fakeClock({
  animationFrames = true,
  cancellable = true,
}: { animationFrames?: boolean; cancellable?: boolean } = {}): FakeClock {
  let nextHandle = 1;
  const queuedFrames = new Map<number, () => void>();
  const queuedTimers = new Map<number, { callback: () => void; delay: number }>();

  const clock: FakeClock = {
    setTimeout(callback, delay) {
      const handle = nextHandle;
      nextHandle += 1;
      queuedTimers.set(handle, { callback, delay });
      return handle;
    },
    clearTimeout(handle) {
      if (cancellable) queuedTimers.delete(handle as number);
    },
    runFrame() {
      const due = Array.from(queuedFrames.values());
      queuedFrames.clear();
      for (const callback of due) callback();
    },
    runTimers() {
      const due = Array.from(queuedTimers.values());
      queuedTimers.clear();
      for (const { callback } of due) callback();
    },
    pendingFrames: () => queuedFrames.size,
    pendingTimers: () => queuedTimers.size,
    delays: () => Array.from(queuedTimers.values(), (timer) => timer.delay),
  };

  if (animationFrames) {
    clock.requestAnimationFrame = (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      queuedFrames.set(handle, callback);
      return handle;
    };
    clock.cancelAnimationFrame = (handle) => {
      if (cancellable) queuedFrames.delete(handle as number);
    };
  }

  return clock;
}

/**
 * Advances `count` real frames by chaining one request per frame, and answers how many
 * actually elapsed — so a "one run per frame" bound is compared against frames that
 * happened rather than against wall-clock guesswork.
 */
function acrossFrames(count: number): Promise<number> {
  return new Promise((resolve) => {
    let elapsed = 0;

    const tick = (): void => {
      elapsed += 1;
      if (elapsed < count) requestAnimationFrame(tick);
      else setTimeout(() => resolve(elapsed), 0);
    };

    requestAnimationFrame(tick);
  });
}

/** Appends `count` elements, yielding to the microtask queue between each. */
async function mutateAcrossMicrotasks(count: number): Promise<void> {
  for (let mutation = 0; mutation < count; mutation += 1) {
    document.body.appendChild(document.createElement('span'));
    await Promise.resolve();
  }
}

/** Appends `count` elements with no yield of any kind. */
function mutateSynchronously(count: number): void {
  for (let mutation = 0; mutation < count; mutation += 1) {
    document.body.appendChild(document.createElement('span'));
  }
}

let started: CoalescedRuns[] = [];
let witnesses: MutationObserver[] = [];

/** Registers a scheduler for teardown, so a failing test cannot leak it into the next. */
function watching(run: () => void, frames?: Frames): CoalescedRuns {
  const observed =
    frames === undefined ? observeSubtree(document, run) : observeSubtree(document, run, frames);
  started.push(observed);
  return observed;
}

/** An independent observer, to prove how many batches a drive really produced. */
function witnessBatches(): () => number {
  let batches = 0;
  const witness = new MutationObserver(() => {
    batches += 1;
  });

  witness.observe(document, { subtree: true, childList: true });
  witnesses.push(witness);

  return () => batches;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const observed of started) observed.stop();
  for (const witness of witnesses) witness.disconnect();
  started = [];
  witnesses = [];
  document.body.innerHTML = '';
});

describe('coalescing, by the number (RRR §5.3)', () => {
  it('drives the volume the requirement actually names', () => {
    // The premise of every count in this file: "one run *regardless of mutation volume*" is
    // equally true of one mutation, so quietly lowering this constant would leave every
    // assertion below green while testing nothing about volume.
    expect(MUTATIONS).toBe(1000);
  });

  it('runs once for 1000 requests in one batch', () => {
    const clock = fakeClock();
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    for (let request = 0; request < MUTATIONS; request += 1) coalesced.schedule();

    // One frame and one timer were armed, once — not a thousand of each.
    expect(clock.pendingFrames()).toBe(1);
    expect(clock.pendingTimers()).toBe(1);
    expect(runs).toBe(0);

    clock.runFrame();

    expect(runs).toBe(1);
  });

  it('does not run until the frame arrives', () => {
    const clock = fakeClock();
    let runs = 0;

    coalesceByFrame(() => {
      runs += 1;
    }, clock).schedule();

    expect(runs).toBe(0);
  });

  it('gives each later batch its own run', () => {
    const clock = fakeClock();
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    for (let batch = 1; batch <= 3; batch += 1) {
      coalesced.schedule();
      coalesced.schedule();
      clock.runFrame();
      expect(runs).toBe(batch);
    }
  });
});

describe('a request is never dropped', () => {
  it('opens exactly one new batch for a request made from inside the run', () => {
    const clock = fakeClock();
    let runs = 0;

    const coalesced: CoalescedRuns = coalesceByFrame(() => {
      runs += 1;
      // Twice, from inside the run that is ending: the request must survive it and must not
      // queue two frames.
      if (runs === 1) {
        coalesced.schedule();
        coalesced.schedule();
      }
    }, clock);

    coalesced.schedule();
    clock.runFrame();

    expect(runs).toBe(1);
    expect(clock.pendingFrames()).toBe(1);
    expect(clock.pendingTimers()).toBe(1);

    clock.runFrame();
    expect(runs).toBe(2);

    // And then it settles, because nothing asked again.
    clock.runFrame();
    expect(runs).toBe(2);
  });

  it('never runs one batch twice, even on a clock that ignores cancellation', () => {
    // Two callbacks are armed per batch and only one may run it. Cancelling the loser is how
    // that normally happens; this is the same claim without relying on the clock to honour a
    // cancellation at all.
    const clock = fakeClock({ cancellable: false });
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    coalesced.schedule();
    clock.runFrame();
    expect(runs).toBe(1);

    // The fallback timer of that same batch, arriving after the frame already ran it.
    clock.runTimers();
    expect(runs).toBe(1);

    // And the same after `stop()`: a callback the clock refused to drop must still
    // find nothing to do.
    coalesced.schedule();
    coalesced.stop();
    clock.runFrame();
    clock.runTimers();
    expect(runs).toBe(1);
  });

  it('keeps working after a run throws', () => {
    const clock = fakeClock();
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
      if (runs === 1) throw new Error('the consumer threw');
    }, clock);

    coalesced.schedule();
    expect(() => clock.runFrame()).toThrow('the consumer threw');

    // Nothing left armed: a batch that died must not block the next one for ever.
    expect(clock.pendingFrames()).toBe(0);
    expect(clock.pendingTimers()).toBe(0);

    coalesced.schedule();
    clock.runFrame();

    expect(runs).toBe(2);
  });
});

describe('a whole-document observer, coalesced (RRR §5.3)', () => {
  it('runs once for 1000 mutations delivered as 1000 separate batches', async () => {
    let runs = 0;
    const batches = witnessBatches();

    watching(() => {
      runs += 1;
    });

    await mutateAcrossMicrotasks(MUTATIONS);

    // The drive really was 1000 deliveries, not one batch the observer collapsed (fact 1).
    expect(batches()).toBe(MUTATIONS);
    expect(runs).toBe(0);

    await frame();

    expect(runs).toBe(1);
  });

  it('watches the whole document, not only the body', async () => {
    let runs = 0;

    watching(() => {
      runs += 1;
    });

    // Outside `body` entirely: a player rebuild is inside it, but nothing here should depend
    // on where in the page the consumer happens to look.
    document.documentElement.appendChild(document.createElement('template'));

    await frame();

    expect(runs).toBe(1);
  });

  /**
   * The load-bearing absence in the observer options: adding `attributes: true` passes every
   * other test in the project and demolishes the RRR §5.3 argument rather than bending it.
   * That argument is "runs are scheduled by mutations, so a frame in which nothing structural
   * happens costs nothing" — but on a live watch page attributes mutate *every* frame (the
   * progress bar's transform, `aria-valuenow`), which turns ~zero runs while idle into 600
   * per 10 s against a budget of 60 (DECISIONS 129).
   */
  it('ignores attribute changes, which would cost a run in every frame of playback', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    let runs = 0;

    watching(() => {
      runs += 1;
    });

    target.setAttribute('aria-valuenow', 'busy');
    target.setAttribute('style', 'transform: scaleX(0.5)');

    await frame();

    expect(runs).toBe(0);

    // And it really was watching all along — without this the assertion above would also
    // pass for an observer that had never been connected.
    target.appendChild(document.createElement('i'));
    await frame();

    expect(runs).toBe(1);
  });

  it('runs on request as well as on a mutation, without waiting for one', async () => {
    let runs = 0;

    // The handle a consumer needs when something *other* than the DOM changed — a setting,
    // say. Same coalescing: one run per frame, mutation or not.
    watching(() => {
      runs += 1;
    }).schedule();

    expect(runs).toBe(0);

    await frame();

    expect(runs).toBe(1);
  });

  it('runs once for 1000 synchronous mutations, and the run sees all of them', async () => {
    let runs = 0;
    let seen = 0;

    watching(() => {
      runs += 1;
      seen = document.body.childElementCount;
    });

    mutateSynchronously(MUTATIONS);

    // A microtask checkpoint, which is where the observer callback lands: the
    // unthrottled observer has already run the consumer by this point.
    await Promise.resolve();
    expect(runs).toBe(0);

    await frame();

    expect(runs).toBe(1);
    expect(seen).toBe(MUTATIONS);
  });

  it('runs once more for a mutation made by the run itself, then settles (DECISIONS 32)', async () => {
    let runs = 0;

    watching(() => {
      runs += 1;
      // Convergent: it writes on the first pass only, as `sites/youtube.ts` writes only when
      // the DOM differs from what it wants.
      if (runs === 1) document.body.appendChild(document.createElement('i'));
    });

    document.body.appendChild(document.createElement('i'));

    await frame();
    expect(runs).toBe(1);

    // The write from inside run 1 woke the observer, so there is a second run — the mutation
    // was not swallowed by the batch that produced it.
    await frame();
    expect(runs).toBe(2);

    // And it stops there: the DECISIONS 32 loop, converging.
    await acrossFrames(3);
    expect(runs).toBe(2);
  });

  it('bounds a consumer that never converges to one run per frame, without starving the event loop', async () => {
    const FRAMES = 5;
    const RUN_BUDGET = 200;

    let runs = 0;
    let timerRan = false;

    // Queued *before* the loop starts. Under the DECISIONS 32 microtask loop this never
    // fires, which is why that failure hung instead of failing.
    setTimeout(() => {
      timerRan = true;
    }, 0);

    watching(() => {
      runs += 1;
      if (runs > RUN_BUDGET) {
        throw new Error(
          `the consumer ran more than ${RUN_BUDGET} times — that is the DECISIONS 32 ` +
            're-entrant loop. It surfaces inside an animation-frame callback, outside this ' +
            "test's await chain, so the runner reports an unhandled error while the test " +
            'fails on the count assertion below. Measured with the budget lowered to 2: ' +
            'exit 1 in 1.27 s, this text printed — rather than a hang with no failed test.',
        );
      }
      // Never convergent: every run mutates, so every run wakes the observer again.
      document.body.appendChild(document.createElement('i'));
    });

    document.body.appendChild(document.createElement('i'));
    const elapsed = await acrossFrames(FRAMES);

    expect(timerRan).toBe(true);

    // It really did keep re-entering, once per frame — bounded above, and not
    // silently stalled below.
    expect(runs).toBeGreaterThanOrEqual(elapsed - 1);
    expect(runs).toBeLessThanOrEqual(elapsed + 2);
  });
});

describe('teardown', () => {
  it('cancels the pending run', () => {
    const clock = fakeClock();
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    coalesced.schedule();
    coalesced.stop();

    expect(clock.pendingFrames()).toBe(0);
    expect(clock.pendingTimers()).toBe(0);

    clock.runFrame();
    clock.runTimers();

    expect(runs).toBe(0);
  });

  it('ignores every later request', () => {
    const clock = fakeClock();
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    coalesced.stop();
    coalesced.stop();
    coalesced.schedule();

    expect(clock.pendingFrames()).toBe(0);
    clock.runFrame();
    expect(runs).toBe(0);
  });

  it('disconnects the observer, so the document may go on mutating', async () => {
    let runs = 0;

    const observed = watching(() => {
      runs += 1;
    });

    observed.stop();

    mutateSynchronously(MUTATIONS);
    await frame();

    expect(runs).toBe(0);
  });

  /**
   * White-box on purpose, and the only way this can be seen at all: with the scheduler
   * stopped, a still-connected observer changes no behaviour whatsoever — it only costs, on
   * every mutation of the whole document, for ever. That is the shape of defect RRR §5.3 is
   * about, and "no test noticed" is how DECISIONS 129's simplifications got in.
   */
  it('disconnects the observer, not only the scheduler', () => {
    const realDisconnect = MutationObserver.prototype.disconnect;
    const disconnected: MutationObserver[] = [];

    MutationObserver.prototype.disconnect = function spy(this: MutationObserver): void {
      disconnected.push(this);
      realDisconnect.call(this);
    };

    try {
      watching(() => {}).stop();

      expect(disconnected.length).toBe(1);
    } finally {
      MutationObserver.prototype.disconnect = realDisconnect;
    }
  });

  it('can be stopped from inside its own run', async () => {
    let runs = 0;

    const observed = watching(() => {
      runs += 1;
      observed.stop();
      document.body.appendChild(document.createElement('i'));
    });

    document.body.appendChild(document.createElement('i'));

    await acrossFrames(3);

    expect(runs).toBe(1);
  });
});

describe('when the animation frame is missing or never comes', () => {
  it('runs on the fallback timer where there is no requestAnimationFrame', () => {
    const clock = fakeClock({ animationFrames: false });
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    coalesced.schedule();

    expect(clock.delays()).toEqual([FALLBACK_DELAY_MS]);

    clock.runTimers();

    expect(runs).toBe(1);
  });

  it('still coalesces 1000 requests into one run with no frames at all', () => {
    const clock = fakeClock({ animationFrames: false });
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    for (let request = 0; request < MUTATIONS; request += 1) coalesced.schedule();

    expect(clock.pendingTimers()).toBe(1);

    clock.runTimers();

    expect(runs).toBe(1);
  });

  it('runs on the fallback timer where frames are requested but never fire', () => {
    const clock = fakeClock();
    let runs = 0;

    const coalesced = coalesceByFrame(() => {
      runs += 1;
    }, clock);

    coalesced.schedule();
    expect(clock.pendingFrames()).toBe(1);

    // The suspended-document case: the frame was accepted and simply never comes.
    clock.runTimers();

    expect(runs).toBe(1);

    // And the frame it gave up on was cancelled, so it cannot arrive later and run the
    // consumer a second time for the same batch.
    expect(clock.pendingFrames()).toBe(0);
  });

  it('lets the frame win when both are armed, and drops the timer', () => {
    const clock = fakeClock();
    let runs = 0;

    coalesceByFrame(() => {
      runs += 1;
    }, clock).schedule();

    clock.runFrame();

    expect(runs).toBe(1);
    expect(clock.pendingTimers()).toBe(0);

    clock.runTimers();
    expect(runs).toBe(1);
  });

  it('waits several frames before the timer takes over', () => {
    // Both bounds are named independently of FALLBACK_DELAY_MS: an assertion comparing the
    // constant against itself cannot fail when the value changes, and the value is where
    // two claims live.
    const FRAME_MS = 1000 / 60;

    // Long enough that a document being painted always runs on its frame, so the timer is
    // overhead and never the clock.
    expect(FALLBACK_DELAY_MS).toBeGreaterThan(FRAME_MS * 4);

    // And short enough to be a fallback, while still inside RRR §5.3's 60 runs per 10 s on
    // its own — before the frame clock contributes anything.
    expect((10_000 / FALLBACK_DELAY_MS) * 1).toBeLessThanOrEqual(60);
  });

  it('reads the ambient clock at request time rather than snapshotting it at import', async () => {
    const real = globalThis.requestAnimationFrame;
    let runs = 0;

    // Deleted *after* the module was loaded.
    delete (globalThis as Partial<typeof globalThis>).requestAnimationFrame;

    try {
      expect(globalThis.requestAnimationFrame).toBeUndefined();

      watching(() => {
        runs += 1;
      });

      mutateSynchronously(2);

      // The assertion that carries the test's name. A clock snapshotted at import would
      // still hold a working `requestAnimationFrame` — the deletion cannot reach a captured
      // reference — and would have run within ~18 ms. Only a scheduler that looks the
      // property up at request time finds it gone and has nothing but the timer left.
      await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS / 2));
      expect(runs).toBe(0);

      // And then the fallback converges, which is the other half of the claim.
      await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS));
      expect(runs).toBe(1);
    } finally {
      globalThis.requestAnimationFrame = real;
    }
  });
});

describe('a general utility, not a YouTube one', () => {
  it('depends on no site module', () => {
    expect(OBSERVE_SOURCE).toMatch(/export function observeSubtree/);
    // Either quote, because prettier's choice of one is not what this is defending.
    expect(OBSERVE_SOURCE).not.toMatch(/from ['"]\.\.\/sites\//);
  });
});

/**
 * Counts the runs of the consumer the composition root drives, via the one call every run of
 * `refresh()` makes: `doc.querySelectorAll('.html5-video-player')`.
 *
 * Instrumenting the consumer rather than the scheduler is the point: it measures RRR §5.3
 * where the cost is actually spent (DECISIONS 134), and it measures the wiring in
 * `content.ts` rather than a re-creation of it.
 */
function countRefreshRuns(): { runs: () => number; restore: () => void } {
  const real = document.querySelectorAll.bind(document);
  let runs = 0;

  document.querySelectorAll = function counted(selector: string): NodeListOf<Element> {
    if (selector === PLAYER) runs += 1;
    return real(selector);
  } as Document['querySelectorAll'];

  return {
    runs: () => runs,
    restore: () => {
      delete (document as Partial<Document>).querySelectorAll;
    },
  };
}

/**
 * The composition root's own observer, end to end. Last in the file and imported once
 * (DECISIONS 90): the import attaches a `keyup` listener and a whole-document observer that
 * are never detached, and jsdom shares one document per file.
 */
describe('the composition root runs the mount at most once per frame (RRR §5.3)', () => {
  let counter: { runs: () => number; restore: () => void } | null = null;

  afterEach(() => {
    counter?.restore();
    counter = null;
  });

  it('coalesces a burst of separately-delivered mutations into exactly one run', async () => {
    await import('../src/content');
    await frame();

    counter = countRefreshRuns();
    await mutateAcrossMicrotasks(MUTATIONS);

    expect(counter.runs()).toBe(0);

    await frame();

    expect(counter.runs()).toBe(1);
  });

  it('coalesces a synchronous burst into exactly one run', async () => {
    await import('../src/content');
    await frame();

    counter = countRefreshRuns();
    mutateSynchronously(MUTATIONS);

    await Promise.resolve();
    expect(counter.runs()).toBe(0);

    await frame();

    expect(counter.runs()).toBe(1);
  });

  it('watches the document, so a rebuild outside the body is still noticed', async () => {
    await import('../src/content');
    await frame();

    counter = countRefreshRuns();

    // Narrowing the target to `document.body` passes every other test here, and would stop
    // working the day the page replaces the body itself — the observer would go on watching
    // a detached node and the button would never be treated again.
    document.documentElement.appendChild(document.createElement('template'));
    await frame();

    expect(counter.runs()).toBe(1);
  });
});
