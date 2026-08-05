/**
 * The options page of RRR §4.3 — three sections: Access, Hotkey, Toggles. Safari always opens it in
 * a **tab**, whatever `options_ui.open_in_tab` says.
 *
 * Four things here are decisions rather than plumbing.
 *
 * 1. **Access is read out, never asked for** (RRR §4.3; `src/browser.d.ts` records why
 *    `permissions.request` is undeclared). Not as simple as it looks: see {@link readAccessState},
 *    and note the subscription to `permissions.onAdded`/`onRemoved`, because the grant happens on a
 *    different surface entirely.
 * 2. **The page renders from the value a write resolves with, not from the listener.**
 *    `storage.onChanged` is subscribed to, because a change made in another context must show up
 *    here; but after *this* page's own write the UI comes from what {@link saveSettings} resolved
 *    with. The test fake dispatches `onChanged` synchronously inside `set` while Safari dispatches it
 *    asynchronously afterwards (DECISIONS 51/62), so a page relying on the listener to reflect its
 *    own write would look correct under test and lag in Safari.
 * 3. **A failed write puts the control back.** `saveSettings` rejects on storage failure, unlike
 *    `loadSettings`, so that "your change did not happen" can be said out loud — in one of *two*
 *    sentences, because "no storage API exists" and "the write failed" are different facts and only
 *    the first means this build is broken (see {@link STORAGE_UNAVAILABLE_MESSAGE}). A checkbox left
 *    ticked after a failed write is the page lying about what the extension will do.
 * 4. **Validation happens on the key event, never on a string.** The hotkey field is `readonly` and
 *    its only input is `event.key` (DECISIONS 43/89). `isSinglePrintableKey` accepts 9178 BMP code
 *    units no keystroke can produce — format characters, lone combining marks, private use,
 *    noncharacters — and they stay unreachable precisely because nothing here ever validates text the
 *    field is holding. Hence no `input` handler.
 */
import { effectiveHotkey, isSinglePrintableKey } from './core/hotkey';
import {
  DEFAULTS,
  type Settings,
  StorageUnavailableError,
  type Unsubscribe,
  loadSettings,
  onSettingsChanged,
  saveSettings,
} from './core/settings';

/**
 * The one origin pattern PiPOSS asks Safari *about*. It is the manifest's `host_permissions`
 * pattern, and "is this one granted?" is the difference between "every website" and "the ones you
 * chose".
 */
export const ALL_SITES = '*://*/*';

/**
 * Where the page's state is narrated. Exported so the tests name states, not prose. Four states,
 * each a fact about Safari rather than about PiPOSS, and no fifth: the `refused` message went with
 * the request button. The wording of `none` is what RRR §10.2 item 3 asks the owner to read on a
 * fresh profile (DECISIONS 162) — the first sentence a new user ever sees, so do not reword it
 * without moving that check too.
 */
export const ACCESS_MESSAGES = {
  all: 'Safari allows PiPOSS on every website.',
  some: 'Safari allows PiPOSS on the websites you have chosen, but not on every website.',
  none: 'Safari does not allow PiPOSS on any website yet.',
  unknown: 'Safari did not say which websites PiPOSS may act on.',
} as const;

export const HOTKEY_MESSAGES = {
  idle: 'Click the field, then press the key you want.',
  saved: 'Saved. Press another key to change it.',
  disabled: 'The hotkey is off. The toolbar button and ⌘⇧P still work.',
  modifier: '⌘, ⌃ and ⌥ belong to Safari’s own shortcuts — press the key on its own.',
  space: 'Space is play/pause on nearly every video page, so it cannot be the hotkey.',
  unusable:
    'That key has no printable character, so there would be nothing to show. Try a letter, a digit or a punctuation mark.',
} as const;

export const SAVE_ERROR_MESSAGE = 'Safari could not save that. Your settings are unchanged.';

/**
 * Said instead of {@link SAVE_ERROR_MESSAGE} when there was no storage API to write to at all.
 *
 * Two messages rather than one, and the reason is a real debugging session (BF04): with the
 * `storage` permission missing from `manifest.json` Safari never created `browser.storage`, every
 * write failed, and the generic sentence pointed the reader at Safari and at their own disk — the
 * wrong half of the problem. That sentence describes a moment; this one describes a build.
 */
export const STORAGE_UNAVAILABLE_MESSAGE =
  'PiPOSS cannot reach Safari’s extension storage at all, so no setting can be saved. That is a fault in this build of PiPOSS, not something you can change here.';

/** What the Access section can currently say. */
type AccessState = keyof typeof ACCESS_MESSAGES;

/** Which message the hotkey field's own status line shows after a render. */
type RenderReason = 'loaded' | 'saved';

