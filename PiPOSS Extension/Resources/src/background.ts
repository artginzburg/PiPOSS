/**
 * The background script, with exactly **one** job: the toolbar button (RRR §4.1). With no
 * `default_popup` declared, the `_execute_action` keyboard command routes through the same
 * event (RRR §4.2). Both ask the active tab's content script to toggle PiP, injecting it
 * first if the site was never granted — the reasoning is in `core/inject.ts`. It holds no
 * state and no video logic, so it can only ask (`core/messages.ts`), which also records why
 * the container app's former open-options request cannot work.
 *
 * The manifest uses `"background": { "scripts": [...], "persistent": false }` rather than the
 * `service_worker` Safari has supported since 15.4: RRR §12 records the `scripts` form as the
 * fallback for Safari's unreliable service workers, and RRR §4.1 makes this the one surface
 * that must always work. Reversing it is a two-key manifest edit and no code change — esbuild
 * emits a classic script either way. Nothing here may rely on a DOM, a persistent global or a
 * timer outliving an event, so that stays true; both forms can be evicted between events, and
 * registering listeners at the top level is what makes either one wake up correctly.
 */
import { injectContentScript } from './core/inject';
import { sendTogglePiP } from './core/messages';

start();

function start(): void {
  if (typeof browser === 'undefined') return;

  browser.action?.onClicked.addListener(handleActionClicked);
}

/**
 * A toolbar click, or `⌘⇧P`. `tab` is the tab the click happened on, and `activeTab` grants
 * access to exactly that tab — so no host permission and no `tabs.query` is involved. That
 * grant is necessary for an ungranted site but not sufficient: what makes it sufficient is
 * spending it on the injection below.
 *
 * The promise is returned rather than discarded with `void`. Safari ignores the return value,
 * so nothing changes at runtime — but a discarded promise hides its rejection from a test.
 */
async function handleActionClicked(tab: BrowserTab): Promise<void> {
  const tabId = tab?.id;
  // `undefined`, not falsy: tab id 0 is a tab like any other.
  if (tabId === undefined) return; // Nothing addressable; silence (RRR §4.1).

  // Message first: on a granted site the declared content script is already running, and
  // injecting unconditionally would add a second copy on every click.
  if (await sendTogglePiP(tabId)) return;

  // Nobody answered, the normal first outcome on an ungranted site. Spend the `activeTab`
  // grant this click produced, then ask again — exactly one attempt, so a page where the
  // retry also finds nothing cannot become a loop.
  if (!(await injectContentScript(tabId))) return; // Refused; silence (RRR §4.1).

  await sendTogglePiP(tabId);
}
