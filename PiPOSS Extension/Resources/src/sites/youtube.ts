/**
 * The only site-specific module (RRR §4.5): YouTube ships a Picture-in-Picture button, hides
 * it, and this un-hides it.
 *
 * Every decision here was measured off a live watch page and written down in
 * `docs/research/youtube-player-2026-07.md` — **read that before changing anything here.**
 * The short version, because it is the bug this module exists to fix: the previous
 * implementation compensated for the PiP glyph being bigger than its neighbours, that
 * difference no longer exists, and the compensation duly collapsed the glyph to a sliver
 * inside a full-size button. The button was not broken by YouTube. It was broken by our
 * arithmetic about YouTube.
 *
 * Five rules, all pinned in `test/youtube.test.ts` — the first four by behaviour, the fifth
 * necessarily by an assertion on this source text, because the element it forbids touching does
 * not exist to assert against:
 *
 * 1. **No geometry is written.** Not one length, and the glyph is never even queried: YouTube sizes
 *    every control button's glyph identically, with values that differ per width mode, so any number
 *    written here is already wrong in one mode and will be wrong in all of them after the next
 *    redesign. RRR §5.4 makes it a static gate — no numeric literal at all.
 * 2. **Un-hiding removes a property; it never assigns one.** YouTube suppresses the button with an
 *    inline declaration, and removing it hands the element back to whatever layout the player's own
 *    stylesheet intends. Assigning would pin one layout, and the player has several.
 * 3. **Position comes from the `data-priority` attribute** the player puts on its own buttons, ours
 *    included — so even our own rank is read rather than written.
 * 4. **The icon and the tooltip are YouTube's**, and already correct.
 * 5. **The miniplayer button is not touched.** The delhi player has none; the code that removed it
 *    was addressing a player that no longer exists.
 *
 * Both of {@link mountYouTubeButton}'s arguments are handed in rather than reached for: the
 * controller because WebKit is untestable and RRR §6 says so, the document because the hostname
 * check must read *that document's* location. Its binding's `refresh` is the whole re-entry surface —
 * the player rebuilds its controls on layout changes, so the composition root's coalesced observer
 * calls it again — and is therefore safe at any rate: every step is convergent, for the reason
 * {@link place} records.
 */
import { effectiveHotkey } from '../core/hotkey';
import { type PresentationController, togglePiP } from '../core/presentation';
import { type Settings, followSettings } from '../core/settings';
import { getVideos, pickVideo } from '../core/video';

/** Hosts whose pages carry the player. Subdomains included; look-alikes not. */
const YOUTUBE_DOMAINS = ['youtube.com', 'youtube-nocookie.com'];

const PLAYER = '.html5-video-player';
const PIP_BUTTON = '.ytp-pip-button';

/** The group PiP's rank places it in — the right-hand half of the right controls. */
const RIGHT_CONTROLS_GROUP = '.ytp-right-controls-right';

/** The player's own statement of button order. Rule 3. */
const PRIORITY_ATTRIBUTE = 'data-priority';

/**
 * Where the hotkey is announced to assistive technology.
 *
 * The attribute, not the `ariaKeyShortcuts` property the old code assigned: ARIA reflection is
 * materially newer than the attribute it mirrors, and where it is missing that assignment sets
 * a plain JavaScript property and no accessibility state at all — silently. The exact Safari
 * version was **not measured**; the attribute needs no such claim, which is the argument for it.
 */
const HOTKEY_HINT_ATTRIBUTE = 'aria-keyshortcuts';

/**
 * How a button was hidden before we first un-hid it, per button — so it can be put back without
 * this module knowing a single CSS value. A weak map rather than a `data-` attribute, which
 * would be visible and forgeable by the page and would trip the page's own observers
 * (`core/inject.ts`'s frame flag, same reasoning).
 */
const hiddenBefore = new WeakMap<Element, string>();

/**
 * Which controller a mounted button toggles — and, by its presence, the answer to "is this
 * button one we mounted?". A button we never mounted is never un-styled, so a disabled setting
 * cannot make us tamper with the player's own state.
 */
const controllers = new WeakMap<Element, PresentationController>();

/** A binding for a document the module has nothing to do with. */
const INERT: YouTubeButtonBinding = Object.freeze({
  active: false,
  ready: Promise.resolve(),
  refresh(): void {},
  disable(): void {},
});

/** A live mount. Returned by {@link mountYouTubeButton}. */
export interface YouTubeButtonBinding {
  /**
   * Is this document one the module acts on? `false` on every page that is not YouTube, where
   * the binding holds no subscription and does nothing at all.
   */
  readonly active: boolean;

  /** `followSettings`'s barrier: resolves once the stored settings have been applied. */
  readonly ready: Promise<void>;

