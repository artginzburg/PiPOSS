/**
 * The plain-key half of RRR §4.2: one configurable printable key that toggles Picture in Picture,
 * listened for in the page. The other half — `_execute_action` at `⌘⇧P` — is the background's, and
 * the two must not fight, which is the reason for rule 2.
 *
 * Three rules, each of which has cost somebody something:
 *
 * 1. **Three ways to recognise one key.** `event.code === 'KeyP'` catches the physical key on a
 *    non-Latin layout (the Russian layout reports `key: 'з'`), `event.key` catches keys that have
 *    no `KeyX` code at all — digits, punctuation — and its uppercase form catches the Shift case.
 *    None of the three is redundant.
 * 2. **Cmd, Ctrl and Alt disqualify the event outright.** `event.code` survives a held modifier, so
 *    without this guard `⌘P` (print), `⌥P` (which types `π`) and `⌘⇧P` (this extension's own
 *    registered command) would all toggle PiP — and `⌘⇧P` a *second* time, entering and immediately
 *    leaving. Shift deliberately does not disqualify: see {@link matchesHotkey}.
 * 3. **An unusable stored value degrades to the default; only the empty string disables.** The
 *    storage layer takes anything and only lowercases it (DECISIONS 41/43) — validation is the
 *    options page's job. A matcher that treated `'abc def'` as "no key" would hand the user a dead
 *    hotkey with nothing to see, so an unusable value is corruption and falls back, as the settings
 *    module already treats a wrong *type* (DECISIONS 40). `''` is RRR §3's "disabled", and is honoured.
 */
import { DEFAULTS, type Settings, followSettings } from './settings';

/**
 * The properties of a `KeyboardEvent` the matcher reads, and nothing else — so a test can hand it
 * a plain object and a caller cannot accidentally depend on more. A real `KeyboardEvent` satisfies
 * it structurally.
 */
export interface HotkeyEvent {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

/** Tag names whose focused element swallows every printable key. */
const EDITABLE_TAG_NAMES = ['INPUT', 'TEXTAREA'];

/**
 * Is `value` something a single keystroke can produce and a user can see? Exported for the options
 * page's capture field, which is the layer RRR §3's "single printable key" is actually enforced at
 * (DECISIONS 43), so both validate by one rule.
 *
 * The measure is one UTF-16 code unit, deliberately: for a real key press `event.key` is always a
 * single character from the Basic Multilingual Plane, so a surrogate pair (an emoji), a base letter
 * plus a combining mark, and any longer string are unmatchable by definition — accepting one would
 * leave a dead hotkey with nothing for the user to see. Whitespace and control characters are out
 * too: a space hotkey would fight play/pause on every video site, and no control character has a
 * printable form to show.
 */
export function isSinglePrintableKey(value: string): boolean {
  if (value.length !== 1) return false;
  if (/\s/.test(value)) return false;

  const code = value.charCodeAt(0);

  // C0 with DEL, C1, and lone surrogates. No `\p{C}`: Unicode property escapes are ES2018 and this
  // bundle targets ES2016, where esbuild refuses to emit them.
  return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff));
}

/**
 * The key really in effect for a stored value: itself when usable, `''` when the hotkey is
 * disabled, the default when the stored value is unusable (rule 3 above).
 */
export function effectiveHotkey(stored: string): string {
  const normalised = stored.toLowerCase();

  if (normalised === '') return '';
  if (isSinglePrintableKey(normalised)) return normalised;

  return DEFAULTS.hotkey;
}

/**
 * Does this key event mean "toggle PiP", for the configured `hotkey`? Answers only about the *key*;
 * whether the focused element should swallow it is {@link isEditableTarget}'s question.
 *
 * Shift is the one modifier that does not disqualify an event, deliberately. It is how the
 * uppercase form of a letter and most punctuation are produced at all, so rejecting it would make
 * `?` or `:` unusable as hotkeys and would break the uppercase-`P` behaviour `test/content.test.ts`
 * pins. Shift alone forms no browser shortcut worth protecting — every Safari accelerator involves
 * Cmd, and `⌘⇧P` is already rejected by the Cmd rule.
 */
export function matchesHotkey(event: HotkeyEvent, hotkey: string): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  const key = effectiveHotkey(hotkey);
  // Checked before comparing, because `event.key` can itself be the empty string and "disabled"
  // must never mean "matches whatever reports no key".
  if (key === '') return false;

  const upper = key.toUpperCase();

  return event.code === `Key${upper}` || event.key === key || event.key === upper;
}

/**
 * Would this element swallow a printable key? Text fields and anything editable do, and the hotkey
 * must stay out of their way (RRR §4.2).
 *
 * `isContentEditable` is read off the element rather than through `instanceof HTMLElement`: an
 * element can come from another document, where `instanceof` is false against this realm's
 * constructor, and an SVG or MathML element simply does not carry the property.
 */
export function isEditableTarget(element: Element | null): boolean {
  if (!element) return false;
  if (EDITABLE_TAG_NAMES.indexOf(element.tagName) >= 0) return true;

  return (element as Partial<HTMLElement>).isContentEditable === true;
}

/** A live hotkey listener. Returned by {@link enableHotkey}. */
export interface HotkeyBinding {
  /** The key in effect right now — `''` when disabled, the default until settings have arrived. */
  readonly hotkey: string;

  /** `followSettings`'s barrier: resolves once the stored settings have been applied. */
  readonly ready: Promise<void>;

  /** Detaches the key listener and the settings subscription. Idempotent. */
  disable(): void;
}

export interface EnableHotkeyOptions {
  /** What the hotkey does. Called once per matching key event. */
  onTrigger: () => void;

  /** The document to listen on. Defaults to the ambient one. */
  target?: Document;
}

/**
 * Listens for the configured hotkey and keeps that configuration current.
 *
 * The listener is attached **synchronously**, before the settings read that will tell us which key
 * it is, and starts on {@link DEFAULTS}`.hotkey`. A decision, not an oversight: the content script
 * runs at document start, the read is asynchronous, and a key pressed in between has to do
 * *something*. Ignoring it would make the hotkey dead for the first moments of every page load for
 * every user, to avoid one wrong toggle in the same window for the minority who reconfigured it.
 * `followSettings` owns the ordering of the read against the subscription.
 *
 * `keyup` rather than `keydown`, preserved from the original: a held key would repeat the toggle.
 */
export function enableHotkey({ onTrigger, target = document }: EnableHotkeyOptions): HotkeyBinding {
  let hotkey = effectiveHotkey(DEFAULTS.hotkey);

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (!matchesHotkey(event, hotkey)) return;
    if (isEditableTarget(target.activeElement)) return;

    onTrigger();
  };

  // `passive`: this never calls `preventDefault`, and saying so lets the browser dispatch without
  // waiting to find out.
  target.addEventListener('keyup', handleKeyUp, { passive: true });

  const { ready, unsubscribe } = followSettings((settings: Settings) => {
    hotkey = effectiveHotkey(settings.hotkey);
  });

  let enabled = true;

  return {
    get hotkey(): string {
      return hotkey;
    },
    ready,
    disable(): void {
      if (!enabled) return;
      enabled = false;

      target.removeEventListener('keyup', handleKeyUp);
      unsubscribe();
    },
  };
}
