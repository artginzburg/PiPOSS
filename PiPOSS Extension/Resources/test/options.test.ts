/**
 * The options page of RRR §4.3, driven through the **real** `options.html`.
 *
 * The markup is read off disk and injected into jsdom rather than retyped: a hand-written
 * fixture would let every test below pass while the shipped page had a misspelt
 * `data-testid`, no stylesheet link, or a `value` that no longer matched the defaults — and
 * the options page is a surface no other test can reach.
 *
 * The fake dispatches `storage.onChanged` *synchronously inside `set`*, so an awaited write
 * is not a barrier for anything a listener computes (DECISIONS 51). Nothing here asserts
 * "the UI shows X" on the strength of a listener having run: the page renders from the value
 * `saveSettings` resolves with, and the listener path is driven explicitly through
 * {@link FakeStorageOnChanged.emit}. {@link settle} is the barrier that keeps a write from
 * landing in the next test's freshly installed fake (DECISIONS 52).
 */
import { existsSync } from 'node:fs';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { matchesHotkey } from '../src/core/hotkey';
import { DEFAULTS, SETTINGS_KEY, type Settings, loadSettings } from '../src/core/settings';
import {
  ACCESS_MESSAGES,
  ALL_SITES,
  HOTKEY_MESSAGES,
  type OptionsPage,
  SAVE_ERROR_MESSAGE,
  STORAGE_UNAVAILABLE_MESSAGE,
  initOptionsPage,
} from '../src/options';
import {
  type FakeBrowser,
  type FakeBrowserOptions,
  installFakeBrowser,
  installPartialBrowser,
  uninstallFakeBrowser,
} from './helpers/fake-browser';
import { assertAnchored, readResource, resource } from './helpers/paths';

const OPTIONS_HTML = readResource('options.html');

beforeAll(assertAnchored);

/**
 * Puts the shipped markup into jsdom. `<script src>` and `<link>` live in `<head>` and are
 * deliberately not copied: jsdom would try to fetch them, and what this file tests is the
 * module it imported directly.
 */
function renderShippedMarkup(): void {
  const parsed = new DOMParser().parseFromString(OPTIONS_HTML, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

let page: OptionsPage | null = null;

interface OpenedPage {
  fake: FakeBrowser;
  page: OptionsPage;
}

/** Installs the fake, renders the shipped markup, starts the page, waits for it. */
async function openPage(options: FakeBrowserOptions = {}): Promise<OpenedPage> {
  const fake = installFakeBrowser(options);
  renderShippedMarkup();
  page = initOptionsPage();
  await page.ready;
  return { fake, page };
}

/** Installs the fake with `settings` already holding `stored`. */
function openStored(stored: unknown, options: FakeBrowserOptions = {}): Promise<OpenedPage> {
  return openPage({ ...options, items: { [SETTINGS_KEY]: stored } });
}

/**
 * Drains the event loop. Macrotasks rather than microtasks: `permissions.contains`/`getAll`
 * tick once each, and one turn also drains every pending microtask, which is all a settings
 * write needs.
 */
async function settle(turns = 4): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise((resolve_) => {
      setTimeout(resolve_, 0);
    });
  }
}

function control<E extends Element>(testId: string): E {
  const found = document.querySelector<E>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`options.html has no [data-testid="${testId}"]`);
  return found;
}

const accessState = (): HTMLElement => control<HTMLElement>('access-state');
const hotkeyField = (): HTMLInputElement => control<HTMLInputElement>('hotkey-field');
const hotkeyStatus = (): HTMLElement => control<HTMLElement>('hotkey-status');
const hotkeyReset = (): HTMLButtonElement => control<HTMLButtonElement>('hotkey-reset');
const hotkeyDisable = (): HTMLButtonElement => control<HTMLButtonElement>('hotkey-disable');
const autoPipToggle = (): HTMLInputElement => control<HTMLInputElement>('toggle-autopip');
const autoRestoreToggle = (): HTMLInputElement => control<HTMLInputElement>('toggle-auto-restore');
const youtubeToggle = (): HTMLInputElement => control<HTMLInputElement>('toggle-youtube-button');
const saveError = (): HTMLElement => control<HTMLElement>('save-error');

/**
 * The whole Access section, found through the state line rather than by position, so the
 * assertions below survive the section moving.
 */
function accessSection(): HTMLElement {
  const section = accessState().closest('section');
  if (!section)
    throw new Error('options.html has no <section> around [data-testid="access-state"]');
  return section;
}

/** A real click, bubbling and cancelable, dispatched synchronously. */
function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

interface KeyPress {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

/** @returns whether the page called `preventDefault` — i.e. whether it took the key. */
function press(press_: KeyPress): boolean {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: press_.code ?? '',
    ...press_,
  });
  hotkeyField().dispatchEvent(event);
  return event.defaultPrevented;
}

/** The whole stored settings object, merged, as the content script would see it. */
function stored(): Promise<Settings> {
  return loadSettings();
}

afterEach(() => {
  page?.destroy();
  page = null;
  document.body.innerHTML = '';
  uninstallFakeBrowser();
});