  /**
   * Bring every player in the document to the wanted state. Idempotent, cheap when nothing has
   * changed, and safe to call at any rate — this is what the coalesced scheduler calls.
   */
  refresh(): void;

  /** Drops the settings subscription and stops touching the DOM. Idempotent. */
  disable(): void;
}

/**
 * Is this hostname YouTube? RRR §4.5: the hostname, never `video.src`. On a watch page the
 * source is a blob URL that happens to carry the origin in its own text, so the old substring
 * check passed by accident — and would have failed for the identical player served from the
 * no-cookie embed host, or driven by MediaSource with no source at all.
 *
 * Suffix matching anchored on a dot, so `youtube.com` and `music.youtube.com` match while
 * `notyoutube.com` and `youtube.com.evil.example` do not.
 */
export function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return YOUTUBE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Un-hide, place and wire YouTube's PiP button in `doc`, following the `youtubeButton` setting for as
 * long as the binding lives (RRR §3, §4.5).
 *
 * Nothing is done until that setting has been read — the opposite of the hotkey, which binds on the
 * default immediately (DECISIONS 85), because a keystroke can genuinely arrive before an asynchronous
 * storage read whereas the player's controls cannot: they are built by scripts that have barely
 * started at `document_idle`. Starting on the default would mean doing DOM surgery on the page of a
 * user who asked us not to, then undoing it visibly.
 */
export function mountYouTubeButton(
  doc: Document,
  controller: PresentationController,
): YouTubeButtonBinding {
  if (!isYouTubeHost(hostnameOf(doc))) return INERT;

  let settings: Settings | null = null;
  let enabled = true;

  const apply = (): void => {
    const current = settings;
    if (!enabled || !current) return;

    for (const player of Array.from(doc.querySelectorAll(PLAYER))) {
      const button = player.querySelector<HTMLElement>(PIP_BUTTON);
      if (!button) continue;

      if (current.youtubeButton) show(player, button, controller, current.hotkey);
      else hide(button);
    }
  };

  const { ready, unsubscribe } = followSettings((changed: Settings) => {
    settings = changed;
    apply();
  });

  return {
    active: true,
    ready,
    refresh: apply,
    disable(): void {
      if (!enabled) return;
      enabled = false;
      unsubscribe();
    },
  };
}

/**
 * The hostname of the document we were handed, or nothing. `location` is null on a document with
 * no browsing context, which the DOM typings do not admit but `createHTMLDocument` produces —
 * and nothing is the right answer there: a document that is nowhere is not YouTube.
 */
function hostnameOf(doc: Document): string {
  const where = doc.location as Location | null;

  return where === null ? '' : where.hostname;
}

/** Bring one button to the visible, placed, clickable state. Convergent. */
function show(
  player: Element,
  button: HTMLElement,
  controller: PresentationController,
  hotkey: string,
): void {
  if (!hiddenBefore.has(button)) {
    hiddenBefore.set(button, button.style.getPropertyValue('display'));
  }

  // Rule 2. `removeProperty`, never an assignment.
  button.style.removeProperty('display');

  const key = effectiveHotkey(hotkey);
  if (key === '') button.removeAttribute(HOTKEY_HINT_ATTRIBUTE);
  else button.setAttribute(HOTKEY_HINT_ATTRIBUTE, key);

  controllers.set(button, controller);

  // On the *player*, in the capture phase, and not on the button — {@link handleClick} carries
  // the measurement that forces this. One module-level listener, so a repeated mount is
  // deduplicated by the DOM itself (`addEventListener` ignores an identical callback for the
  // same target, type and phase) rather than by bookkeeping of ours that could drift.
  player.addEventListener('click', handleClick, true);

  place(player, button);
}

/**
 * Put a button we mounted back the way the player had it. Only ever a button of ours: one we never
 * showed keeps whatever state YouTube gave it, so switching the setting off cannot make us reveal
 * something the player deliberately hid. The capture listener is detached from the player the button
 * is in now; if the button has been moved out of its player we cannot find that player and the
 * listener stays attached — harmlessly, because dropping the button from {@link controllers} is what
 * disarms it, and that happens first.
 */
function hide(button: HTMLElement): void {
  if (!controllers.has(button)) return;

  controllers.delete(button);
  button.closest(PLAYER)?.removeEventListener('click', handleClick, true);
  button.removeAttribute(HOTKEY_HINT_ATTRIBUTE);

  const before = hiddenBefore.get(button);

  // Replaying the captured declaration, not writing a value we chose — this
  // module knows no CSS values, only that YouTube had one here.
  if (before === undefined || before === '') button.style.removeProperty('display');
  else button.style.setProperty('display', before);
}

