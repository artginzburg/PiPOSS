/**
 * A fake `browser` global for jsdom, where no real one exists: `storage`, `action`,
 * `runtime`, `tabs`, `scripting`, `permissions`.
 *
 * Shared on purpose — the hotkey, options-page and auto-PiP suites all need the same
 * doubles, and private copies would drift. Treat it as production code: a fake that is
 * laxer than a real browser lets a test pass while the shipped extension is broken.
 *
 * Deliberate differences from the real API, each in the direction that makes tests
 * stricter or the semantics better defined:
 *
 * 1. Values are structurally cloned in, out, and once per `onChanged` listener, as a
 *    real serialising store does. A test cannot pass by sharing a reference with the
 *    code under test, and a listener that mutates its payload reaches neither the store
 *    nor the next listener.
 * 2. `onChanged` listeners run synchronously inside `set`/`remove`, before the returned
 *    promise resolves. Real browsers dispatch asynchronously — so a suite must not
 *    treat an awaited write as a barrier (DECISIONS 51).
 * 3. Dispatch never re-enters: a write performed *by* a listener is queued until the
 *    change in flight has reached every listener.
 * 4. A listener that throws is isolated as a real browser isolates it — the rest still
 *    run, the write still succeeds — and the error lands in
 *    {@link FakeStorageOnChanged.listenerErrors} instead of vanishing.
 * 5. `tabs.sendMessage` delivers to `runtime.onMessage` in this same realm, which in Safari
 *    are two. Collapsing them lets one test load the background *and* the content script and
 *    prove they agree on the message value — the one mistake neither side can catch alone.
 *    Delivery is gated on {@link FakeContentScriptRegistry}, not on whether a listener happens
 *    to be registered: answering "is anything listening?" from the listener list made the
 *    ungranted-site case structurally invisible.
 * 6. `emit`/`click` hand back what the listeners returned, and `click` awaits it. Real browsers
 *    ignore an `action.onClicked` return value entirely, so this is a determinism affordance and
 *    **not** evidence about ordering in Safari (DECISIONS 51).
 * 7. `permissions.request` is a tripwire, not a double — see {@link FakePermissions}.
 */

type Notify = (changes: Record<string, BrowserStorageChange>) => void;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * One turn of the event loop — a **macrotask**, not a microtask.
 *
 * Used by the calls that genuinely leave the process: `tabs.sendMessage` and
 * `scripting.executeScript` cross into another realm. Beyond fidelity this is diagnostic —
 * code that retries one of them in an unbounded loop yields to the timer queue on each pass, so
 * a test timeout can fire. A microtask-only loop starves the event loop and vitest hangs for
 * ever instead of failing (DECISIONS 32). `storage` deliberately does **not** tick; deviation 2.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** `browser.storage.local`, in memory. */
export class FakeStorageArea implements BrowserStorageArea {
  /** The `keys` argument of every `get`, in order. */
  readonly getCalls: Array<string | string[] | null | undefined> = [];

  /** Every write that actually happened, in order. */
  readonly setCalls: BrowserStorageItems[] = [];

  /** When set, `get` rejects with this value instead of reading. */
  getFailure: unknown = null;

  /** When set, `set` rejects with this value instead of writing. */
  setFailure: unknown = null;

  private items: BrowserStorageItems;

  constructor(
    initial: BrowserStorageItems,
    private readonly notify: Notify,
  ) {
    this.items = clone(initial);
  }

  /** Everything stored right now, as a detached copy. */
  snapshot(): BrowserStorageItems {
    return clone(this.items);
  }

  /** Puts items in place without firing listeners or recording a call. */
  seed(items: BrowserStorageItems): void {
    this.items = { ...this.items, ...clone(items) };
  }

  async get(keys?: string | string[] | null): Promise<BrowserStorageItems> {
    if (this.getFailure) throw this.getFailure;
    this.getCalls.push(keys);

    const wanted = keys === undefined || keys === null ? Object.keys(this.items) : [keys].flat();

    const result: BrowserStorageItems = {};
    for (const key of wanted) {
      if (key in this.items) result[key] = clone(this.items[key]);
    }
    return result;
  }