/**
 * Keys only ever pressed *with* something else. Reporting one as an unusable hotkey would make the
 * field scold the user mid-keystroke: reaching `?` sends a `Shift` keydown of its own first.
 */
const MODIFIER_KEYS = [
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock',
];

/** A live options page. */
export interface OptionsPage {
  /**
   * Resolves once the stored settings and the current permission state have both been applied.
   * Never rejects — every failure inside is a state the page displays. Production ignores it; it
   * exists so a test has a barrier that does not depend on how many turns three reads happen to take.
   */
  readonly ready: Promise<void>;

  /** Detaches every listener. Idempotent. */
  destroy(): void;
}

interface Controls {
  accessState: HTMLElement;
  hotkeyField: HTMLInputElement;
  hotkeyStatus: HTMLElement;
  hotkeyReset: HTMLButtonElement;
  hotkeyDisable: HTMLButtonElement;
  autoPip: HTMLInputElement;
  autoRestore: HTMLInputElement;
  youtubeButton: HTMLInputElement;
  saveError: HTMLElement;
}

/**
 * Wires `options.html` up to the settings and permissions APIs. Does nothing at all — attaches no
 * listener and reads no storage — on a document that is not the options page. That is what makes
 * the module safe to import: the call at the bottom of this file runs in every context the bundle is
 * loaded into, and in a test that has not built the page yet.
 */
