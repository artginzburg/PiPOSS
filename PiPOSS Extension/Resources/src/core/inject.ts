/**
 * How the content script gets into a page — both halves in one file, because they are two ends
 * of one contract. This is the canonical account; `src/background.ts` and `src/browser.d.ts`
 * point here.
 *
 * `activeTab` is widely, and wrongly, read as "the toolbar button works everywhere". It grants
 * *the ability to inject into* the clicked tab and to read its privileged properties; it does
 * not retroactively start a **declared** content script, and Safari will not run one until the
 * user has allowed the site. On a fresh install no site is allowed, so "click →
 * `tabs.sendMessage`" reaches nobody and the button is silently dead — worse than the MV2 popup
 * it replaced, which at least said "press P". So the click must *use* the grant it just
 * received: message the tab; if that rejects, inject with `scripting.executeScript`; message it
 * again. `scripting` is Safari 15.4+, the same floor MV3 requires, so nothing degrades (RRR §4.1).
 *
 * **The consequence is the other half of this file.** That injection can land a second copy on
 * a page which already has one — a granted site whose first message failed for another reason,
 * or two clicks racing. Every copy runs the same top-level code, so two copies means two
 * `keyup` and two message listeners: one keypress toggles PiP twice, entering and immediately
 * leaving. A visible no-op, on exactly the sites that otherwise work. {@link claimFrame} stops it.
 */

/**
 * The bundle to inject. **Must stay equal to `content_scripts[0].js[0]` in `manifest.json`** —
 * injecting a path that does not exist fails at runtime only, and `manifest.test.ts` compares
 * the two so it cannot drift.
 */
export const CONTENT_SCRIPT_FILE = 'dist/content.js';

/**
 * Where {@link claimFrame} records that this frame is taken.
 *
 * On the frame's global, not in the DOM: content scripts run in an isolated world the page
 * cannot see, and a declared copy and an injected copy share that world — which is what makes
 * the flag visible to the second copy. A `data-` attribute on `documentElement` would be
 * readable and forgeable by the page, and would fire the very mutation observers the content
 * script installs. Exported so tests can model a fresh page load.
 */
export const CONTENT_SCRIPT_FRAME_FLAG = '__pipossContentScriptRunning';

type FrameGlobal = Record<string, unknown>;

/**
 * Claims this frame for the content script, returning `false` if another copy got here first.
 * The caller must then do nothing at all — no listeners, no observers, no DOM writes.
 */
export function claimFrame(): boolean {
  const frame = globalThis as unknown as FrameGlobal;

  if (frame[CONTENT_SCRIPT_FRAME_FLAG] === true) return false;

  frame[CONTENT_SCRIPT_FRAME_FLAG] = true;
  return true;
}

/**
 * Injects the content script into every frame of one tab, under the `activeTab` grant the
 * toolbar click just produced.
 *
 * Resolves `false` rather than rejecting when refused — Safari's own pages, the Extensions
 * gallery and PDFs are off limits to every extension however many permissions it holds, and
 * RRR §4.1 says the answer to "cannot act here" is silence. `allFrames: true` mirrors the
 * declared `all_frames: true`: an embedded player lives in an iframe, so injecting only the top
 * document would leave the button dead on exactly the pages that most need it.
 */
export async function injectContentScript(tabId: number): Promise<boolean> {
  if (typeof browser === 'undefined') return false;

  try {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPT_FILE],
    });
    return true;
  } catch {
    return false;
  }
}
