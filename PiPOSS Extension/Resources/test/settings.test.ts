import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULTS,
  SETTINGS_KEY,
  StorageUnavailableError,
  loadSettings,
  onSettingsChanged,
  saveSettings,
} from '../src/core/settings';
import {
  type FakeBrowser,
  installFakeBrowser,
  installPartialBrowser,
  uninstallFakeBrowser,
} from './helpers/fake-browser';

/** Installs the fake with `settings` already holding `stored`. */
function withStored(stored: unknown): FakeBrowser {
  return installFakeBrowser({ items: { [SETTINGS_KEY]: stored } });
}

afterEach(() => {
  uninstallFakeBrowser();
});

describe('DEFAULTS', () => {
  it('is exactly the table in RRR §3', () => {
    expect(DEFAULTS).toEqual({
      hotkey: 'p',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });
  });

  it('is frozen, so no consumer can mutate the fallback everyone else reads', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });

  it('is never handed out by reference, storage or no storage', async () => {
    // Both branches, because they build the result differently: with storage the merge
    // always allocates, without it the shortest correct-looking implementation is
    // `return DEFAULTS`, which hands every caller the frozen shared object.
    installFakeBrowser();
    const fromStorage = await loadSettings();

    uninstallFakeBrowser();
    const withoutStorage = await loadSettings();

    for (const loaded of [fromStorage, withoutStorage]) {
      expect(loaded).not.toBe(DEFAULTS);
      expect(Object.isFrozen(loaded)).toBe(false);
      loaded.hotkey = 'z';
    }

    expect(DEFAULTS.hotkey).toBe('p');
  });
});

describe('loadSettings', () => {
  it('returns the defaults when nothing has ever been stored', async () => {
    installFakeBrowser();
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });

  it('merges a partially written object over the defaults instead of replacing them', async () => {
    withStored({ hotkey: 'k' });
    await expect(loadSettings()).resolves.toEqual({
      hotkey: 'k',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });
  });

  it('returns a fully written object unchanged', async () => {
    withStored({
      hotkey: 'q',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
    });
    await expect(loadSettings()).resolves.toEqual({
      hotkey: 'q',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
    });
  });

  it('keeps an empty hotkey, which is how the user disables it (RRR §3)', async () => {
    withStored({ hotkey: '' });
    await expect(loadSettings()).resolves.toMatchObject({ hotkey: '' });
  });

  it('keeps a stored autoRestoreOnTabReturn, and repairs a non-boolean to RRR §3’s true', async () => {
    withStored({ autoRestoreOnTabReturn: false });
    await expect(loadSettings()).resolves.toMatchObject({ autoRestoreOnTabReturn: false });

    // Not merely tidiness: a stored string is not an answer, and the field decides whether the
    // user's floating window is taken away for them. Repaired to the default, in the one
    // direction RRR §3 names.
    withStored({ autoRestoreOnTabReturn: 'no' });
    await expect(loadSettings()).resolves.toMatchObject({ autoRestoreOnTabReturn: true });
  });

  it('keeps a false youtubeButton rather than falling back to the true default', async () => {
    withStored({ youtubeButton: false });
    await expect(loadSettings()).resolves.toMatchObject({ youtubeButton: false });
  });

  it('lowercases the hotkey, because RRR §3 says it is stored lowercase', async () => {
    withStored({ hotkey: 'K' });
    await expect(loadSettings()).resolves.toMatchObject({ hotkey: 'k' });
  });

  it('reads only browser.storage.local, and only the settings key', async () => {
    const fake = withStored({ hotkey: 'k' });
    await loadSettings();
    expect(fake.storage.local.getCalls).toEqual([SETTINGS_KEY]);
  });

  it('never returns unknown fields from a future version as settings', async () => {
    withStored({ hotkey: 'k', futureFeature: 'on' });
    await expect(loadSettings()).resolves.toEqual({
      hotkey: 'k',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });
  });

  describe('a stored value of the wrong type falls back per field, never throws', () => {
    it('replaces a non-string hotkey with the default', async () => {
      withStored({ hotkey: 42 });
      await expect(loadSettings()).resolves.toMatchObject({ hotkey: 'p' });
    });

    it('replaces a string youtubeButton with the default', async () => {
      withStored({ youtubeButton: 'yes' });
      await expect(loadSettings()).resolves.toMatchObject({ youtubeButton: true });
    });

    it('replaces a numeric autoPipOnTabHide with the default', async () => {
      withStored({ autoPipOnTabHide: 1 });
      await expect(loadSettings()).resolves.toMatchObject({ autoPipOnTabHide: false });
    });

    it('keeps the healthy siblings of a corrupt field', async () => {
      withStored({
        hotkey: null,
        autoPipOnTabHide: true,
        autoRestoreOnTabReturn: true,
        youtubeButton: false,
      });
      await expect(loadSettings()).resolves.toEqual({
        hotkey: 'p',
        autoPipOnTabHide: true,
        autoRestoreOnTabReturn: true,
        youtubeButton: false,
      });
    });

    it('falls back wholesale when the stored value is not an object at all', async () => {
      withStored('corrupt');
      await expect(loadSettings()).resolves.toEqual(DEFAULTS);
    });

    it('falls back wholesale when the stored value is null', async () => {
      withStored(null);
      await expect(loadSettings()).resolves.toEqual(DEFAULTS);
    });
  });

  it('resolves to the defaults when the storage API rejects', async () => {
    const fake = installFakeBrowser();
    fake.storage.local.getFailure = new Error('storage unavailable');
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });

  it('resolves to the defaults when there is no browser global at all', async () => {
    uninstallFakeBrowser();
    await expect(loadSettings()).resolves.toEqual(DEFAULTS);
  });
});