export function initOptionsPage(doc: Document = document): OptionsPage {
  const found = findControls(doc);
  if (!found) return inertPage();

  // Re-bound with a non-nullable type rather than relying on the narrowing above: the handlers
  // below are hoisted function declarations, and TypeScript will not carry a narrowing of a
  // captured binding into all of them.
  const controls: Controls = found;

  /**
   * `browser.permissions` as it was at startup, rather than re-resolved per call: a listener has to
   * be removed from the very object it was added to. Unlike the content script this page only ever
   * runs in a realised extension context, so the guard below is for a half-built global, not a race.
   */
  const permissions = permissionsApi();

  /** The last settings that were really stored. What a failed write reverts to. */
  let current: Settings = { ...DEFAULTS };

  /**
   * Serial number of the newest permission read. A read finishing after a newer one started must not
   * paint a superseded state — the grant/revoke events fire in bursts, each triggering two reads.
   */
  let accessReadId = 0;

  let live = true;

  controls.hotkeyField.addEventListener('keydown', handleHotkeyKeyDown);
  controls.hotkeyReset.addEventListener('click', handleResetClick);
  controls.hotkeyDisable.addEventListener('click', handleDisableClick);
  controls.autoPip.addEventListener('change', handleAutoPipChange);
  controls.autoRestore.addEventListener('change', handleAutoRestoreChange);
  controls.youtubeButton.addEventListener('change', handleYouTubeButtonChange);

  // RRR §4.3: the state must live-update. Safari's access popover is a different surface entirely,
  // and a page that only read the permission once would sit there contradicting it.
  permissions?.onAdded.addListener(handlePermissionsChanged);
  permissions?.onRemoved.addListener(handlePermissionsChanged);

  const unsubscribe: Unsubscribe = onSettingsChanged((settings: Settings) => {
    applySettings(settings, 'loaded');
  });

  const ready = Promise.all([
    loadSettings().then((settings) => {
      // The third of the three async paths that can land after teardown, and the one that had no
      // guard: the initial *permission* read routes through `refreshAccessState`, this goes straight
      // to the DOM.
      if (!live) return;

      applySettings(settings, 'loaded');
    }),
    refreshAccessState(),
  ]).then(() => undefined);

  return {
    ready,
    destroy(): void {
      if (!live) return;
      live = false;

      controls.hotkeyField.removeEventListener('keydown', handleHotkeyKeyDown);
      controls.hotkeyReset.removeEventListener('click', handleResetClick);
      controls.hotkeyDisable.removeEventListener('click', handleDisableClick);
      controls.autoPip.removeEventListener('change', handleAutoPipChange);
      controls.autoRestore.removeEventListener('change', handleAutoRestoreChange);
      controls.youtubeButton.removeEventListener('change', handleYouTubeButtonChange);

      permissions?.onAdded.removeListener(handlePermissionsChanged);
      permissions?.onRemoved.removeListener(handlePermissionsChanged);

      unsubscribe();
    },
  };

  /* ----------------------------------------------------------------------- *
   * Access
   * ----------------------------------------------------------------------- */

  function handlePermissionsChanged(): void {
    void refreshAccessState();
  }

  /**
   * Reads the state and says it — the section's only behaviour, and the only thing that ever writes
   * {@link Controls.accessState}. Every path in is a read: startup, `onAdded`, `onRemoved`.
   */
  async function refreshAccessState(): Promise<void> {
    accessReadId += 1;
    const id = accessReadId;

    const state = await readAccessState();
    if (!live) return; // The page was destroyed while this read was in flight.
    if (id !== accessReadId) return; // A newer read is already in flight or done.

    controls.accessState.textContent = ACCESS_MESSAGES[state];
  }

  /**
   * `contains` alone is not enough, and that is the whole reason `getAll` is declared: Safari grants
   * host access **per site**, so with three sites allowed and the wildcard not, `contains` answers
   * `false` — the same answer it gives on a fresh install. Telling a user who has already allowed
   * sites that nothing is allowed is the one thing this section must not do, which is also why
   * `unknown` is a real fourth state and never guessed as `none` (DECISIONS 150).
   */
  async function readAccessState(): Promise<AccessState> {
    if (!permissions) return 'unknown';

    try {
      if (await permissions.contains({ origins: [ALL_SITES] })) return 'all';

      const granted = (await permissions.getAll()).origins;
      // A missing `origins` key is unreadable, not empty. Defaulting it to `[]` would report
      // `'none'` to a user who *has* granted sites.
      if (!Array.isArray(granted)) return 'unknown';

      return granted.length > 0 ? 'some' : 'none';
    } catch {
      return 'unknown';
    }
  }

  /* ----------------------------------------------------------------------- *
   * Hotkey
   * ----------------------------------------------------------------------- */

  /**
   * One keystroke becomes one setting. The validation is `isSinglePrintableKey` from
   * `core/hotkey.ts` — the same predicate the matcher applies, so the page cannot accept a key the
   * matcher would then ignore (DECISIONS 43).
   */
  function handleHotkeyKeyDown(event: KeyboardEvent): void {
    // Tab keeps moving focus: swallowing it would make the field a keyboard trap.
    if (event.key === 'Tab') return;

    // Mid-composition `event.key` is a composition artefact, not a key the user could press again,
    // and only the event knows that — no check on a string can.
    if (event.isComposing) return;

    // Nothing to cancel, and see {@link MODIFIER_KEYS} for why nothing is said either.
    if (MODIFIER_KEYS.indexOf(event.key) >= 0) return;

    if (event.metaKey || event.ctrlKey || event.altKey) {
      // `matchesHotkey` disqualifies these outright, so storing one would hand the user a key that
      // never fires (RRR §4.2 rule 2). Cancelled *nothing*, deliberately: with `preventDefault`
      // above this branch the page swallowed ⌘R while the very message below told the user that ⌘,
      // ⌃ and ⌥ belong to Safari.
      setHotkeyStatus(HOTKEY_MESSAGES.modifier);
      return;
    }

    // Below the two branches above, and load-bearing from here on: Space scrolls the page and
    // Backspace can navigate back, and a settings page that did either while capturing a key would
    // be worse than one that captured nothing.
    event.preventDefault();

    if (event.key === 'Escape') {
      // Without the blur the field keeps the focus ring and eats keys after the user has said "no".
      controls.hotkeyField.blur();
      return;
    }

    if (event.key === ' ') {
      // Rejected by the predicate below too; this branch exists only to say why — space is
      // play/pause, and losing it would be worse than not having a hotkey.
      setHotkeyStatus(HOTKEY_MESSAGES.space);
      return;
    }

    if (!isSinglePrintableKey(event.key)) {
      setHotkeyStatus(HOTKEY_MESSAGES.unusable);
      return;
    }

    // Not lowercased here: the storage layer owns that normalisation (DECISIONS 41), and doing it
    // twice is how the two definitions drift apart.
    commit({ hotkey: event.key });
  }

  function handleResetClick(): void {
    commit({ hotkey: DEFAULTS.hotkey });
  }

  /**
   * RRR §3 gives the empty string one meaning — "the hotkey is disabled" — so it is offered as its
   * own control rather than being whatever a cleared field happens to produce. The field cannot be
   * cleared: it is `readonly`, and no key event maps to "no key".
   */
  function handleDisableClick(): void {
    commit({ hotkey: '' });
  }

  function setHotkeyStatus(message: string): void {
    controls.hotkeyStatus.textContent = message;
  }

  /* ----------------------------------------------------------------------- *
   * Toggles
   * ----------------------------------------------------------------------- */

  function handleAutoPipChange(): void {
    commit({ autoPipOnTabHide: controls.autoPip.checked });
  }

  /**
   * Written independently of `autoPipOnTabHide` rather than forced off with it: the two are one
   * feature to the user but two answers, and clearing this one behind their back would lose it
   * every time they turned the parent off for an afternoon. Nothing is ever remembered while the
   * parent is off, so the stored value is inert until it means something again — which is also
   * what lets this default to on while the parent defaults to off.
   *
   * The control is `disabled` in that state (see `render`), so this handler cannot fire from a
   * click then. It can still fire from a test or a future layout that enables it, and writing
   * the checkbox's own value is the right answer either way.
   */
  function handleAutoRestoreChange(): void {
    commit({ autoRestoreOnTabReturn: controls.autoRestore.checked });
  }

  function handleYouTubeButtonChange(): void {
    commit({ youtubeButton: controls.youtubeButton.checked });
  }

  /* ----------------------------------------------------------------------- *
   * Writing, and rendering what was written
   * ----------------------------------------------------------------------- */

  /**
   * Writes one field and renders the result. Every caller is a user gesture, so `saveSettings`'s
   * rejection has somewhere to go — and it must be given one: without the failure handler a full or
   * unavailable storage becomes an unhandled rejection and a control that silently disagrees with
   * what is stored.
   */
  function commit(update: Partial<Settings>): void {
    saveSettings(update).then(
      (settings) => {
        // A write cannot be unsent, so one in flight when the page is destroyed still lands in
        // storage — but it must not paint a DOM the page has let go of.
        if (!live) return;

        applySettings(settings, 'saved');
      },
      (reason: unknown) => {
        if (!live) return;

        // The write did not happen, so `current` is still the truth. Say so, and put the controls
        // back to it — in whichever of the two sentences fits (point 3 above).
        render(current, 'loaded');
        controls.saveError.textContent =
          reason instanceof StorageUnavailableError
            ? STORAGE_UNAVAILABLE_MESSAGE
            : SAVE_ERROR_MESSAGE;
        controls.saveError.hidden = false;
      },
    );
  }

  function applySettings(settings: Settings, reason: RenderReason): void {
    current = settings;
    render(settings, reason);

    controls.saveError.textContent = '';
    controls.saveError.hidden = true;
  }

  function render(settings: Settings, reason: RenderReason): void {
    const key = effectiveHotkey(settings.hotkey);

    // Uppercase, because that is how a key is labelled everywhere else — Safari's own shortcut
    // fields, this project's README, the keycap on the desk.
    controls.hotkeyField.value = key.toUpperCase();
    controls.autoPip.checked = settings.autoPipOnTabHide;
    controls.autoRestore.checked = settings.autoRestoreOnTabReturn;
    // Disabled, not hidden and not unchecked: with its parent off it can do nothing, and a live
    // control that does nothing is what the access section above refuses to be. The stored value
    // is still shown, because it is still the answer for the moment the parent comes back on.
    controls.autoRestore.disabled = !settings.autoPipOnTabHide;
    controls.youtubeButton.checked = settings.youtubeButton;

    setHotkeyStatus(
      key === ''
        ? HOTKEY_MESSAGES.disabled
        : reason === 'saved'
          ? HOTKEY_MESSAGES.saved
          : HOTKEY_MESSAGES.idle,
    );
  }
}

