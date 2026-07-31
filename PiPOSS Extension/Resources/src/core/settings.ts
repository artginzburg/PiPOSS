/**
 * The settings model of RRR §3: one object in `browser.storage.local` under the key `settings`.
 *
 * Four rules govern everything here, and each is load-bearing:
 *
 * 1. **`local` only, forever.** Safari's `storage.sync` does not sync — it is an alias for
 *    `local`, and Safari 15/15.1 wrote sync items into `local`, so a migration between the two
 *    would read and rewrite the same store. `sync` is not declared in `src/browser.d.ts`, so
 *    "improving" this into `sync` does not typecheck.
 * 2. **Merge, never replace.** Missing or half-written settings resolve field by field to
 *    {@link DEFAULTS}; a write merges into what is already stored.
 * 3. **Unknown fields survive.** A settings object written by a future version must come back out
 *    of a read-modify-write cycle intact, so {@link saveSettings} rewrites the whole stored object
 *    with unknown keys carried through, and refuses to write at all if it could not read them first.
 * 4. **One write at a time.** That read-modify-write is not atomic in the storage API, so writes go
 *    through a queue. Without it two overlapping writes each read the same "before" state and the
 *    second silently reverts the first — exactly what two options-page handlers firing together do.
 *
 * Nothing here throws on bad data. The content script imports this on every page, so a corrupt
 * value or an unavailable storage API must degrade to the defaults rather than take the content
 * script down (RRR §4.1: silence is the correct response).
 */

export interface Settings {
  /** Single printable key that toggles PiP, lowercase. The empty string disables the hotkey. */
  hotkey: string;
  /** Enter PiP when the tab stops being visible while a video plays. */
  autoPipOnTabHide: boolean;
  /**
   * Put a video that *this* extension floated on tab hide back where it came from when the tab
   * becomes visible again. Meaningless on its own: nothing is ever remembered while
   * {@link autoPipOnTabHide} is off, so this only ever undoes an entry we performed — which is
   * why it defaults to `true` while its parent defaults to `false`. A default that can do
   * nothing until the user switches something else on is a *shape*, not a behaviour: it says
   * what auto-PiP means for anyone who turns it on without reading further.
   */
  autoRestoreOnTabReturn: boolean;
  /** Show the PiP button in the YouTube player controls. */
  youtubeButton: boolean;
}

/** The single key the whole settings object lives under. */
export const SETTINGS_KEY = 'settings';

/** RRR §3, verbatim. Frozen: it is shared with every caller. */
export const DEFAULTS: Readonly<Settings> = Object.freeze({
  hotkey: 'p',
  autoPipOnTabHide: false,
  autoRestoreOnTabReturn: true,
  youtubeButton: true,
});

/** Detaches a listener registered with {@link onSettingsChanged}. Idempotent. */
export type Unsubscribe = () => void;

/**
 * There is no `browser.storage.local` to write to *at all* — as opposed to a write that reached
 * the store and failed. Its own type because only the first of those is a bug rather than a
 * moment: Safari builds the `browser` object property by property and omits `storage` entirely
 * unless `manifest.json` declares the `storage` permission, so this is the shape a manifest
 * mistake takes at runtime — not an exception from a call, but the call site finding nothing to
 * call. It cost a real debugging session (BF04).
 *
 * {@link loadSettings} still never rejects, with this or anything else. Only the write path,
 * whose caller is always a user gesture with somewhere to put the answer, tells anyone.
 */
export class StorageUnavailableError extends Error {
  constructor() {
    super('PiPOSS: browser.storage.local is unavailable');
    this.name = 'StorageUnavailableError';
  }
}

/**
 * The stored object merged over the defaults. Never rejects: a rejecting storage API, a missing
 * `browser` global and a corrupt stored value all resolve to the defaults.
 */
export async function loadSettings(): Promise<Settings> {
  const area = storageArea();
  if (!area) return mergeOverDefaults({});

  try {
    return mergeOverDefaults(await readStored(area));
  } catch {
    // A read we cannot make is indistinguishable from a read that found nothing.
    return mergeOverDefaults({});
  }
}

/** What {@link followSettings} hands back. */
export interface SettingsFollower {
  /**
   * Resolves once the stored settings have been applied, or found absent. Never rejects, because
   * {@link loadSettings} never does. Production drops it; it exists so a test has a barrier that does
   * not depend on how many microtasks a storage read happens to take.
   */
  readonly ready: Promise<void>;

  /** Detaches the subscription. Idempotent. */
  unsubscribe: Unsubscribe;
}

/**
 * Apply the stored settings once they arrive, then on every later change (RRR §3: no page reload).
 * The shared half of the hotkey, auto-PiP and YouTube-button bindings.
 *
 * **The ordering is why this is one function rather than three copies.** The subscription is
 * registered *before* the read is issued, so a change landing while the read is in flight is not
 * lost; and the read is discarded if a change has already been applied, since it carries the value
 * from *before* that change (DECISIONS 85). Without that, turning a setting on from the options page
 * could be reverted a moment later by a read that started before it. What each caller does *until*
 * the first `apply` — bind on the default, or nothing at all — is its own decision; see each.
 */
