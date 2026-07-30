/**
 * RRR §4.2's plain-key path: which key events toggle PiP, which are suppressed, and how
 * the key is reconfigured while the page stays loaded (RRR §3).
 *
 * These go through `enableHotkey` rather than the composition root because the root's
 * `keyup` listener is never detached and jsdom shares one document per file. Adding the
 * modifier guard left all 38 of the T01 parity tests green (DECISIONS 30), so today's
 * green in `test/content.test.ts` says nothing about the three behaviours pinned here:
 * held modifiers, the configured key, and a stored value that is not a single printable
 * key (the storage layer accepts `'abc def'` on purpose — DECISIONS 41/43).
 *
 * Every propagation assertion either waits a real {@link macrotask} after the write or
 * drives the listener explicitly, so it holds under Safari's asynchronous `onChanged`
 * dispatch as well as the fake's synchronous one (DECISIONS 51).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type HotkeyBinding,
  effectiveHotkey,
  enableHotkey,
  isEditableTarget,
  isSinglePrintableKey,
  matchesHotkey,
} from '../src/core/hotkey';
import { CONTENT_SCRIPT_FRAME_FLAG } from '../src/core/inject';
import { TOGGLE_PIP } from '../src/core/messages';
import { PresentationMode } from '../src/core/presentation';
import { DEFAULTS, SETTINGS_KEY, saveSettings } from '../src/core/settings';
import { hangReads, installFakeBrowser, uninstallFakeBrowser } from './helpers/fake-browser';
import { macrotask } from './helpers/timing';
import { appendVideo } from './helpers/video';

/** A tab id that is not 0, so a falsy-vs-undefined mix-up cannot hide. */
const TAB_ID = 7;

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keyup', { bubbles: true, ...init });
}

/** Presses a plain key, the way a page delivers one. */
function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(keyEvent({ key, code: `Key${key.toUpperCase()}`, ...init }));
}

let binding: HotkeyBinding | null = null;
let triggers = 0;

/** The binding under test, disabled again in `afterEach`. */
function bind(): HotkeyBinding {
  binding = enableHotkey({
    onTrigger: () => {
      triggers += 1;
    },
  });
  return binding;
}

beforeEach(() => {
  triggers = 0;
  binding = null;
  document.body.innerHTML = '';
});

afterEach(() => {
  binding?.disable();
  binding = null;
  uninstallFakeBrowser();
  document.body.innerHTML = '';
});

describe('matchesHotkey — the configured key', () => {
  it('matches by code, so a non-Latin keyboard layout still works', () => {
    // The Russian layout on the physical P key.
    expect(matchesHotkey(keyEvent({ key: 'з', code: 'KeyP' }), 'p')).toBe(true);
  });

  it('matches by key value when no code is reported', () => {
    expect(matchesHotkey(keyEvent({ key: 'p' }), 'p')).toBe(true);
  });

  it('matches the uppercase form, which is how the key arrives with Shift held', () => {
    expect(matchesHotkey(keyEvent({ key: 'P' }), 'p')).toBe(true);
  });

  it('matches a configured key other than the default', () => {
    expect(matchesHotkey(keyEvent({ key: 'm', code: 'KeyM' }), 'm')).toBe(true);
    expect(matchesHotkey(keyEvent({ key: 'M', code: 'KeyM' }), 'm')).toBe(true);
    expect(matchesHotkey(keyEvent({ key: 'p', code: 'KeyP' }), 'm')).toBe(false);
  });

  it('generalises past the letter keys, where no `KeyX` code exists', () => {
    // `Key${'1'.toUpperCase()}` is `Key1`, which no keyboard reports — so a digit
    // hotkey works only if the key-value comparison is doing real work.
    expect(matchesHotkey(keyEvent({ key: '1', code: 'Digit1' }), '1')).toBe(true);
    expect(matchesHotkey(keyEvent({ key: ',', code: 'Comma' }), ',')).toBe(true);
  });

  it('ignores a different key', () => {
    expect(matchesHotkey(keyEvent({ key: 'q', code: 'KeyQ' }), 'p')).toBe(false);
  });

  it('is disabled by an empty configured key (RRR §3)', () => {
    expect(matchesHotkey(keyEvent({ key: 'p', code: 'KeyP' }), '')).toBe(false);
    // The degenerate event, which a naive `event.key === hotkey` would match: an
    // empty hotkey must mean "no key at all", never "whatever reports no key".
    expect(matchesHotkey(keyEvent({ key: '', code: '' }), '')).toBe(false);
  });
});