/* ------------------------------------------------------------------------- *
 * The shipped markup
 * ------------------------------------------------------------------------- */

describe('options.html — the file Safari actually loads', () => {
  it('references the stylesheet and the bundle, and both have something behind them', () => {
    expect(OPTIONS_HTML).toContain('href="options.css"');
    expect(existsSync(resource('options.css'))).toBe(true);

    // The bundle is a build artefact and may be absent in a fresh checkout, so what is
    // checked is that nothing points at a bundle no source file produces — T00's failure
    // mode, where the extension installs and does nothing.
    expect(OPTIONS_HTML).toContain('src="dist/options.js"');
    expect(existsSync(resource('src/options.ts'))).toBe(true);
  });

  it('loads the bundle deferred, so the page is complete before the script runs', () => {
    expect(OPTIONS_HTML).toMatch(/<script[^>]*\bdefer\b/);
  });

  it('carries no inline script or style, which the MV3 default CSP forbids', () => {
    expect(OPTIONS_HTML).not.toMatch(/<style[\s>]/);
    expect(OPTIONS_HTML).not.toMatch(/\son[a-z]+=/i);
  });

  it('has a stable data-testid on every control of RRR §4.3', () => {
    renderShippedMarkup();

    for (const testId of [
      'access-state',
      'access-note',
      'access-guide',
      'hotkey-field',
      'hotkey-status',
      'hotkey-reset',
      'hotkey-disable',
      'command-note',
      'toggle-autopip',
      'toggle-auto-restore',
      'toggle-youtube-button',
      'save-error',
    ]) {
      expect(document.querySelectorAll(`[data-testid="${testId}"]`)).toHaveLength(1);
    }
  });

  it('points the ⌘⇧P note at Safari’s own settings, which is the only place it lives', () => {
    renderShippedMarkup();

    const note = control<HTMLElement>('command-note').textContent ?? '';
    expect(note).toContain('Offers keyboard shortcuts');
    expect(note).toContain('Safari');
  });

  it('is honest that only the user can widen access', () => {
    renderShippedMarkup();

    // The section's premise now that there is no control here: a read-out with no such
    // statement leaves the reader wondering what is supposed to change it (RRR §4.3).
    expect(control<HTMLElement>('access-note').textContent).toMatch(/only you/i);
  });

  it('shows the RRR §3 defaults before any script has run', async () => {
    // The no-JS state, and a guard against a default drifting in one place only.
    renderShippedMarkup();

    expect(hotkeyField().value.toLowerCase()).toBe(DEFAULTS.hotkey);
    expect(autoPipToggle().checked).toBe(DEFAULTS.autoPipOnTabHide);
    expect(autoRestoreToggle().checked).toBe(DEFAULTS.autoRestoreOnTabReturn);
    expect(youtubeToggle().checked).toBe(DEFAULTS.youtubeButton);

    // The return toggle's default is a *pair*: on, and greyed out because its parent is off.
    // Written into the markup as well as into `render`, because this is the state of the page
    // for the moment before the bundle runs — and the state it keeps if the bundle is missing.
    expect(autoRestoreToggle().disabled).toBe(true);

    // And nothing above wrote anything: no fake is installed, so a write would throw.
    await settle(1);
  });

  it('keeps the hotkey field readonly, because its input is the key event', () => {
    renderShippedMarkup();
    expect(hotkeyField().readOnly).toBe(true);
  });
});

describe('initOptionsPage on a page that is not ours', () => {
  it('attaches nothing at all when the marker element is absent', async () => {
    const fake = installFakeBrowser();
    document.body.innerHTML = '<p>some other extension page</p>';

    page = initOptionsPage();
    await page.ready;
    await settle();

    // Importing this module must be inert, or every test file that imports it inherits a
    // live settings subscription and a permissions listener.
    expect(fake.storage.onChanged.listenerCount).toBe(0);
    expect(fake.permissions.onAdded.listenerCount).toBe(0);
    expect(fake.permissions.onRemoved.listenerCount).toBe(0);
    expect(fake.storage.local.getCalls).toEqual([]);
    expect(fake.permissions.containsCalls).toEqual([]);
  });

  it('stays inert when one control is missing, rather than half-wiring the page', async () => {
    // A page missing a control is a broken build; attaching to the rest would leave a
    // visible switch that does nothing, which is worse than a page that never came up.
    const fake = installFakeBrowser();
    renderShippedMarkup();
    control<HTMLElement>('toggle-youtube-button').remove();

    page = initOptionsPage();
    await page.ready;
    await settle();

    expect(fake.storage.onChanged.listenerCount).toBe(0);
    expect(fake.permissions.containsCalls).toEqual([]);
    expect(fake.storage.local.getCalls).toEqual([]);
  });

  it('survives a browser global with no permissions and no storage', async () => {
    installPartialBrowser({});
    renderShippedMarkup();

    page = initOptionsPage();
    await expect(page.ready).resolves.toBeUndefined();
    await settle();

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.unknown);
    // Storage that is not there reads as the defaults (`loadSettings` never rejects).
    expect(hotkeyField().value.toLowerCase()).toBe(DEFAULTS.hotkey);
  });
});