  async set(items: BrowserStorageItems): Promise<void> {
    if (this.setFailure) throw this.setFailure;

    const written = clone(items);
    this.setCalls.push(clone(written));

    const changes: Record<string, BrowserStorageChange> = {};
    for (const [key, value] of Object.entries(written)) {
      const existed = key in this.items;
      const oldValue = this.items[key];
      this.items[key] = value;

      // The payload gets its own copies: what a listener does to `newValue` or
      // `oldValue` must not be visible in the store afterwards.
      changes[key] = existed
        ? { oldValue: clone(oldValue), newValue: clone(value) }
        : { newValue: clone(value) };
    }
    this.notify(changes);
  }

  async remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, BrowserStorageChange> = {};
    for (const key of [keys].flat()) {
      if (!(key in this.items)) continue;
      changes[key] = { oldValue: clone(this.items[key]) };
      delete this.items[key];
    }
    if (Object.keys(changes).length > 0) this.notify(changes);
  }
}

/** `browser.storage.onChanged`. */
export class FakeStorageOnChanged implements BrowserStorageOnChanged {
  private readonly listeners: BrowserStorageChangeListener[] = [];

  /** Everything a listener threw, in dispatch order — assertable instead of invisible. */
  readonly listenerErrors: unknown[] = [];

  /** Every `removeListener` call, in order — pins that unsubscribing is idempotent. */
  readonly removeListenerCalls: BrowserStorageChangeListener[] = [];

  private readonly pending: Array<{
    changes: Record<string, BrowserStorageChange>;
    areaName: string;
  }> = [];

  private dispatching = false;

  /** How many listeners are registered — pins that unsubscribing detaches. */
  get listenerCount(): number {
    return this.listeners.length;
  }

  addListener(listener: BrowserStorageChangeListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: BrowserStorageChangeListener): void {
    this.removeListenerCalls.push(listener);

    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  /**
   * Dispatches a change as the browser would: to every listener registered when the
   * change is delivered, each with its own copy of the payload, each failure isolated.
   * A change emitted *by* a listener waits its turn.
   */
  emit(changes: Record<string, BrowserStorageChange>, areaName = 'local'): void {
    this.pending.push({ changes, areaName });
    if (this.dispatching) return;

    this.dispatching = true;
    try {
      for (let next = this.pending.shift(); next !== undefined; next = this.pending.shift()) {
        for (const listener of [...this.listeners]) {
          try {
            listener(clone(next.changes), next.areaName);
          } catch (error) {
            this.listenerErrors.push(error);
          }
        }
      }
    } finally {
      this.dispatching = false;
      // Only reachable if cloning a payload threw, which is a broken test rather than a
      // browser behaviour — do not carry the wreckage into the next emit.
      this.pending.length = 0;
    }
  }
}

/** Counts reads of the forbidden `browser.storage.sync` property. Must stay 0. */
export interface SyncTripwire {
  accesses: number;
}

/**
 * A `sync` area that fails loudly. Safari's `storage.sync` is an alias for `local` and
 * Safari 15/15.1 wrote sync items into `local`, so RRR §3 forbids `sync` outright. The
 * type-level guard is that `Browser` never declares it; this is the runtime guard.
 */
function forbiddenSyncArea(): BrowserStorageArea {
  const forbid = (): never => {
    throw new Error('storage.sync is forbidden (RRR §3): it is an alias for local in Safari');
  };
  return { get: forbid, set: forbid, remove: forbid };
}

/**
 * Names of APIs a test asserts are never reached. Recorded rather than thrown, so one
 * array can be asserted empty at the end of any test.
 *
 * They are also absent from `src/browser.d.ts`, which is the primary guard — this is
 * the one that survives a future task widening those typings.
 */
export type ForbiddenApiCall =
  | 'action.setBadgeText'
  | 'action.setTitle'
  | 'notifications.create'
  | 'tabs.query';

/** `browser.action`. */
export class FakeAction implements BrowserAction {
  readonly onClicked = new FakeEvent<BrowserActionClickListener>();