describe('matchesHotkey — held modifiers (RRR §4.2)', () => {
  const held: Array<[string, KeyboardEventInit]> = [
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt/Option', { altKey: true }],
  ];

  for (const [name, init] of held) {
    it(`never matches while ${name} is held, so it cannot eat a browser shortcut`, () => {
      expect(matchesHotkey(keyEvent({ key: 'p', code: 'KeyP', ...init }), 'p')).toBe(false);
    });
  }

  it('never matches ⌘⇧P, which is our own registered command', () => {
    // `_execute_action` carries ⌘⇧P and toggles PiP through the background, so without
    // this guard a delivered keyup for the same chord toggles a second time and cancels
    // the first — a visible no-op on the shortcut Safari's own settings advertise.
    expect(
      matchesHotkey(keyEvent({ key: 'P', code: 'KeyP', metaKey: true, shiftKey: true }), 'p'),
    ).toBe(false);
  });

  it('still matches with Shift alone held — a deliberate exception', () => {
    // Shift forms no browser shortcut on its own, and it is how an uppercase `P` and half
    // the punctuation keys are produced at all: blocking it would make `?` or `:`
    // unusable as hotkeys.
    expect(matchesHotkey(keyEvent({ key: 'P', code: 'KeyP', shiftKey: true }), 'p')).toBe(true);
  });
});

describe('a stored value that is not a single printable key (DECISIONS 43)', () => {
  it('falls back to the default rather than silently disabling the hotkey', () => {
    // `saveSettings({ hotkey: 'ABC def' })` really does store `'abc def'` — printability
    // belongs to the capture field, not the storage layer. Treating an unusable value as
    // "disabled" would leave the user with a dead key and nothing to look at; degrading to
    // the default is what the settings module already does for a wrong *type*.
    expect(effectiveHotkey('abc def')).toBe(DEFAULTS.hotkey);
    expect(matchesHotkey(keyEvent({ key: 'p', code: 'KeyP' }), 'abc def')).toBe(true);
    expect(matchesHotkey(keyEvent({ key: 'a', code: 'KeyA' }), 'abc def')).toBe(false);
  });

  it('falls back for a stored space, which would be a hostile hotkey anyway', () => {
    // Space is play/pause on every video site.
    expect(effectiveHotkey(' ')).toBe(DEFAULTS.hotkey);
    expect(matchesHotkey(keyEvent({ key: ' ', code: 'Space' }), ' ')).toBe(false);
  });

  it('is case-insensitive about the stored value, whatever wrote it', () => {
    expect(effectiveHotkey('P')).toBe('p');
    expect(effectiveHotkey('M')).toBe('m');
  });

  it('leaves the two values that mean something alone', () => {
    expect(effectiveHotkey('')).toBe('');
    expect(effectiveHotkey('m')).toBe('m');
  });

  it('recognises a single printable key, which is what T09 must enforce', () => {
    expect(isSinglePrintableKey('p')).toBe(true);
    expect(isSinglePrintableKey('1')).toBe(true);
    expect(isSinglePrintableKey('/')).toBe(true);
    expect(isSinglePrintableKey('é')).toBe(true);

    expect(isSinglePrintableKey('')).toBe(false);
    expect(isSinglePrintableKey('pp')).toBe(false);
    expect(isSinglePrintableKey(' ')).toBe(false);
    expect(isSinglePrintableKey('\n')).toBe(false);
    expect(isSinglePrintableKey('\u007f')).toBe(false); // DEL, a control character
    // A surrogate pair: no key press reports an emoji as its `event.key`, so
    // accepting one would accept a hotkey that can never fire — the silent-death
    // case this rule exists to prevent.
    expect(isSinglePrintableKey('\u{1f44d}')).toBe(false);
    expect(effectiveHotkey('\u{1f44d}')).toBe(DEFAULTS.hotkey);
    // `e` plus a combining acute: two code points, so it cannot be one keystroke.
    expect(isSinglePrintableKey('é')).toBe(false);
  });
});