/* ------------------------------------------------------------------------- *
 * 1. Access (RRR §4.3.1)
 * ------------------------------------------------------------------------- */

/**
 * RRR §4.3: the section is **a marker**, not a control, so what is asserted is the opposite
 * of a request flow — nothing in this page ever asks Safari for anything.
 */
describe('Access — an indicator, and nothing that offers to widen access', () => {
  it('has no control at all in the Access section', () => {
    renderShippedMarkup();

    // A button here would claim PiPOSS can widen its own access.
    expect(accessSection().querySelectorAll('button, input, select, textarea, a')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="access-request"]')).toHaveLength(0);
  });

  it('never calls permissions.request, whatever the user does on the page', async () => {
    const { fake } = await openPage();

    // Everything clickable, plus the section itself and the state line — a handler attached
    // to either would be the same defect wearing a different tag.
    accessSection().querySelectorAll('*').forEach(click);
    click(accessSection());
    click(hotkeyReset());
    click(hotkeyDisable());
    press({ key: 'm', code: 'KeyM' });
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    youtubeToggle().dispatchEvent(new Event('change', { bubbles: true }));
    fake.permissions.grant(['https://youtube.com/*']);
    await settle();

    expect(fake.permissions.requestCalls).toEqual([]);
    // And the state the page shows is Safari's, not one it produced by asking.
    expect(fake.permissions.granted).toEqual(['https://youtube.com/*']);
  });

  it('says what happens instead — Safari’s own path — without offering to do it', () => {
    renderShippedMarkup();

    const note = control<HTMLElement>('access-note').textContent ?? '';
    expect(note).toContain('Safari');
    // Named so the reader knows where to go (RRR §4.3). Not a control: this page cannot open
    // Safari's settings either.
    expect(note).toMatch(/Settings/);
    expect(note).toMatch(/Extensions/);
    // The toolbar button is the one surface that works ungranted, and without naming it the
    // section reads as "PiPOSS does nothing until you act".
    expect(note).toMatch(/toolbar button/i);
  });

  it('points at the app’s guide rather than at a request', () => {
    renderShippedMarkup();

    expect(control<HTMLElement>('access-guide').textContent).toMatch(/PiPOSS app/);
  });

  it('makes no claim anywhere in the section that PiPOSS can ask for access', () => {
    renderShippedMarkup();

    // Every word the section can ever show: the static prose plus the four states.
    const everySentence = [accessSection().textContent ?? '', ...Object.values(ACCESS_MESSAGES)];

    for (const sentence of everySentence) {
      // "grant" is not forbidden — "only you can grant this" is the honesty RRR §4.3 keeps.
      // Asking is what went: PiPOSS no longer has a verb here.
      expect(sentence).not.toMatch(/\bask(s|ed|ing)?\b/i);
      expect(sentence).not.toMatch(/\brequest(s|ed|ing)?\b/i);
    }
  });

  it('has exactly the four states of DECISIONS 150 and no fifth', () => {
    // With nothing to decline, a page that could say "access was not granted" would be
    // describing an event that cannot happen.
    expect(Object.keys(ACCESS_MESSAGES).sort()).toEqual(['all', 'none', 'some', 'unknown']);
  });
});

describe('Access — what the page says about the current state', () => {
  it('says no website is allowed on a fresh install', async () => {
    await openPage();
    expect(accessState().textContent).toBe(ACCESS_MESSAGES.none);
  });

  it('says every website is allowed when the all-sites origin is granted', async () => {
    await openPage({ grantedOrigins: [ALL_SITES] });

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.all);
  });

  it('distinguishes “some websites” from “none”, which needs getAll as well as contains', async () => {
    const { fake } = await openPage({ grantedOrigins: ['https://youtube.com/*'] });

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.some);
    expect(fake.permissions.getAllCalls).toBeGreaterThan(0);
  });

  it('treats a getAll answer with no origins key as unreadable, not as “none”', async () => {
    // `?? []` here would report "no website is allowed" to a user who has allowed sites.
    const fake = installFakeBrowser({ grantedOrigins: ['https://youtube.com/*'] });
    fake.permissions.getAll = async (): Promise<BrowserPermissionsSet> => ({});

    renderShippedMarkup();
    page = initOptionsPage();
    await page.ready;

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.unknown);
    expect(accessState().textContent).not.toBe(ACCESS_MESSAGES.none);
  });

  it('reports the state as unknown rather than guessing when Safari will not say', async () => {
    const fake = installFakeBrowser();
    fake.permissions.containsFailure = new Error('nope');

    renderShippedMarkup();
    page = initOptionsPage();
    await page.ready;

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.unknown);
  });
});