export function followSettings(apply: (settings: Settings) => void): SettingsFollower {
  let appliedFromChange = false;

  const unsubscribe = onSettingsChanged((settings) => {
    appliedFromChange = true;
    apply(settings);
  });

  const ready = loadSettings().then((settings) => {
    if (appliedFromChange) return;
    apply(settings);
  });

  return { ready, unsubscribe };
}

/**
 * The tail of the write queue: every write chains onto it, so no two read-modify-write cycles
 * interleave and a later write always reads the previous one's result.
 *
 * Per context, which is all the serialisation available: the options page and a content script
 * are separate realms and the storage API has no transaction. It is the overlap *within* one
 * context — two handlers on one page — that actually loses updates.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Merges a partial update into what is stored and returns the settings now in effect. Keys whose value
 * is `undefined` are left alone. Writes are serialised (rule 4).
 *
 * Unlike {@link loadSettings} this **does** reject if storage fails, including when the *read* half
 * fails: writing after a failed read would silently discard unknown fields a future version had put
 * there, and losing a user's change is better than corrupting their settings. Callers are always UI
 * code acting on a user gesture, so a rejection has somewhere to go — and it belongs to its own caller
 * only: the queue keeps running, because one failed write must not wedge every later write. The reason
 * is a {@link StorageUnavailableError} when there was no storage API at all, and whatever the API
 * rejected with otherwise; callers reporting to a human should tell those apart.
 */
export function saveSettings(update: Partial<Settings>): Promise<Settings> {
  const settled = writeQueue.then(() => writeSettings(update));

  // The tail swallows the failure it has already handed to `settled`'s caller; without this the
  // next write inherits the rejection and never runs.
  writeQueue = settled.catch(() => undefined);

  return settled;
}

async function writeSettings(update: Partial<Settings>): Promise<Settings> {
  const area = storageArea();
  if (!area) throw new StorageUnavailableError();

  const stored = await readStored(area);
  const merged = { ...stored, ...definedOnly(update) };

  // Everything that was there, then the known fields in canonical form — so a future version's
  // unknown fields survive and a wrong-typed known value is repaired on the way past.
  const next: BrowserStorageItems = { ...merged, ...mergeOverDefaults(merged) };

  await area.set({ [SETTINGS_KEY]: next });

  return mergeOverDefaults(next);
}

/**
 * Calls `callback` with the new settings whenever they change in any context. The area name is
 * deliberately not filtered on: in Safari `sync` is an alias for `local`, which makes the name an
 * untrustworthy discriminator, while the key is exactly what identifies the change as ours.
 */
export function onSettingsChanged(callback: (settings: Settings) => void): Unsubscribe {
  const event = storageOnChanged();
  if (!event) return () => {};

  const listener: BrowserStorageChangeListener = (changes) => {
    if (!isRecord(changes)) return;

    const change = changes[SETTINGS_KEY];
    if (!isRecord(change)) return;

    callback(mergeOverDefaults(asStoredObject(change.newValue)));
  };

  event.addListener(listener);

  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    event.removeListener(listener);
  };
}

/**
 * `browser.storage.local`, or `null` outside an extension context. Resolved per call rather than
 * at module load: the content script imports this module in frames where the API may be absent,
 * and the tests install their fake after the import.
 */
function storageArea(): BrowserStorageArea | null {
  if (typeof browser === 'undefined') return null;
  return browser?.storage?.local ?? null;
}

function storageOnChanged(): BrowserStorageOnChanged | null {
  if (typeof browser === 'undefined') return null;
  return browser?.storage?.onChanged ?? null;
}

/** The stored settings object, or `{}` when absent or not an object. */
async function readStored(area: BrowserStorageArea): Promise<BrowserStorageItems> {
  const items = await area.get(SETTINGS_KEY);
  return asStoredObject(isRecord(items) ? items[SETTINGS_KEY] : undefined);
}

function asStoredObject(value: unknown): BrowserStorageItems {
  return isRecord(value) ? value : {};
}

/**
 * The known fields of a raw stored object, each falling back to its default when missing *or of
 * the wrong type*. Per field, never wholesale: one corrupt value must not cost the user their
 * other settings.
 */
function mergeOverDefaults(raw: BrowserStorageItems): Settings {
  return {
    hotkey: typeof raw.hotkey === 'string' ? raw.hotkey.toLowerCase() : DEFAULTS.hotkey,
    autoPipOnTabHide: asBoolean(raw.autoPipOnTabHide, DEFAULTS.autoPipOnTabHide),
    autoRestoreOnTabReturn: asBoolean(raw.autoRestoreOnTabReturn, DEFAULTS.autoRestoreOnTabReturn),
    youtubeButton: asBoolean(raw.youtubeButton, DEFAULTS.youtubeButton),
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Drops `undefined` values, so `{ hotkey: undefined }` means "leave it alone". */
function definedOnly(update: Partial<Settings>): BrowserStorageItems {
  const defined: BrowserStorageItems = {};
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) defined[key] = value;
  }
  return defined;
}

function isRecord(value: unknown): value is BrowserStorageItems {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