/**
 * Move the button to the position the player's own `data-priority` values imply: before the first
 * sibling in the right-hand group that outranks it, last if none does (rule 3). Two ways out without
 * touching the DOM, both deliberate: a player with no right-hand group is not one we recognise, and
 * a button with no rank cannot be ordered — in both cases it stays exactly where YouTube put it,
 * un-hidden and working, because guessing a position is the hardcoding this rewrite exists to delete.
 */
function place(player: Element, button: HTMLElement): void {
  const group = player.querySelector(RIGHT_CONTROLS_GROUP);
  if (!group) return;

  const ours = priorityOf(button);
  if (ours === null) return;

  let before: Element | null = null;
  for (const sibling of Array.from(group.children)) {
    if (sibling === button) continue;

    const priority = priorityOf(sibling);
    if (priority !== null && priority > ours) {
      before = sibling;
      break;
    }
  }

  // Already where it belongs. Skipping the write is not an optimisation: `insertBefore` is itself
  // a childList mutation, so re-inserting on every pass would feed the observer that woke us and
  // never settle (DECISIONS 32).
  if (button.parentElement === group && button.nextElementSibling === before) return;

  group.insertBefore(button, before);
}

/** A sibling's rank, or nothing when it carries none we can read. */
function priorityOf(element: Element): number | null {
  const raw = element.getAttribute(PRIORITY_ATTRIBUTE);
  if (raw === null || raw.trim() === '') return null;

  const priority = Number(raw);

  return Number.isNaN(priority) ? null : priority;
}

/**
 * Toggle PiP for the player whose PiP button was clicked, and let nothing else answer that click.
 *
 * **Why on the player, in the capture phase.** The button is YouTube's own, already built and
 * already wired: we only find it and un-hide it, so any listener of ours is necessarily registered
 * *after* theirs. Listeners on one target in one phase run in registration order, and
 * `stopImmediatePropagation` cannot un-run a listener that has already run — which is why the first
 * version, a plain listener on the button, suppressed only ancestor and later-registered handlers
 * and never YouTube's own. The fix for *that* is the capture flag, not the element. Two corrections
 * in a row were needed, so the four cases are written out; `theirs` is a handler YouTube already
 * registered, and the winner runs first:
 *
 * | ours | theirs | winner |
 * |---|---|---|
 * | capture, on the button | plain, on the button | ours |
 * | capture, on the player | capture, on the button | ours |
 * | capture, on the button | capture, on an ancestor of the button | **theirs** |
 * | capture, on the player | capture, on an ancestor of the button | ours |
 *
 * So the button would work today, and the **player** is chosen because it is the highest node we
 * control: the only option that also wins the third row, against a handler YouTube delegates to an
 * ancestor of the button — which they may add at any time and no release note would tell us about.
 * Row three is pinned by a test.
 *
 * `stopPropagation`, deliberately **not** `stopImmediatePropagation`: the extra reach of the
 * immediate form is over listeners on this same player, where YouTube's own were registered before
 * ours anyway — while it *would* silence a duplicate listener of ours, and a duplicate listener is a
 * bug worth seeing. Measured: breaking the DOM's de-duplication fails one test under the immediate
 * form and three under this one.
 *
 * **Why intercept rather than let both run.** Not because YouTube's handler is broken — it is not:
 * the standard Picture-in-Picture API has been in Safari for many versions, the button carries no
 * CSS rule hiding it (only an inline declaration), and the owner's report says the button worked.
 * Why YouTube hides it in Safari is a **product** decision of theirs we have not measured. It is
 * precisely *because* their handler works that both must not run: two handlers per click drive PiP
 * twice through two different APIs, in an order and with a timing no test can observe. And ours has
 * to be the one, because `webkitSetPresentationMode` — through {@link togglePiP} — maintains the
 * restore record, so the button restores the previous presentation exactly as the hotkey and the
 * toolbar button do (RRR §4.1 applied one surface further).
 *
 * The cost is that a listener on the player sees every click inside the player, so this bails out
 * immediately unless the click landed inside a PiP button we mounted: `event.target` may be the
 * glyph or a path inside it, hence `closest`, and a button not in {@link controllers} — never
 * mounted, or un-mounted by {@link hide} — falls straight through to YouTube's own handling.
 */
function handleClick(event: Event): void {
  const target = event.target as Element | null;
  const button = target === null ? null : target.closest(PIP_BUTTON);
  if (button === null) return;

  const controller = controllers.get(button);
  if (!controller) return;

  event.preventDefault();
  event.stopPropagation();

  // `closest`, not two hops up the tree (RRR §4.5): it is the clicked button's own player that
  // must be toggled, on a page that may hold several.
  const player = button.closest(PLAYER);
  const video = pickVideo(getVideos(player ?? button.ownerDocument));
  if (!video) return;

  togglePiP(video, controller);
}