describe('Access — live state (RRR §4.3: via permissions.onAdded / onRemoved)', () => {
  it('follows a grant made in Safari’s own popover, with no interaction here', async () => {
    const { fake } = await openPage();
    expect(accessState().textContent).toBe(ACCESS_MESSAGES.none);

    fake.permissions.grant([ALL_SITES]);
    await settle();

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.all);
  });

  it('follows a revocation, which in Safari only ever happens outside this page', async () => {
    const { fake } = await openPage({ grantedOrigins: [ALL_SITES] });
    expect(accessState().textContent).toBe(ACCESS_MESSAGES.all);

    fake.permissions.revoke([ALL_SITES]);
    await settle();

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.none);
  });

  it('ignores a permission read that a newer one has already overtaken', async () => {
    // Grants and revocations arrive in bursts and each starts two async reads, so without a
    // freshness guard the *slowest* answer is the one left on screen.
    const { fake } = await openPage();

    let reads = 0;
    fake.permissions.contains = async (): Promise<boolean> => {
      reads += 1;
      const stale = reads === 1;
      await new Promise((resolve_) => {
        setTimeout(resolve_, stale ? 30 : 0);
      });
      // The older read still believes nothing is granted; the newer one knows better.
      return !stale;
    };
    fake.permissions.getAll = async (): Promise<BrowserPermissionsSet> => {
      await new Promise((resolve_) => {
        setTimeout(resolve_, 0);
      });
      return { origins: [] };
    };

    fake.permissions.onAdded.emit({ origins: [ALL_SITES] });
    fake.permissions.onAdded.emit({ origins: [ALL_SITES] });

    await new Promise((resolve_) => {
      setTimeout(resolve_, 80);
    });

    expect(accessState().textContent).toBe(ACCESS_MESSAGES.all);
  });

  it('registers exactly one listener on each event, and drops both on destroy', async () => {
    const { fake, page: opened } = await openPage();

    expect(fake.permissions.onAdded.listenerCount).toBe(1);
    expect(fake.permissions.onRemoved.listenerCount).toBe(1);

    opened.destroy();

    expect(fake.permissions.onAdded.listenerCount).toBe(0);
    expect(fake.permissions.onRemoved.listenerCount).toBe(0);
  });

  it('walks all four ways through the states as Safari changes its mind', async () => {
    // The live path is the *only* path now that there is no button: a marker that goes stale
    // the moment the user grants something in Safari is not a marker.
    const { fake } = await openPage();
    expect(accessState().textContent).toBe(ACCESS_MESSAGES.none);

    fake.permissions.grant(['https://a.test/*']);
    await settle();
    expect(accessState().textContent).toBe(ACCESS_MESSAGES.some);

    fake.permissions.grant([ALL_SITES]);
    await settle();
    expect(accessState().textContent).toBe(ACCESS_MESSAGES.all);

    fake.permissions.revoke([ALL_SITES, 'https://a.test/*']);
    await settle();
    expect(accessState().textContent).toBe(ACCESS_MESSAGES.none);
  });
});

/* ------------------------------------------------------------------------- *
 * 2. Hotkey (RRR §4.3.2)
 * ------------------------------------------------------------------------- */

describe('Hotkey — capture', () => {
  it('shows the stored key, uppercased, because that is how a key is labelled', async () => {
    await openStored({ hotkey: 'm' });
    expect(hotkeyField().value).toBe('M');
  });

  it('shows the key that is really in effect when the stored value is unusable', async () => {
    // The storage layer only lowercases what it is given (DECISIONS 41/43) and
    // `effectiveHotkey` degrades an unusable value to the default (DECISIONS 84), so a field
    // showing the raw string would say `ABC DEF` while the key that works is `P`.
    await openStored({ hotkey: 'abc def' });
    expect(hotkeyField().value).toBe(DEFAULTS.hotkey.toUpperCase());
  });

  it('writes the pressed key to settings', async () => {
    await openPage();

    expect(press({ key: 'm', code: 'KeyM' })).toBe(true);
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: 'm' });
    expect(hotkeyField().value).toBe('M');
    expect(hotkeyStatus().textContent).toBe(HOTKEY_MESSAGES.saved);
  });

  it('accepts a shifted key and lets the storage layer lowercase it (DECISIONS 41)', async () => {
    await openPage();

    press({ key: 'K', code: 'KeyK', shiftKey: true });
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: 'k' });
    expect(hotkeyField().value).toBe('K');
  });

  it('accepts punctuation, which has no KeyX code and only works through event.key', async () => {
    await openPage();

    press({ key: '/', code: 'Slash' });
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: '/' });
  });

  it('never accepts anything the matcher could not then match', async () => {
    // The invariant tying this page to `core/hotkey.ts`: whatever the field takes, an event
    // carrying that key must trigger the hotkey. Without it the page can store a value that
    // leaves the user with a dead key and no cause.
    for (const key of ['m', 'K', '/', '7', 'ß']) {
      const { page: opened } = await openPage();

      press({ key, code: '' });
      await settle();

      const settings = await stored();
      expect(
        matchesHotkey(
          { key, code: '', metaKey: false, ctrlKey: false, altKey: false },
          settings.hotkey,
        ),
      ).toBe(true);

      opened.destroy();
      uninstallFakeBrowser();
      document.body.innerHTML = '';
    }
    page = null;
  });
});