  constructor(private readonly forbidden: ForbiddenApiCall[]) {}

  /**
   * A toolbar click, or the `_execute_action` command — Safari routes both to this
   * event as long as no `default_popup` is declared.
   */
  async click(tab: BrowserTab): Promise<void> {
    await Promise.all(this.onClicked.emit(tab));
  }

  /** RRR §4.1: nothing is shown when there is no eligible video. Tripwires. */
  setBadgeText(details: { text: string }): void {
    void details;
    this.forbidden.push('action.setBadgeText');
  }

  setTitle(details: { title: string }): void {
    void details;
    this.forbidden.push('action.setTitle');
  }
}

/**
 * `browser.runtime`.
 *
 * `onInstalled` and `openOptionsPage` are deliberately absent. BF14 removed the
 * install-time options tab — `onInstalled` fires **per Safari profile**, so it opened one
 * tab in every profile at once — and BF17 established that the container app cannot open
 * the options page at all, because `dispatchMessage` does not reach `runtime.onMessage`.
 * Nothing in `src/` registers or calls either, and a fake that kept them would keep the
 * matching declarations alive in `src/browser.d.ts`, where a declared-but-uncalled API is
 * invisible to every gate (BF06).
 */
export class FakeRuntime {
  readonly onMessage = new FakeEvent<BrowserMessageListener>();
}

/**
 * Which tabs are actually running PiPOSS's content script — the state a test most often gets
 * wrong. A *declared* content script runs only where the user has allowed the site, so on a fresh
 * install this set is empty for every tab and `tabs.sendMessage` rejects however correct the
 * message is. `scripting.executeScript` is the only thing that adds a tab without a host
 * permission (RRR §4.1).
 */
export class FakeContentScriptRegistry {
  private readonly tabs = new Set<number>();

  constructor(initial: readonly number[] = []) {
    for (const tabId of initial) this.tabs.add(tabId);
  }

  /** Tabs running the content script right now, ascending. */
  get tabIds(): number[] {
    return [...this.tabs].sort((a, b) => a - b);
  }

  has(tabId: number): boolean {
    return this.tabs.has(tabId);
  }

  /** What a granted host permission, or a successful injection, produces. */
  add(tabId: number): void {
    this.tabs.add(tabId);
  }
}

/** `browser.tabs`. */
export class FakeTabs implements BrowserTabs {
  /**
   * Every message sent to a tab, in order — including undelivered ones, so a test can
   * assert what was *attempted*.
   *
   * `options` is recorded even though {@link BrowserTabs.sendMessage} declares no third
   * parameter: `{ frameId: 0 }` would restrict delivery to the top frame and break
   * every embedded player, so "we addressed the whole tab" has to be assertable.
   */
  readonly sentMessages: Array<{ tabId: number; message: unknown; options?: unknown }> = [];

  /** When set, `sendMessage` rejects with this value instead of delivering. */
  sendMessageFailure: unknown = null;

  constructor(
    private readonly onMessage: FakeEvent<BrowserMessageListener>,
    private readonly contentScripts: FakeContentScriptRegistry,
    private readonly forbidden: ForbiddenApiCall[],
  ) {}

  async sendMessage(tabId: number, message: unknown, options?: unknown): Promise<unknown> {
    this.sentMessages.push({
      tabId,
      message: clone(message),
      options: options === undefined ? undefined : clone(options),
    });

    await tick();

    if (this.sendMessageFailure) throw this.sendMessageFailure;

    if (!this.contentScripts.has(tabId)) {
      // Safari's real wording. Note what this does *not* consult: whether a listener is
      // registered (deviation 5).
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }

    // Every frame gets its own copy: messages cross a realm boundary and are
    // structurally cloned, so a listener cannot mutate the sender's object.
    const responses = this.onMessage.emit(clone(message), { id: 'piposs-test' });
    return responses.find((response) => response !== undefined);
  }