/**
 * A `browser` global that exists but is not fully built turns a read into a rejection if
 * any hop is dereferenced unguarded, and an unhandled rejection at content-script init is
 * the "extension installed, does nothing" failure (DECISIONS 39). Each shape below is a
 * real one: an API namespace not yet populated in a subframe.
 */
describe('a partial browser global', () => {
  const shapes: Array<[string, unknown]> = [
    ['browser = {}', {}],
    ['browser.storage = {}', { storage: {} }],
    ['browser.storage.local = {}, with no get', { storage: { local: {} } }],
  ];

  for (const [shape, value] of shapes) {
    describe(shape, () => {
      it('still resolves loadSettings to the defaults', async () => {
        installPartialBrowser(value);
        await expect(loadSettings()).resolves.toEqual(DEFAULTS);
      });

      it('rejects saveSettings rather than throwing synchronously', async () => {
        installPartialBrowser(value);
        await expect(saveSettings({ hotkey: 'k' })).rejects.toThrow();
      });

      it('returns a working no-op unsubscribe from onSettingsChanged', () => {
        installPartialBrowser(value);
        const unsubscribe = onSettingsChanged(vi.fn());
        expect(() => unsubscribe()).not.toThrow();
      });
    });
  }
});

describe('saveSettings', () => {
  it('writes one object under the settings key of local storage', async () => {
    const fake = installFakeBrowser();

    await saveSettings({ hotkey: 'k' });

    expect(fake.storage.local.setCalls).toEqual([
      {
        [SETTINGS_KEY]: {
          hotkey: 'k',
          autoPipOnTabHide: false,
          autoRestoreOnTabReturn: true,
          youtubeButton: true,
        },
      },
    ]);
  });

  it('merges the partial into what is stored instead of replacing it', async () => {
    const fake = withStored({ hotkey: 'k', autoPipOnTabHide: true });

    await saveSettings({ youtubeButton: false });

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'k',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
    });
  });

  it('returns the settings now in effect', async () => {
    withStored({ autoPipOnTabHide: true });
    await expect(saveSettings({ hotkey: 'k' })).resolves.toEqual({
      hotkey: 'k',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });
  });

  it('preserves unknown fields from a future version across read-modify-write', async () => {
    const fake = withStored({
      hotkey: 'k',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
      futureFeature: 'on',
      futureObject: { nested: [1, 2, 3] },
    });

    await saveSettings({ hotkey: 'm' });

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'm',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
      futureFeature: 'on',
      futureObject: { nested: [1, 2, 3] },
    });
  });

  it('preserves unknown fields through repeated writes', async () => {
    const fake = withStored({ futureFeature: 'on' });

    await saveSettings({ hotkey: 'k' });
    await saveSettings({ youtubeButton: false });
    await saveSettings({ autoPipOnTabHide: true });

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'k',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
      futureFeature: 'on',
    });
  });

  it('lowercases a hotkey on the way in, so storage stays canonical', async () => {
    const fake = installFakeBrowser();
    await saveSettings({ hotkey: 'K' });
    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toMatchObject({ hotkey: 'k' });
  });

  it('repairs a wrong-typed stored value while writing an unrelated field', async () => {
    const fake = withStored({ hotkey: 42, youtubeButton: 'yes' });

    await saveSettings({ autoPipOnTabHide: true });

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'p',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });
  });

  it('replaces an array-stored value with an object, never spreading its indexes', async () => {
    const fake = withStored(['p', 'q']);

    await expect(saveSettings({ hotkey: 'm' })).resolves.toEqual({
      hotkey: 'm',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });

    const stored = fake.storage.local.snapshot()[SETTINGS_KEY];
    expect(Array.isArray(stored)).toBe(false);
    expect(stored).toEqual({
      hotkey: 'm',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });
  });

  it('treats an explicit undefined in the partial as "leave it alone"', async () => {
    const fake = withStored({ hotkey: 'k' });

    await saveSettings({ hotkey: undefined, youtubeButton: false });

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toMatchObject({
      hotkey: 'k',
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
    });
  });

  it('writes every known field even when storage was empty', async () => {
    const fake = installFakeBrowser();
    await saveSettings({});
    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual(DEFAULTS);
  });

  it('never touches storage.sync, not even by reading the property (RRR §3)', async () => {
    const fake = withStored({ hotkey: 'k' });

    await loadSettings();
    await saveSettings({ hotkey: 'm' });
    onSettingsChanged(vi.fn())();
    await fake.storage.local.remove(SETTINGS_KEY);

    // The fake counts reads of `browser.storage.sync` and throws on any call, so
    // a module that so much as reached for the forbidden area fails right here.
    expect(fake.syncTripwire.accesses).toBe(0);
    expect(Object.keys(fake.storage.local.snapshot())).toEqual([]);
  });

  it('serializes concurrent writes instead of letting one lose the other', async () => {
    const fake = installFakeBrowser();

    await Promise.all([saveSettings({ hotkey: 'm' }), saveSettings({ youtubeButton: false })]);

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'm',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
    });
  });

  it('lets the later of two concurrent writes to the same field win', async () => {
    const fake = installFakeBrowser();

    await Promise.all([saveSettings({ hotkey: 'm' }), saveSettings({ hotkey: 'q' })]);

    expect(fake.storage.local.setCalls).toHaveLength(2);
    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toMatchObject({ hotkey: 'q' });
  });

  it('returns, from each concurrent write, the settings in effect after it', async () => {
    installFakeBrowser();

    const results = await Promise.all([
      saveSettings({ hotkey: 'm' }),
      saveSettings({ youtubeButton: false }),
    ]);

    expect(results[0]).toEqual({
      hotkey: 'm',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
    });
    expect(results[1]).toEqual({
      hotkey: 'm',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
    });
  });

  it('preserves unknown fields when three writes overlap', async () => {
    const fake = withStored({ futureFeature: 'on' });

    await Promise.all([
      saveSettings({ hotkey: 'm' }),
      saveSettings({ youtubeButton: false }),
      saveSettings({ autoPipOnTabHide: true }),
    ]);

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'm',
      autoPipOnTabHide: true,
      autoRestoreOnTabReturn: true,
      youtubeButton: false,
      futureFeature: 'on',
    });
  });

  it('rejects when the write fails, propagating the storage error unchanged', async () => {
    const fake = installFakeBrowser();
    const failure = new Error('QuotaExceededError');
    fake.storage.local.setFailure = failure;

    await expect(saveSettings({ hotkey: 'k' })).rejects.toBe(failure);
  });

  it('does not write at all when the read fails, so unknown fields cannot be lost', async () => {
    const fake = withStored({ hotkey: 'k', futureFeature: 'on' });
    const failure = new Error('storage unavailable');
    fake.storage.local.getFailure = failure;

    await expect(saveSettings({ hotkey: 'm' })).rejects.toBe(failure);

    expect(fake.storage.local.setCalls).toEqual([]);
    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'k',
      futureFeature: 'on',
    });
  });

  it('does not let a rejected write wedge the writes behind it', async () => {
    const fake = installFakeBrowser();
    const failure = new Error('QuotaExceededError');
    fake.storage.local.setFailure = failure;

    await expect(saveSettings({ hotkey: 'k' })).rejects.toBe(failure);

    fake.storage.local.setFailure = null;
    await expect(saveSettings({ hotkey: 'm' })).resolves.toMatchObject({ hotkey: 'm' });
    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toMatchObject({ hotkey: 'm' });
  });

  it('still aborts on a failed read once writes are queued, and recovers after', async () => {
    // A write whose read failed writes nothing, and takes none of the queued writes with
    // it (DECISIONS 38, through the serialisation queue).
    const fake = withStored({ futureFeature: 'on' });
    const failure = new Error('storage unavailable');
    fake.storage.local.getFailure = failure;

    await expect(saveSettings({ hotkey: 'm' })).rejects.toBe(failure);
    expect(fake.storage.local.setCalls).toEqual([]);

    fake.storage.local.getFailure = null;
    await saveSettings({ hotkey: 'q' });

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'q',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
      futureFeature: 'on',
    });
  });

  it('rejects when there is no browser global at all', async () => {
    uninstallFakeBrowser();
    await expect(saveSettings({ hotkey: 'k' })).rejects.toThrow(/storage/i);
  });
});