describe('Hotkey — what it refuses', () => {
  it('refuses a single space, because space is play/pause on every video page', async () => {
    await openStored({ hotkey: 'p' });

    expect(press({ key: ' ', code: 'Space' })).toBe(true);
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: 'p' });
    expect(hotkeyStatus().textContent).toBe(HOTKEY_MESSAGES.space);
    expect(hotkeyField().value).toBe('P');
  });

  it.each(['Enter', 'Backspace', 'Delete', 'ArrowLeft', 'F5', 'Home'])(
    'refuses %s — a key that can be pressed but can never be the hotkey',
    async (key) => {
      await openStored({ hotkey: 'p' });

      press({ key, code: key });
      await settle();

      await expect(stored()).resolves.toMatchObject({ hotkey: 'p' });
      expect(hotkeyStatus().textContent).toBe(HOTKEY_MESSAGES.unusable);
    },
  );

  it('refuses a control character, by the same printability rule the matcher applies', async () => {
    // A length check would let this through; reusing `isSinglePrintableKey` is what keeps the
    // page from accepting a key the matcher would ignore, or one with no printable form to
    // put in the field (DECISIONS 43).
    await openStored({ hotkey: 'p' });

    // U+007F DELETE: one code unit, so a length check calls it a key; unprintable, so the
    // shared predicate does not.
    press({ key: '\u007f', code: '' });
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: 'p' });
    expect(hotkeyStatus().textContent).toBe(HOTKEY_MESSAGES.unusable);
  });

  it('refuses a key held with ⌘, ⌃ or ⌥, which the matcher disqualifies outright', async () => {
    await openStored({ hotkey: 'p' });

    for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      press({ key: 'j', code: 'KeyJ', [modifier]: true });
      await settle();

      await expect(stored()).resolves.toMatchObject({ hotkey: 'p' });
      expect(hotkeyStatus().textContent).toBe(HOTKEY_MESSAGES.modifier);
    }
  });

  it('ignores a modifier pressed on its own instead of calling it unusable', async () => {
    // Holding Shift to reach `?` sends a `Shift` keydown first, and reporting that as an
    // error would make the field scold the user mid-keystroke.
    const { fake } = await openStored({ hotkey: 'p' });
    const before = hotkeyStatus().textContent;

    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) {
      press({ key, code: key, shiftKey: key === 'Shift' });
    }
    await settle();

    expect(hotkeyStatus().textContent).toBe(before);
    expect(fake.storage.local.setCalls).toEqual([]);
  });

  it('reads the key event, never the field’s own value (DECISIONS 43, 89)', async () => {
    // The field is `readonly`, but a paste, an autofill or a future edit could still put a
    // string in it. `isSinglePrintableKey` accepts 9178 code units no keystroke can produce
    // (DECISIONS 89), and they stay unreachable only because nothing here ever validates a
    // string the field is holding.
    const { fake } = await openStored({ hotkey: 'p' });

    hotkeyField().value = 'ABC def';
    hotkeyField().dispatchEvent(new Event('input', { bubbles: true }));
    hotkeyField().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(fake.storage.local.setCalls).toEqual([]);
    await expect(stored()).resolves.toMatchObject({ hotkey: 'p' });
  });

  it('leaves a key to the input method while a composition is in progress', async () => {
    // Only the event knows this: mid-composition `event.key` is a composition artefact
    // rather than a key the user could press again, and no check on a string could tell.
    const { fake } = await openStored({ hotkey: 'p' });

    expect(press({ key: 'm', code: 'KeyM', isComposing: true })).toBe(false);
    await settle();

    expect(fake.storage.local.setCalls).toEqual([]);
    await expect(stored()).resolves.toMatchObject({ hotkey: 'p' });
  });

  it('lets Tab through, so the field is not a keyboard trap', async () => {
    await openPage();
    expect(press({ key: 'Tab', code: 'Tab' })).toBe(false);
  });

  it('takes Escape, leaves capture, and changes nothing', async () => {
    const { fake } = await openStored({ hotkey: 'p' });

    hotkeyField().focus();
    expect(document.activeElement).toBe(hotkeyField());

    expect(press({ key: 'Escape', code: 'Escape' })).toBe(true);
    await settle();

    // Without the blur the field keeps the focus ring and goes on eating keys after the user
    // has said "no".
    expect(document.activeElement).not.toBe(hotkeyField());
    expect(fake.storage.local.setCalls).toEqual([]);
    expect(hotkeyStatus().textContent).not.toBe(HOTKEY_MESSAGES.unusable);
  });

  it('leaves ⌘R, ⌃R and ⌥ combinations to Safari instead of swallowing them', async () => {
    // Cancelling a reload with the settings field focused is the kind of thing that makes a
    // settings page feel broken.
    await openStored({ hotkey: 'p' });

    expect(press({ key: 'r', code: 'KeyR', metaKey: true })).toBe(false);
    expect(press({ key: 'r', code: 'KeyR', ctrlKey: true })).toBe(false);
    expect(press({ key: 'π', code: 'KeyP', altKey: true })).toBe(false);
    expect(press({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })).toBe(false);
    await settle();
  });

  it('still cancels the keys whose default action would fight the capture', async () => {
    // The other half of the ordering above: Space scrolls and Backspace can navigate back,
    // so `preventDefault` has to survive for both.
    await openStored({ hotkey: 'p' });

    expect(press({ key: ' ', code: 'Space' })).toBe(true);
    expect(press({ key: 'Backspace', code: 'Backspace' })).toBe(true);
    expect(press({ key: 'm', code: 'KeyM' })).toBe(true);
    await settle();
  });
});