  /**
   * Tripwire. The toolbar button must work with no host permission granted, and
   * `activeTab` covers only the tab handed to the `onClicked` listener — so asking for
   * the active tab instead is a defect, not a style choice (RRR §4.1).
   */
  query(info: { active?: boolean }): Promise<BrowserTab[]> {
    void info;
    this.forbidden.push('tabs.query');
    return Promise.resolve([]);
  }
}

/**
 * `browser.scripting` — the API that makes `activeTab` mean something.
 *
 * A successful `executeScript` runs the loader the test supplied — where the content script's
 * listeners get registered, exactly as a real injection would — and *only then* marks the tab as
 * running the content script. A loader that throws leaves the tab ungranted.
 */
export class FakeScripting implements BrowserScripting {
  /** Every injection request, in order. Assert on `target.allFrames` and `files`. */
  readonly executeScriptCalls: BrowserScriptingInjection[] = [];

  /**
   * When set, `executeScript` rejects with this value — how Safari answers for a page
   * no extension may touch, or a user who denied the site.
   */
  executeScriptFailure: unknown = null;

  constructor(
    private readonly contentScripts: FakeContentScriptRegistry,
    private readonly loadContentScript: (tabId: number) => void | Promise<void>,
  ) {}

  async executeScript(injection: BrowserScriptingInjection): Promise<BrowserScriptingResult[]> {
    this.executeScriptCalls.push(clone(injection));

    await tick();

    if (this.executeScriptFailure) throw this.executeScriptFailure;

    await this.loadContentScript(injection.target.tabId);
    this.contentScripts.add(injection.target.tabId);

    return [{ frameId: 0 }];
  }
}

/** Not in `src/browser.d.ts` at all — present only so a test can prove it stays unused. */
export class FakeNotifications {
  constructor(private readonly forbidden: ForbiddenApiCall[]) {}

  create(options: { title: string }): void {
    void options;
    this.forbidden.push('notifications.create');
  }
}

/**
 * A minimal `addListener`/`removeListener` event.
 *
 * Dispatch is synchronous and does **not** isolate exceptions, unlike
 * {@link FakeStorageOnChanged}: `storage.onChanged` fans out to unrelated subscribers,
 * whereas these events have exactly one owner apiece, and a handler that throws is a
 * defect a test should see rather than a condition to survive.
 */
export class FakeEvent<L extends (...args: never[]) => unknown> {
  private readonly listeners: L[] = [];

  readonly removeListenerCalls: L[] = [];

  get listenerCount(): number {
    return this.listeners.length;
  }

  addListener(listener: L): void {
    this.listeners.push(listener);
  }

  removeListener(listener: L): void {
    this.removeListenerCalls.push(listener);

    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  /** Delivers to every listener registered right now, returning what each gave back. */
  emit(...args: Parameters<L>): unknown[] {
    return [...this.listeners].map((listener) => listener(...args));
  }
}

/**
 * `browser.permissions`.
 *
 * The grant is a set of origin patterns matched literally. Enough for PiPOSS, which
 * only ever asks about the all-sites pattern, and it deliberately implements no pattern
 * subsumption: a fake deciding `https://a.test/*` satisfies all-sites would invent a
 * rule Safari does not follow either.
 */
export class FakePermissions implements BrowserPermissions {
  readonly onAdded = new FakeEvent<BrowserPermissionsListener>();

  readonly onRemoved = new FakeEvent<BrowserPermissionsListener>();

  /**
   * Every `request`, in order. **Must stay empty, and must stay recorded.**
   *
   * `permissions.request` is undeclared in `src/browser.d.ts` since BF06, so a call to it does
   * not compile (RRR §4.3, DECISIONS 207) — the primary guard. This is the runtime half, and a
   * two-file mutation proved it load-bearing in the direction easy to get backwards: make
   * production call `request` *and* stop the fake recording, and the test named "never calls
   * permissions.request" passes. The recording exists to prove absence.
   */
  readonly requestCalls: BrowserPermissionsDescriptor[] = [];

  /** Every `contains`, in order. */
  readonly containsCalls: BrowserPermissionsDescriptor[] = [];

