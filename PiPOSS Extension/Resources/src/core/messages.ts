/**
 * The one and only definition of what the background and the content script say to each other.
 *
 * The background has no video, no DOM and no `webkitSetPresentationMode`; the content script has
 * no toolbar button. So the toolbar click (and, through `_execute_action`, the registered
 * keyboard command) crosses a realm boundary, and that boundary is a plain string. A typo on one
 * side of it is not a compile error, not an exception and not a log line — the button simply
 * stops working. Hence the string lives here, in a module both sides import, and the send and
 * receive helpers with it: nothing outside this module ever names the wire format.
 */

/**
 * The wire value. Namespaced, because a content script shares `runtime.onMessage` with every
 * other extension message that reaches the page.
 */
export const TOGGLE_PIP = 'piposs:toggle';

/** "Toggle Picture in Picture on whatever video you would pick for the hotkey." */
export interface TogglePiPMessage {
  type: typeof TOGGLE_PIP;
}

/** Detaches a listener registered with {@link onTogglePiPMessage}. Idempotent. */
export type Unsubscribe = () => void;

/**
 * Narrows an arbitrary incoming message. Extra fields are tolerated on purpose: a newer
 * background talking to an older content script must still be understood, because the old
 * content script stays alive in already-open tabs after an update.
 */
export function isTogglePiPMessage(message: unknown): message is TogglePiPMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === TOGGLE_PIP
  );
}

/**
 * Asks one tab's content scripts to toggle PiP. Resolves either way, never rejects — but it
 * **reports** whether anything received the message, and that return value is load-bearing.
 * "Nothing was listening" is not an error to log and forget: on an ungranted site it is the
 * expected first answer, and the caller's job is to inject and try again (`core/inject.ts`,
 * RRR §4.1). An earlier version swallowed the rejection and returned nothing, which made the
 * toolbar button silently dead on every site of a fresh install.
 *
 * No `frameId` is passed, so the message reaches **every** frame. Required, not incidental: on a
 * page with an embedded player the video lives in an iframe, and `frameId: 0` would make the
 * button do nothing there — the commonest case after YouTube itself.
 *
 * @returns `true` when a content script received it, `false` when none did.
 */
export async function sendTogglePiP(tabId: number): Promise<boolean> {
  if (typeof browser === 'undefined') return false;

  const message: TogglePiPMessage = { type: TOGGLE_PIP };

  try {
    await browser.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // "Could not establish connection. Receiving end does not exist." — no content script is
    // running in that tab. Not distinguished from any other failure, because the response to
    // all of them is the same: try injecting one.
    return false;
  }
}

/**
 * Runs `handler` whenever a toggle request arrives from the background. The listener returns
 * `undefined` deliberately: returning `true` or a promise from a `runtime.onMessage` listener
 * tells the browser to hold the channel open for a reply this extension never sends.
 */
export function onTogglePiPMessage(handler: () => void): Unsubscribe {
  return onRuntimeMessage(isTogglePiPMessage, handler);
}

/* ------------------------------------------------------------------------- *
 * BF07's `OPEN_OPTIONS_PAGE` route stood here. **Do not write it again.**
 *
 * A container app cannot open its extension's options page, and since BF17 that is measured
 * rather than untested (RRR §4.7, DECISIONS 297): the owner pressed the button on a machine with
 * BF15's LaunchServices pollution cleared, and **`runtime.onMessage` does not receive a message
 * dispatched with `SFSafariApplication.dispatchMessage`**. Apple's documented alternative —
 * `nativeMessaging` + `runtime.connectNative` + `port.onMessage` — is unusable here for an
 * independent reason: WebKit forces an MV3 background page non-persistent, unloads it 30 s after
 * idle, and **port delivery does not wake it** (only events routed through
 * `wakeUpBackgroundContentIfNecessaryToFireEvents`, which the port path is not), so at the moment
 * the user presses a button the port would usually not exist. Trying again therefore needs
 * `nativeMessaging` plus a persistent background page, and MV3 forbids the second.
 * `git show 39c4b0a` has the full implementation if the platform ever changes.
 * ------------------------------------------------------------------------- */

/**
 * The body of {@link onTogglePiPMessage}. Kept separate from its one caller because the three
 * non-obvious properties it encodes are the reason it exists, not the sharing — a `browser`
 * global that may be absent or half-built (a real state a frame can load in), a listener that
 * returns `undefined`, and an unsubscribe that can be called twice. Inlining would put all three
 * inside a function whose name says "toggle".
 */
function onRuntimeMessage(
  accepts: (message: unknown) => boolean,
  handler: () => void,
): Unsubscribe {
  if (typeof browser === 'undefined') return () => {};

  const event = browser.runtime?.onMessage;
  if (!event) return () => {};

  const listener = (message: unknown): void => {
    if (!accepts(message)) return;
    handler();
  };

  event.addListener(listener);

  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    event.removeListener(listener);
  };
}