describe('Hotkey — off, and back on', () => {
  it('turns the hotkey off through a deliberate control, not by clearing the field', async () => {
    // RRR §3 gives `''` the meaning "disabled", and it is offered rather than being whatever
    // a cleared field happens to produce — the field cannot be cleared.
    const { fake } = await openPage();

    click(hotkeyDisable());
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: '' });
    expect(hotkeyField().value).toBe('');
    expect(hotkeyStatus().textContent).toBe(HOTKEY_MESSAGES.disabled);
    expect(fake.storage.local.setCalls).toHaveLength(1);
  });

  it('leaves the placeholder to say “Off”, so an empty field does not read as broken', () => {
    renderShippedMarkup();
    expect(hotkeyField().placeholder).toMatch(/off/i);
  });

  it('resets to the RRR §3 default from a disabled state', async () => {
    await openStored({ hotkey: '' });
    expect(hotkeyField().value).toBe('');

    click(hotkeyReset());
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: DEFAULTS.hotkey });
    expect(hotkeyField().value).toBe(DEFAULTS.hotkey.toUpperCase());
    expect(hotkeyStatus().textContent).toBe(HOTKEY_MESSAGES.saved);
  });

  it('resets to the default from some other key', async () => {
    await openStored({ hotkey: 'q' });

    click(hotkeyReset());
    await settle();

    await expect(stored()).resolves.toMatchObject({ hotkey: DEFAULTS.hotkey });
  });
});

/* ------------------------------------------------------------------------- *
 * 3. Toggles (RRR §4.3.3)
 * ------------------------------------------------------------------------- */

describe('Toggles', () => {
  it('reflects what is stored rather than the markup’s defaults', async () => {
    await openStored({
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: false,
      youtubeButton: false,
    });

    expect(autoPipToggle().checked).toBe(true);
    expect(autoRestoreToggle().checked).toBe(false);
    expect(youtubeToggle().checked).toBe(false);
  });

  it('round-trips autoPipOnTabHide, which is off by default', async () => {
    await openPage();
    expect(autoPipToggle().checked).toBe(false);

    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toMatchObject({ autoPipOnTabHide: true });

    autoPipToggle().checked = false;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toMatchObject({ autoPipOnTabHide: false });
  });

  it('round-trips autoRestoreOnTabReturn, which is on by default', async () => {
    // Stored with the parent on, because that is the only state in which this control is
    // enabled — see the two tests below.
    await openStored({ autoPipOnTabHide: true });
    expect(autoRestoreToggle().checked).toBe(true);

    autoRestoreToggle().checked = false;
    autoRestoreToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toMatchObject({ autoRestoreOnTabReturn: false });

    autoRestoreToggle().checked = true;
    autoRestoreToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toMatchObject({ autoRestoreOnTabReturn: true });
  });

  it('enables and disables the return toggle as its parent is switched', async () => {
    await openPage();

    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(autoRestoreToggle().disabled).toBe(false);

    autoPipToggle().checked = false;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(autoRestoreToggle().disabled).toBe(true);
    // And the stored value survived the round trip untouched.
    await expect(stored()).resolves.toMatchObject({ autoRestoreOnTabReturn: true });
  });

  it('follows another context’s change of the parent, not only its own click', async () => {
    const { fake } = await openStored({ autoPipOnTabHide: true });
    expect(autoRestoreToggle().disabled).toBe(false);

    fake.storage.onChanged.emit({
      [SETTINGS_KEY]: { newValue: { autoPipOnTabHide: false } },
    });
    await settle();

    expect(autoRestoreToggle().disabled).toBe(true);
  });

  it('leaves autoRestoreOnTabReturn stored when its parent toggle goes off', async () => {
    // The two are one feature to the user and two answers here: clearing this behind their
    // back would lose it every time they turned auto-PiP off for an afternoon. Nothing is ever
    // remembered while the parent is off, so the stored `true` is inert until it means
    // something again — and the control is greyed out rather than rewritten.
    await openStored({ autoPipOnTabHide: true, autoRestoreOnTabReturn: true });

    autoPipToggle().checked = false;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toMatchObject({
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
    });
  });

  it('round-trips youtubeButton, which is on by default', async () => {
    await openPage();
    expect(youtubeToggle().checked).toBe(true);

    youtubeToggle().checked = false;
    youtubeToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toMatchObject({ youtubeButton: false });

    youtubeToggle().checked = true;
    youtubeToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toMatchObject({ youtubeButton: true });
  });

  it('writes only the field that changed, so the others are never overwritten', async () => {
    const { fake } = await openStored({ hotkey: 'q', youtubeButton: false });

    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    await expect(stored()).resolves.toEqual({
      hotkey: 'q',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
    });
    expect(fake.storage.local.setCalls).toHaveLength(1);
  });

  it('carries an unknown field from a future version through a write untouched', async () => {
    const { fake } = await openStored({ hotkey: 'q', futureFeature: 'on' });

    youtubeToggle().checked = false;
    youtubeToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toMatchObject({ futureFeature: 'on' });
  });
});