  /** How many times the page asked what is granted. */
  getAllCalls = 0;

  /** When set, `contains` rejects with this value. */
  containsFailure: unknown = null;

  /** When set, `getAll` rejects with this value. */
  getAllFailure: unknown = null;

  private readonly origins: Set<string>;

  constructor(initial: readonly string[] = []) {
    this.origins = new Set(initial);
  }

  /** Origins granted right now, in insertion order. */
  get granted(): string[] {
    return [...this.origins];
  }

  async contains(descriptor: BrowserPermissionsDescriptor): Promise<boolean> {
    this.containsCalls.push(clone(descriptor));
    await tick();
    if (this.containsFailure) throw this.containsFailure;

    return descriptor.origins.every((origin) => this.origins.has(origin));
  }

  async getAll(): Promise<BrowserPermissionsSet> {
    this.getAllCalls += 1;
    await tick();
    if (this.getAllFailure) throw this.getAllFailure;

    return { origins: this.granted };
  }

  /**
   * A recording tripwire of the same kind as {@link FakeNotifications}, granting nothing: the
   * prompt is the user's and no flow left in PiPOSS waits for an answer.
   *
   * Gone with the Access button: `userGrants`, `requestFailure`, and the throw for a call made
   * outside an event dispatch. The gesture rule is real (DECISIONS 151/152 — jsdom's
   * `globalThis.event` was measured `undefined` already in a microtask queued from inside the
   * handler, exactly Safari's window), so a task declaring `request` again owes that back.
   */
  async request(descriptor: BrowserPermissionsDescriptor): Promise<boolean> {
    // Recorded synchronously, before anything can go wrong, so the call is visible to an
    // assertion however the caller then treats the promise.
    this.requestCalls.push(clone(descriptor));

    // The user's prompt cannot possibly answer in this turn.
    await tick();

    return false;
  }

  /**
   * What Safari's own access popover does, outside our page: grants origins and fires
   * `onAdded` with the delta. Test-only — no production code may grant or revoke behind
   * the user's back, which is why neither this nor {@link revoke} is declared in
   * `src/browser.d.ts`.
   */
  grant(origins: readonly string[]): void {
    const added = origins.filter((origin) => !this.origins.has(origin));
    for (const origin of added) this.origins.add(origin);
    if (added.length > 0) this.onAdded.emit({ origins: added });
  }

  /** The other half: the user taking access back in Safari's popover. */
  revoke(origins: readonly string[]): void {
    const removed = origins.filter((origin) => this.origins.has(origin));
    for (const origin of removed) this.origins.delete(origin);
    if (removed.length > 0) this.onRemoved.emit({ origins: removed });
  }
}

export interface FakeBrowser {
  storage: {
    local: FakeStorageArea;
    onChanged: FakeStorageOnChanged;
    readonly sync: BrowserStorageArea;
  };

  action: FakeAction;
  runtime: FakeRuntime;
  tabs: FakeTabs;
  scripting: FakeScripting;
  permissions: FakePermissions;

  /** Which tabs run the content script. Empty by default — a fresh install. */
  contentScripts: FakeContentScriptRegistry;

  /** Undeclared in `src/browser.d.ts`; here purely as a tripwire. */
  notifications: FakeNotifications;

  /**
   * Every forbidden API the code under test reached for, in order. RRR §4.1's "nothing
   * is shown" and "the button works without host permissions" are both assertions that
   * this array is empty.
   */
  readonly forbiddenApiCalls: ForbiddenApiCall[];

  /**
   * Reads of `browser.storage.sync`, counted. Merely *touching* the property violates
   * RRR §3, so this catches a case the throwing area cannot: code that reaches for
   * `sync` without calling anything on it.
   */
  syncTripwire: SyncTripwire;
}

type GlobalWithBrowser = { browser?: Browser };

export interface FakeBrowserOptions {
  items?: BrowserStorageItems;

  /**
   * Tabs that already run the declared content script — i.e. sites the user has
   * allowed. **Empty by default, which is the fresh-install state**: nothing is
   * listening anywhere and the toolbar button has to inject to work at all.
   */
  tabsWithContentScript?: readonly number[];