/**
 * BF04. "The storage API is not there at all" and "the write failed" are different facts,
 * and only the first means the *extension* is broken rather than the moment. The options
 * page is where a human reads that difference, so it has to survive the rejection — an
 * untyped `Error` makes the page say the same wrong sentence to both.
 */
describe('telling an absent storage API apart from a failed write', () => {
  const absent: Array<[string, unknown]> = [
    ['no browser global', undefined],
    ['browser = {}', {}],
    ['browser.storage = {}', { storage: {} }],
  ];

  for (const [shape, value] of absent) {
    it(`rejects with a StorageUnavailableError when there is ${shape}`, async () => {
      if (value === undefined) uninstallFakeBrowser();
      else installPartialBrowser(value);

      await expect(saveSettings({ hotkey: 'k' })).rejects.toBeInstanceOf(StorageUnavailableError);
    });
  }

  it('does not dress a failed write up as an unavailable API', async () => {
    // The distinction only earns its keep if it is narrow: a quota error, a serialisation
    // error and a locked store are all writes that failed against an API that exists.
    const fake = installFakeBrowser();
    fake.storage.local.setFailure = new Error('QuotaExceededError');

    await expect(saveSettings({ hotkey: 'k' })).rejects.not.toBeInstanceOf(StorageUnavailableError);
  });

  it('does not dress a failed read up as an unavailable API either', async () => {
    const fake = installFakeBrowser();
    fake.storage.local.getFailure = new Error('read failed');

    await expect(saveSettings({ hotkey: 'k' })).rejects.not.toBeInstanceOf(StorageUnavailableError);
  });

  it('is still an Error, with a message that names the API', () => {
    const error = new StorageUnavailableError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StorageUnavailableError');
    expect(error.message).toMatch(/browser\.storage\.local/);
  });
});