describe('isEditableTarget — where the hotkey must stay out of the way', () => {
  function focused(element: HTMLElement): Element | null {
    element.tabIndex = 0;
    document.body.appendChild(element);
    element.focus();
    return document.activeElement;
  }

  it('suppresses inside an input', () => {
    expect(isEditableTarget(focused(document.createElement('input')))).toBe(true);
  });

  it('suppresses inside a textarea', () => {
    expect(isEditableTarget(focused(document.createElement('textarea')))).toBe(true);
  });

  it('suppresses inside anything contenteditable', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom implements no editing, so isContentEditable is always false there.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isEditableTarget(focused(editable))).toBe(true);
  });

  it('does not suppress for an ordinary element or for nothing focused', () => {
    expect(isEditableTarget(focused(document.createElement('button')))).toBe(false);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('enableHotkey — the key comes from settings', () => {
  it('uses the stored key once the settings have loaded', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'm' } } });

    const active = bind();
    await active.ready;

    press('m');
    expect(triggers).toBe(1);

    press('p');
    expect(triggers).toBe(1);
    expect(active.hotkey).toBe('m');
  });

  it('uses the default key while the read is still in flight, instead of going dead', async () => {
    // *Something* has to answer a keypress that arrives before the read resolves.
    // "Ignore it" makes the hotkey dead for the first moments of every page load; the
    // default is what every fresh install has and what almost every user keeps.
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'm' } } });
    const release = hangReads(fake);

    const active = bind();

    press('p');
    expect(triggers).toBe(1);
    expect(active.hotkey).toBe(DEFAULTS.hotkey);

    release({ [SETTINGS_KEY]: { hotkey: 'm' } });
    await active.ready;

    press('p');
    expect(triggers).toBe(1);
    press('m');
    expect(triggers).toBe(2);
  });

  it('is disabled outright by an empty stored key (RRR §3)', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: '' } } });

    const active = bind();
    await active.ready;

    press('p');
    press('m');
    expect(triggers).toBe(0);
    expect(active.hotkey).toBe('');
  });

  it('stays out of an input even after the key has been reconfigured', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'm' } } });

    const active = bind();
    await active.ready;

    const input = document.body.appendChild(document.createElement('input'));
    input.focus();

    press('m');
    expect(triggers).toBe(0);
  });
});

describe('enableHotkey — live reconfiguration, no reload (RRR §3)', () => {
  it('follows a change written through saveSettings', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'p' } } });

    const active = bind();
    await active.ready;

    await saveSettings({ hotkey: 'k' });
    await macrotask();

    press('k');
    expect(triggers).toBe(1);

    press('p');
    expect(triggers).toBe(1);
  });

  it('takes the new key from the storage event itself, whoever dispatched it', () => {
    // No write at all: the listener is driven directly, so this holds regardless of
    // when or how the browser chooses to deliver the change.
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'p' } } });

    bind();

    fake.storage.onChanged.emit({ [SETTINGS_KEY]: { newValue: { hotkey: 'k' } } });

    press('k');
    expect(triggers).toBe(1);
  });

  it('is disabled live when the user clears the key', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'p' } } });

    const active = bind();
    await active.ready;

    await saveSettings({ hotkey: '' });
    await macrotask();

    press('p');
    expect(triggers).toBe(0);
  });

  it('does not let the first read revert a change that landed while it was in flight', async () => {
    // The subscription is registered before the read, so the change is not missed; the
    // read then resolves with the value from *before* it and must not win. Without the
    // guard the hotkey silently reverts a moment after the user sets it.
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'm' } } });
    const release = hangReads(fake);

    const active = bind();

    fake.storage.onChanged.emit({ [SETTINGS_KEY]: { newValue: { hotkey: 'k' } } });
    release({ [SETTINGS_KEY]: { hotkey: 'm' } });
    await active.ready;

    expect(active.hotkey).toBe('k');
    press('m');
    expect(triggers).toBe(0);
    press('k');
    expect(triggers).toBe(1);
  });

  it('detaches both the key listener and the settings subscription on disable', async () => {
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'p' } } });

    const active = bind();
    await active.ready;

    expect(fake.storage.onChanged.listenerCount).toBe(1);

    active.disable();
    active.disable(); // idempotent

    expect(fake.storage.onChanged.listenerCount).toBe(0);

    press('p');
    expect(triggers).toBe(0);
  });
});

/**
 * The composition root, exercised exactly once in this file (DECISIONS 90): its `keyup`
 * listener is never detached and jsdom reuses one document, so a second copy would leave
 * two listeners and every press would toggle twice.
 */
describe('the content script honours settings live (RRR §3, §4.2)', () => {
  it('starts on the stored key, follows a change, and keeps the toolbar path working', async () => {
    delete (globalThis as Record<string, unknown>)[CONTENT_SCRIPT_FRAME_FLAG];

    const fake = installFakeBrowser({
      items: { [SETTINGS_KEY]: { hotkey: 'm' } },
      tabsWithContentScript: [TAB_ID],
    });

    await import('../src/content');
    await macrotask();

    const { setArgs } = appendVideo();

    press('p');
    expect(setArgs).toEqual([]);

    press('m');
    expect(setArgs).toEqual([PresentationMode.PIP]);

    await saveSettings({ hotkey: 'k' });
    await macrotask();

    press('m');
    expect(setArgs).toHaveLength(1);

    press('k');
    expect(setArgs).toEqual([PresentationMode.PIP, PresentationMode.INLINE]);

    await saveSettings({ hotkey: '' });
    await macrotask();

    press('k');
    expect(setArgs).toHaveLength(2);

    // Disabling the *hotkey* must not disable the toolbar button, which reaches the
    // very same toggle through a message (RRR §4.1).
    await fake.tabs.sendMessage(TAB_ID, { type: TOGGLE_PIP });
    expect(setArgs).toHaveLength(3);
  });
});