/* ------------------------------------------------------------------------- *
 * A write that fails
 * ------------------------------------------------------------------------- */

describe('when saveSettings rejects', () => {
  it('says so and puts the toggle back, rather than showing a state nothing stored', async () => {
    const { fake } = await openPage();
    fake.storage.local.setFailure = new Error('QuotaExceededError');

    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(saveError().hidden).toBe(false);
    expect(saveError().textContent).toBe(SAVE_ERROR_MESSAGE);
    // The write failed, so the stored value is still `false`; a checkbox left ticked would be
    // the page lying about the extension's behaviour.
    expect(autoPipToggle().checked).toBe(false);
  });

  it('puts the hotkey field back to the key that is actually stored', async () => {
    const { fake } = await openStored({ hotkey: 'q' });
    fake.storage.local.setFailure = new Error('QuotaExceededError');

    press({ key: 'm', code: 'KeyM' });
    await settle();

    expect(saveError().hidden).toBe(false);
    expect(hotkeyField().value).toBe('Q');
  });

  it('clears the message once a write succeeds again', async () => {
    const { fake } = await openPage();
    fake.storage.local.setFailure = new Error('QuotaExceededError');

    click(hotkeyDisable());
    await settle();
    expect(saveError().hidden).toBe(false);

    fake.storage.local.setFailure = null;
    click(hotkeyDisable());
    await settle();

    expect(saveError().hidden).toBe(true);
    await expect(stored()).resolves.toMatchObject({ hotkey: '' });
  });

  it('is hidden and empty until something actually fails', async () => {
    await openPage();
    expect(saveError().hidden).toBe(true);
    expect(saveError().textContent).toBe('');
  });
});

/* ------------------------------------------------------------------------- *
 * The BF04 session, reproduced
 * ------------------------------------------------------------------------- */

/**
 * BF04: the page loaded looking perfectly healthy — hotkey field `P`, both toggles at their
 * defaults — and every change answered "Safari could not save that."
 *
 * The cause was `manifest.json` not declaring `"storage"`, so Safari never created
 * `browser.storage`. `loadSettings` resolves to the defaults in that case by design
 * (DECISIONS 39), which is why the page looked fine and the write was the only symptom.
 *
 * `test/manifest.test.ts` stops that manifest shipping again. These two are about what the
 * page says when it happens anyway — a broken build, a future Safari retiring the
 * permission — and the answer must not send the reader looking at their disk.
 */