/**
 * The controls of RRR §4.3, or `null` on a document that is not the options page.
 *
 * All or nothing: a page missing one control is a broken build, and half-wiring it would leave a
 * visible switch that does nothing. The `data-testid` attributes are the lookup keys as well as the
 * test handles, so a typo in `options.html` cannot make the page pass its tests and fail in Safari.
 */
function findControls(doc: Document): Controls | null {
  if (!doc.querySelector('[data-piposs-options]')) return null;

  const found = {
    accessState: byTestId<HTMLElement>(doc, 'access-state'),
    hotkeyField: byTestId<HTMLInputElement>(doc, 'hotkey-field'),
    hotkeyStatus: byTestId<HTMLElement>(doc, 'hotkey-status'),
    hotkeyReset: byTestId<HTMLButtonElement>(doc, 'hotkey-reset'),
    hotkeyDisable: byTestId<HTMLButtonElement>(doc, 'hotkey-disable'),
    autoPip: byTestId<HTMLInputElement>(doc, 'toggle-autopip'),
    autoRestore: byTestId<HTMLInputElement>(doc, 'toggle-auto-restore'),
    youtubeButton: byTestId<HTMLInputElement>(doc, 'toggle-youtube-button'),
    saveError: byTestId<HTMLElement>(doc, 'save-error'),
  };

  for (const element of Object.values(found)) {
    if (!element) return null;
  }

  return found as Controls;
}

function byTestId<E extends Element>(doc: Document, testId: string): E | null {
  return doc.querySelector<E>(`[data-testid="${testId}"]`);
}

function inertPage(): OptionsPage {
  return {
    ready: Promise.resolve(),
    destroy(): void {},
  };
}

/** `browser.permissions`, or `null` outside a realised extension context. */
function permissionsApi(): BrowserPermissions | null {
  if (typeof browser === 'undefined') return null;
  return browser?.permissions ?? null;
}

// Below every declaration it touches, so nothing is read out of its temporal dead zone.
// `options.html` loads the bundle with `defer`, so the document is complete by the time this runs.
initOptionsPage();