  /**
   * What `scripting.executeScript` runs. A test that can reach injection must supply
   * this — normally `async () => { vi.resetModules(); await import('../src/content'); }`,
   * so the listeners appear only once injection has happened, as in Safari.
   *
   * The default throws rather than quietly succeeding: an injection that grants the tab
   * without running anything is precisely the lie this fake was revised to stop telling.
   */
  loadContentScript?: (tabId: number) => void | Promise<void>;

  /**
   * Origin patterns the user has already allowed. **Empty by default, which is the
   * fresh-install state.**
   */
  grantedOrigins?: readonly string[];
}

/** Installs a fake `browser` global and returns it. */
export function installFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const onChanged = new FakeStorageOnChanged();
  const local = new FakeStorageArea(options.items ?? {}, (changes) => {
    onChanged.emit(changes, 'local');
  });
  const syncTripwire: SyncTripwire = { accesses: 0 };

  const forbiddenApiCalls: ForbiddenApiCall[] = [];
  const runtime = new FakeRuntime();
  const contentScripts = new FakeContentScriptRegistry(options.tabsWithContentScript);

  const loadContentScript =
    options.loadContentScript ??
    ((tabId: number): never => {
      throw new Error(
        `FakeScripting: executeScript reached tab ${tabId} but this test supplied no ` +
          'loadContentScript. Either pass one (so the injected listeners really appear), ' +
          'or seed tabsWithContentScript if the site is meant to be already granted.',
      );
    });

  const fake: FakeBrowser = {
    storage: {
      local,
      onChanged,
      get sync(): BrowserStorageArea {
        syncTripwire.accesses += 1;
        return forbiddenSyncArea();
      },
    },
    action: new FakeAction(forbiddenApiCalls),
    runtime,
    tabs: new FakeTabs(runtime.onMessage, contentScripts, forbiddenApiCalls),
    scripting: new FakeScripting(contentScripts, loadContentScript),
    permissions: new FakePermissions(options.grantedOrigins),
    contentScripts,
    notifications: new FakeNotifications(forbiddenApiCalls),
    forbiddenApiCalls,
    syncTripwire,
  };
  // Checked structurally against `Browser` on the way into the global, which is what keeps the
  // fake from drifting laxer than the typings — the assignment is the check. Deleting a member
  // from any `Fake*` class fails here, which is the point: a fake more generous than Safari is
  // how BF04 stayed invisible to 349 tests.
  const checked: Browser = fake;
  (globalThis as GlobalWithBrowser).browser = checked;
  return fake;
}

/**
 * Installs an arbitrary, possibly half-built `browser` global — `{}`, `{ storage: {} }`,
 * an area with no methods.
 *
 * Deliberately typed `unknown`: these are shapes the `Browser` type says cannot exist,
 * and the point is that the code survives them anyway. A content script runs in frames
 * where the API is present but not yet populated, and RRR §4.1 says the answer there is
 * silence, not a throw.
 */
export function installPartialBrowser(value: unknown): void {
  (globalThis as { browser?: unknown }).browser = value;
}

/** Removes the fake global, leaving jsdom as bare as a plain web page. */
export function uninstallFakeBrowser(): void {
  delete (globalThis as GlobalWithBrowser).browser;
}

/**
 * Makes `storage.local.get` hang, and hands back the resolver.
 *
 * The only honest way to test the window *before* settings have loaded: the content
 * script runs at document start and the read is asynchronous, so a keypress or an
 * observer wake can genuinely arrive first. Failing the read instead would prove
 * nothing — a failed read resolves to the defaults, which is also the pre-load state.
 */
export function hangReads(fake: FakeBrowser): (items: BrowserStorageItems) => void {
  let release: (items: BrowserStorageItems) => void = () => {};

  fake.storage.local.get = () =>
    new Promise<BrowserStorageItems>((resolve) => {
      release = resolve;
    });

  return (items) => {
    release(items);
  };
}