describe('when the storage API is absent altogether', () => {
  /** A `browser` with `permissions` but no `storage`: the shape Safari builds without it. */
  function openWithoutStorage(): OptionsPage {
    installPartialBrowser({
      permissions: {
        contains: () => Promise.resolve(true),
        getAll: () => Promise.resolve({ origins: [ALL_SITES] }),
        onAdded: { addListener: () => {}, removeListener: () => {} },
        onRemoved: { addListener: () => {}, removeListener: () => {} },
      },
    });
    renderShippedMarkup();
    page = initOptionsPage();
    return page;
  }

  it('loads without complaining, which is the whole reason this was puzzling', async () => {
    await openWithoutStorage().ready;

    expect(hotkeyField().value).toBe(DEFAULTS.hotkey.toUpperCase());
    expect(saveError().hidden).toBe(true);
  });

  it('blames the extension, not the moment, when a write then fails', async () => {
    await openWithoutStorage().ready;

    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(saveError().hidden).toBe(false);
    expect(saveError().textContent).toBe(STORAGE_UNAVAILABLE_MESSAGE);
    // Not the sentence for a write that failed — that one says the settings are unchanged,
    // which is true but sends the reader hunting for a full disk.
    expect(saveError().textContent).not.toBe(SAVE_ERROR_MESSAGE);
    expect(autoPipToggle().checked).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * Following a change made elsewhere
 * ------------------------------------------------------------------------- */

describe('a settings change made in another context', () => {
  it('reaches the page through storage.onChanged', async () => {
    // Driven explicitly rather than by awaiting a write (DECISIONS 51).
    const { fake } = await openPage();

    fake.storage.onChanged.emit({
      [SETTINGS_KEY]: { newValue: { hotkey: 'z', autoPipOnTabHide: true, youtubeButton: false } },
    });

    expect(hotkeyField().value).toBe('Z');
    expect(autoPipToggle().checked).toBe(true);
    expect(youtubeToggle().checked).toBe(false);
  });

  it('subscribes once, and unsubscribes on destroy', async () => {
    const { fake, page: opened } = await openPage();
    expect(fake.storage.onChanged.listenerCount).toBe(1);

    opened.destroy();
    expect(fake.storage.onChanged.listenerCount).toBe(0);

    fake.storage.onChanged.emit({ [SETTINGS_KEY]: { newValue: { hotkey: 'z' } } });
    expect(hotkeyField().value).toBe(DEFAULTS.hotkey.toUpperCase());
  });
});

/* ------------------------------------------------------------------------- *
 * Hygiene
 * ------------------------------------------------------------------------- */

describe('what the options page must never do', () => {
  it('touches no forbidden API and never reads storage.sync', async () => {
    const { fake } = await openPage();

    click(hotkeyReset());
    press({ key: 'm', code: 'KeyM' });
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(fake.forbiddenApiCalls).toEqual([]);
    expect(fake.syncTripwire.accesses).toBe(0);
  });

  it('never messages a tab — it configures the extension, it does not drive a page', async () => {
    const { fake } = await openPage();

    click(hotkeyReset());
    await settle();

    expect(fake.tabs.sentMessages).toEqual([]);
    expect(fake.scripting.executeScriptCalls).toEqual([]);
  });

  it('paints nothing after destroy, even from work that was already in flight', async () => {
    // The honest half of "inert": a write cannot be unsent, so one in flight still lands in
    // storage — but a permission read landing afterwards must not repaint a DOM the page has
    // let go of.
    const { fake, page: opened } = await openPage();
    const stateBefore = accessState().textContent;
    const statusBefore = hotkeyStatus().textContent;
    expect(stateBefore).toBe(ACCESS_MESSAGES.none);
    expect(statusBefore).toBe(HOTKEY_MESSAGES.idle);

    // Three things now in flight: two writes and a permission read.
    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    press({ key: 'm', code: 'KeyM' });
    fake.permissions.grant([ALL_SITES]);

    opened.destroy();
    await settle();

    // The writes cannot be unsent and do land…
    await expect(stored()).resolves.toMatchObject({ autoPipOnTabHide: true, hotkey: 'm' });

    // …but nothing they resolved with, and nothing the read answered, reaches the DOM.
    expect(accessState().textContent).toBe(stateBefore);
    expect(hotkeyStatus().textContent).toBe(statusBefore);
    expect(hotkeyField().value).toBe(DEFAULTS.hotkey.toUpperCase());
  });

  it('does not paint the initial settings read if destroy beats it', async () => {
    // The startup path, the easiest of the three to leave unguarded: the only one that is not
    // a reaction to something the user did.
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'z' } } });

    const realGet = fake.storage.local.get.bind(fake.storage.local);
    let release = (): void => {};
    fake.storage.local.get = async (keys?: string | string[] | null) => {
      await new Promise<void>((resolve_) => {
        release = resolve_;
      });
      return realGet(keys);
    };

    renderShippedMarkup();
    page = initOptionsPage();

    // Still the markup's own text: nothing has been read yet. Compared against these rather
    // than against the message constants because the markup carries the same words with the
    // file's indentation, so an unguarded render shows up even where the wording matches.
    const valueBefore = hotkeyField().value;
    const statusBefore = hotkeyStatus().textContent;

    page.destroy();
    release();
    await page.ready;
    await settle();

    expect(hotkeyField().value).toBe(valueBefore);
    expect(hotkeyStatus().textContent).toBe(statusBefore);
  });

  it('raises no save error after destroy, when the failing write was already in flight', async () => {
    // A rejection arriving after the page is gone would put a red box on a DOM nobody owns.
    const { fake, page: opened } = await openPage();
    fake.storage.local.setFailure = new Error('QuotaExceededError');

    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));

    opened.destroy();
    await settle();

    expect(saveError().hidden).toBe(true);
    expect(saveError().textContent).toBe('');
  });

  it('starts nothing new after destroy, so a stale page cannot keep writing', async () => {
    const { fake, page: opened } = await openPage();
    opened.destroy();

    click(hotkeyReset());
    click(hotkeyDisable());
    press({ key: 'm', code: 'KeyM' });
    autoPipToggle().checked = true;
    autoPipToggle().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(fake.storage.local.setCalls).toEqual([]);
  });

  it('has an idempotent destroy that detaches once, not once per call', async () => {
    const { fake, page: opened } = await openPage();

    opened.destroy();
    expect(() => {
      opened.destroy();
    }).not.toThrow();

    // Not just "does not throw": the guard is what keeps a second call from re-running the
    // teardown, which is only harmless while everything it touches is idempotent too.
    expect(fake.storage.onChanged.removeListenerCalls).toHaveLength(1);
    expect(fake.permissions.onAdded.removeListenerCalls).toHaveLength(1);
  });

  it('has a ready promise that never rejects, whatever storage does', async () => {
    const fake = installFakeBrowser();
    fake.storage.local.getFailure = new Error('storage is unavailable');
    fake.permissions.getAllFailure = new Error('no');
    fake.permissions.containsFailure = new Error('no');

    renderShippedMarkup();
    page = initOptionsPage();

    await expect(page.ready).resolves.toBeUndefined();
  });
});

describe('the exported copy', () => {
  it('has a distinct message for every state, so none can be confused for another', () => {
    const messages = [
      ...Object.values(ACCESS_MESSAGES),
      ...Object.values(HOTKEY_MESSAGES),
      SAVE_ERROR_MESSAGE,
      STORAGE_UNAVAILABLE_MESSAGE,
    ];

    expect(messages.every((message) => message.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(messages.length);
  });
});