describe('onSettingsChanged', () => {
  it('fires with the merged settings when another context writes them', async () => {
    withStored({ autoPipOnTabHide: true });
    const seen: unknown[] = [];
    onSettingsChanged((settings) => seen.push(settings));

    await saveSettings({ hotkey: 'k' });

    expect(seen).toEqual([
      { hotkey: 'k', autoPipOnTabHide: true, autoRestoreOnTabReturn: true, youtubeButton: true },
    ]);
  });

  it('merges a partially written new value over the defaults', () => {
    const fake = installFakeBrowser();
    const seen: unknown[] = [];
    onSettingsChanged((settings) => seen.push(settings));

    fake.storage.onChanged.emit({ [SETTINGS_KEY]: { newValue: { hotkey: 'k' } } });

    expect(seen).toEqual([
      { hotkey: 'k', autoPipOnTabHide: false, autoRestoreOnTabReturn: true, youtubeButton: true },
    ]);
  });

  it('reports the defaults when the settings key is removed', async () => {
    const fake = withStored({ hotkey: 'k' });
    const seen: unknown[] = [];
    onSettingsChanged((settings) => seen.push(settings));

    await fake.storage.local.remove(SETTINGS_KEY);

    expect(seen).toEqual([DEFAULTS]);
  });

  it('ignores changes to keys that are not ours', () => {
    const fake = installFakeBrowser();
    const callback = vi.fn();
    onSettingsChanged(callback);

    fake.storage.onChanged.emit({ somethingElse: { newValue: 1 } });

    expect(callback).not.toHaveBeenCalled();
  });

  it('substitutes the defaults for a wrong-typed new value instead of throwing', () => {
    const fake = installFakeBrowser();
    const seen: unknown[] = [];
    onSettingsChanged((settings) => seen.push(settings));

    fake.storage.onChanged.emit({ [SETTINGS_KEY]: { newValue: 'corrupt' } });

    expect(seen).toEqual([DEFAULTS]);
  });

  it('does not filter on areaName', () => {
    // Safari's `sync` is an alias for `local` (RRR §3), so the area name is not a
    // trustworthy discriminator — the key is. Only our own key is ever written.
    const fake = installFakeBrowser();
    const seen: unknown[] = [];
    onSettingsChanged((settings) => seen.push(settings));

    fake.storage.onChanged.emit({ [SETTINGS_KEY]: { newValue: { hotkey: 'k' } } }, 'sync');

    expect(seen).toEqual([
      { hotkey: 'k', autoPipOnTabHide: false, autoRestoreOnTabReturn: true, youtubeButton: true },
    ]);
  });

  it('propagates every subsequent change, so no reload is needed (RRR §3)', async () => {
    installFakeBrowser();
    const seen: string[] = [];
    onSettingsChanged((settings) => seen.push(settings.hotkey));

    await saveSettings({ hotkey: 'k' });
    await saveSettings({ hotkey: 'm' });
    await saveSettings({ hotkey: '' });

    expect(seen).toEqual(['k', 'm', '']);
  });

  it('stops delivering after the returned unsubscribe is called', async () => {
    installFakeBrowser();
    const callback = vi.fn();
    const unsubscribe = onSettingsChanged(callback);

    await saveSettings({ hotkey: 'k' });
    unsubscribe();
    await saveSettings({ hotkey: 'm' });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('detaches the listener rather than just muting it', () => {
    const fake = installFakeBrowser();
    const unsubscribe = onSettingsChanged(vi.fn());
    expect(fake.storage.onChanged.listenerCount).toBe(1);

    unsubscribe();

    expect(fake.storage.onChanged.listenerCount).toBe(0);
  });

  it('unsubscribes exactly once however often it is called', async () => {
    // The `removeListener` count, not the surviving listener count: a real
    // `removeListener` ignores an unknown listener, so a missing idempotence guard is
    // invisible in the listener count and visible only here.
    const fake = installFakeBrowser();
    const first = onSettingsChanged(vi.fn());
    const second = vi.fn();
    const unsubscribeSecond = onSettingsChanged(second);

    first();
    first();
    first();

    expect(fake.storage.onChanged.removeListenerCalls).toHaveLength(1);
    expect(fake.storage.onChanged.listenerCount).toBe(1);

    // The surviving subscription is still live and still detachable.
    await saveSettings({ hotkey: 'k' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(() => unsubscribeSecond()).not.toThrow();
    expect(fake.storage.onChanged.listenerCount).toBe(0);
  });

  it('keeps independent subscribers independent', async () => {
    installFakeBrowser();
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = onSettingsChanged(a);
    onSettingsChanged(b);

    unsubscribeA();
    await saveSettings({ hotkey: 'k' });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('returns a working no-op unsubscribe when there is no browser global', () => {
    uninstallFakeBrowser();
    const unsubscribe = onSettingsChanged(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });
});

/**
 * The fake is infrastructure for three other suites, so its own guarantees are pinned
 * here: a fake laxer than a real browser lets their tests pass while the shipped
 * extension is broken. See `helpers/fake-browser.ts`'s deviations 1–4.
 */
describe('the shared browser fake', () => {
  /** `changes[SETTINGS_KEY].newValue.hotkey` out of a raw, untyped payload. */
  function payloadHotkey(changes: Record<string, BrowserStorageChange>): unknown {
    const newValue = changes[SETTINGS_KEY]?.newValue;
    return typeof newValue === 'object' && newValue !== null
      ? (newValue as { hotkey?: unknown }).hotkey
      : undefined;
  }

  it('hands listeners a payload they cannot use to corrupt the store', async () => {
    const fake = withStored({ hotkey: 'k', futureObject: { nested: [1, 2, 3] } });
    fake.storage.onChanged.addListener((changes) => {
      const newValue = changes[SETTINGS_KEY].newValue as {
        hotkey: string;
        futureObject?: unknown;
      };
      newValue.hotkey = 'corrupted';
      delete newValue.futureObject;
    });

    await saveSettings({ hotkey: 'm' });

    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toEqual({
      hotkey: 'm',
      autoPipOnTabHide: false,
      autoRestoreOnTabReturn: true,
      youtubeButton: true,
      futureObject: { nested: [1, 2, 3] },
    });
    await expect(loadSettings()).resolves.toMatchObject({ hotkey: 'm' });
  });

  it('gives every listener its own payload, so one cannot corrupt the next', async () => {
    const fake = withStored({ hotkey: 'k' });
    const seen: unknown[] = [];
    fake.storage.onChanged.addListener((changes) => {
      (changes[SETTINGS_KEY].newValue as { hotkey: string }).hotkey = 'corrupted';
      changes[SETTINGS_KEY].oldValue = 'corrupted';
    });
    fake.storage.onChanged.addListener((changes) => {
      seen.push([payloadHotkey(changes), changes[SETTINGS_KEY].oldValue]);
    });

    await saveSettings({ hotkey: 'm' });

    expect(seen).toEqual([['m', { hotkey: 'k' }]]);
  });

  it('isolates a listener that throws, so the write it came from still succeeds', async () => {
    const fake = installFakeBrowser();
    const boom = new Error('listener exploded');
    fake.storage.onChanged.addListener(() => {
      throw boom;
    });
    const seen: string[] = [];
    onSettingsChanged((settings) => seen.push(settings.hotkey));

    await expect(saveSettings({ hotkey: 'm' })).resolves.toMatchObject({ hotkey: 'm' });

    // The listener behind the throwing one still ran, and the write landed.
    expect(seen).toEqual(['m']);
    expect(fake.storage.onChanged.listenerErrors).toEqual([boom]);
    expect(fake.storage.local.snapshot()[SETTINGS_KEY]).toMatchObject({ hotkey: 'm' });
  });

  it('finishes dispatching one change before the change a listener triggers', async () => {
    const fake = installFakeBrowser();
    const order: string[] = [];
    let wrote = false;

    fake.storage.onChanged.addListener((changes) => {
      order.push(`first:${String(payloadHotkey(changes))}`);
      if (wrote) return;
      wrote = true;
      void fake.storage.local.set({ [SETTINGS_KEY]: { hotkey: 'q' } });
    });
    fake.storage.onChanged.addListener((changes) => {
      order.push(`second:${String(payloadHotkey(changes))}`);
    });

    await saveSettings({ hotkey: 'm' });

    expect(order).toEqual(['first:m', 'second:m', 'first:q', 'second:q']);
  });

  it('lets a settings listener write settings without recursing', async () => {
    installFakeBrowser();
    const seen: string[] = [];
    let nested: Promise<unknown> | null = null;
    onSettingsChanged((settings) => {
      seen.push(settings.hotkey);
      nested ??= saveSettings({ hotkey: 'q' });
    });

    await saveSettings({ hotkey: 'm' });
    await nested;

    expect(seen).toEqual(['m', 'q']);
  });

  it('counts and forbids every access to storage.sync (RRR §3 tripwire)', () => {
    const fake = installFakeBrowser();
    expect(fake.syncTripwire.accesses).toBe(0);

    const sync = fake.storage.sync;

    expect(fake.syncTripwire.accesses).toBe(1);
    expect(() => void sync.get()).toThrow(/sync is forbidden/i);
  });
});
