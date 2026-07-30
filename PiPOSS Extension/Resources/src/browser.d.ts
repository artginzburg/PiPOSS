/**
 * Hand-written typings for the slice of the WebExtension API PiPOSS actually uses. Nothing more is
 * declared: an API that is not in this file cannot be called by accident, which is how RRR §3's
 * "never `sync`" rule is enforced at the type level. Later tasks extend this by re-declaring
 * `interface Browser` (interfaces merge).
 *
 * @see https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/storage
 */

type BrowserStorageItems = Record<string, unknown>;

interface BrowserStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

type BrowserStorageChangeListener = (
  changes: Record<string, BrowserStorageChange>,
  areaName: string,
) => void;

interface BrowserStorageArea {
  get(keys?: string | string[] | null): Promise<BrowserStorageItems>;
  set(items: BrowserStorageItems): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface BrowserStorageOnChanged {
  addListener(listener: BrowserStorageChangeListener): void;
  removeListener(listener: BrowserStorageChangeListener): void;
}

interface BrowserStorage {
  /**
   * The only storage area this extension may use. **Do not add `sync`**: in Safari it is an alias
   * for `local`, so a migration between the two would read and rewrite the same store (RRR §3).
   */
  local: BrowserStorageArea;

  onChanged: BrowserStorageOnChanged;
}

interface Browser {
  storage: BrowserStorage;
}

/* ------------------------------------------------------------------------- *
 * T03 — the toolbar button and the registered command. Deliberately absent, and each absence is
 * load-bearing:
 *
 * - `action.setBadgeText` / `setTitle`, and `notifications` — RRR §4.1 says that with no eligible
 *   video *nothing* is shown, so "show an error badge instead" cannot be written by accident.
 * - `tabs.query` — the clicked tab arrives as the `onClicked` argument under `activeTab`; querying
 *   for the active tab would work only with all-sites access.
 * - `commands.update` / `commands.onChanged` — unsupported in Safari, so no code can read or set
 *   the user's chosen shortcut (RRR §4.2, §12).
 * ------------------------------------------------------------------------- */

/** Only the fields PiPOSS reads off a tab. */
interface BrowserTab {
  /** Absent for a tab that is not fully realised; a message cannot be sent to it. */
  id?: number;
}

/**
 * The browser ignores whatever a click listener returns, so a listener may return a promise for its
 * own testability without changing runtime behaviour.
 */
type BrowserActionClickListener = (tab: BrowserTab) => void | Promise<void>;

interface BrowserActionOnClicked {
  addListener(listener: BrowserActionClickListener): void;
  removeListener(listener: BrowserActionClickListener): void;
}

interface BrowserAction {
  /**
   * Fires on a toolbar click **and** on the `_execute_action` command — but only while no
   * `default_popup` is declared. Declaring a popup silently replaces this event with the popup,
   * which is why the manifest has none.
   */
  onClicked: BrowserActionOnClicked;
}

/** Who sent a message. Declared so a listener can be typed honestly. */
interface BrowserMessageSender {
  id?: string;
  tab?: BrowserTab;
  url?: string;
}

/**
 * A message listener that never replies. The return type is `void` on purpose: returning `true` or
 * a promise asks the browser to hold the channel open for a response PiPOSS has none to send.
 */
type BrowserMessageListener = (message: unknown, sender: BrowserMessageSender) => void;

interface BrowserRuntimeOnMessage {
  addListener(listener: BrowserMessageListener): void;
  removeListener(listener: BrowserMessageListener): void;
}

interface BrowserRuntime {
  onMessage: BrowserRuntimeOnMessage;
}

interface BrowserTabs {
  /**
   * Delivers to every frame of the tab — no `frameId` overload is declared, because restricting to
   * the top frame would break embedded players. Rejects when nothing in the tab is listening, which
   * on an ungranted site is the *normal* outcome rather than an error. See `core/inject.ts`.
   */
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface BrowserScriptingTarget {
  tabId: number;
  /** Every frame of the tab, matching the declared `all_frames: true`. */
  allFrames?: boolean;
}

interface BrowserScriptingInjection {
  target: BrowserScriptingTarget;
  files: string[];
}

interface BrowserScriptingResult {
  frameId?: number;
}

/**
 * Safari 15.4+, the same floor MV3 itself requires, so no fallback is needed. This is what makes
 * `activeTab` mean anything for the toolbar button — see `core/inject.ts`.
 */
interface BrowserScripting {
  executeScript(injection: BrowserScriptingInjection): Promise<BrowserScriptingResult[]>;
}

interface Browser {
  action: BrowserAction;
  runtime: BrowserRuntime;
  tabs: BrowserTabs;
  scripting: BrowserScripting;
}

/* ------------------------------------------------------------------------- *
 * T09 — the options page's Access section (RRR §4.3). `permissions` is Safari 14.1+, below MV3's
 * own 15.4 floor, so no fallback is needed — but every use site still guards with `?.`, because a
 * half-built `browser` object is a real state a page can load in.
 *
 * Deliberately absent, and the absence is the point:
 *
 * - **`permissions.request`.** The Access section is an indicator, not a control (RRR §4.3 — a
 *   product decision, so read it first). Undeclaring is what makes "PiPOSS never asks Safari for
 *   access" structural: `test/manifest.test.ts`'s namespace gate compares *top-level namespaces* and
 *   is blind to a declared-but-uncalled method (DECISIONS 207), and a comment saying "do not call
 *   this" is not a guard. The three facts that cost T09 a day, should it be needed back: it is
 *   honoured only while a user gesture is being handled — one `await` before it and the browser
 *   refuses; it resolves `false` when the user declines, which is an answer rather than an error; and
 *   Safari needs no `optional_host_permissions` for an origin already in `host_permissions`
 *   (DECISIONS 154).
 * - **`permissions.remove`.** An extension cannot honestly revoke a Safari host permission: the grant
 *   lives in Safari's own per-site popover, which is where the user takes it back. A "Turn off
 *   access" button in *our* page would claim ownership of a decision we do not own.
 * - **`permissions.Permissions.permissions`** (the API-permission array). PiPOSS asks about one
 *   thing, an origin pattern; `activeTab` and `scripting` are required, and are in the manifest.
 * ------------------------------------------------------------------------- */

/**
 * What is being asked about. Origins only — see above. Required rather than optional:
 * `contains({})` is answerable but meaningless.
 */
interface BrowserPermissionsDescriptor {
  origins: string[];
}

/** What `getAll` reports and what the change events carry. */
interface BrowserPermissionsSet {
  origins?: string[];
  permissions?: string[];
}

/**
 * A permission change. The payload is the *delta* — what was just added or just removed — not the
 * full set, so a listener that wants the current state has to ask again rather than read this.
 */
type BrowserPermissionsListener = (permissions: BrowserPermissionsSet) => void;

interface BrowserPermissionsEvent {
  addListener(listener: BrowserPermissionsListener): void;
  removeListener(listener: BrowserPermissionsListener): void;
}

interface BrowserPermissions {
  /** Is every origin in the descriptor granted right now? */
  contains(descriptor: BrowserPermissionsDescriptor): Promise<boolean>;

  /**
   * Everything granted. Needed *in addition to* `contains` because Safari grants host access per
   * site — see `src/options.ts`'s `readAccessState`.
   */
  getAll(): Promise<BrowserPermissionsSet>;

  /** Fires for a grant made anywhere, including in Safari's own access popover. */
  onAdded: BrowserPermissionsEvent;

  /** Fires for a revocation made anywhere — which, in Safari, is the only place. */
  onRemoved: BrowserPermissionsEvent;
}

interface Browser {
  permissions: BrowserPermissions;
}

/**
 * Always present in an extension context; absent in a plain page and under jsdom, which is why
 * every use site guards with `typeof browser`.
 */
declare var browser: Browser;
