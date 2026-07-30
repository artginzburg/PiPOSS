/**
 * Composition root: selects the real platform implementation and wires it to the pure core
 * modules. Everything WebKit-specific lives behind {@link PresentationController} (RRR §6).
 */
import { enableAutoPip } from './core/autopip';
import { enableHotkey } from './core/hotkey';
import { claimFrame } from './core/inject';
import { onTogglePiPMessage } from './core/messages';
import { observeSubtree } from './core/observe';
import {
  type PresentationController,
  WebKitPresentationController,
  togglePiP,
} from './core/presentation';
import { getVideos, pickVideo } from './core/video';
import { mountYouTubeButton } from './sites/youtube';

const controller: PresentationController = new WebKitPresentationController();

// Exactly once per frame. The toolbar button injects this same file into tabs whose declared
// copy never ran (RRR §4.1), so two copies can meet — and two copies register two `keyup` and
// two message listeners, making every toggle fire twice and cancel itself out. See
// `core/inject.ts`. Nothing here is ever disabled: in a page these bindings live exactly as
// long as the document does.
if (claimFrame()) {
  listenForHotkey();
  listenForBackgroundRequests();
  listenForTabHide();
  mountSiteButtons();
}

/** The hotkey of RRR §4.2. Which key and which modifiers are `core/hotkey.ts`'s business. */
function listenForHotkey(): void {
  enableHotkey({
    onTrigger: () => {
      togglePiPOnPage();
    },
  });
}

/**
 * The other half of the toolbar button and of `⌘⇧P`: the background cannot touch a video, so it asks
 * (RRR §4.1, §4.2). The handler is the very same {@link togglePiPOnPage} the hotkey calls — "exactly
 * as the hotkey does" is a requirement, so there is deliberately no second code path to drift from it.
 */
function listenForBackgroundRequests(): void {
  onTogglePiPMessage(() => {
    togglePiPOnPage();
  });
}

/**
 * RRR §4.6, off unless the user turned it on; `core/autopip.ts` owns every judgement.
 *
 * Deliberately *not* routed through {@link togglePiPOnPage}, the hotkey's and the toolbar
 * button's shared path: those two act because the user just asked, so they take a lone paused
 * video and they *toggle* — both wrong for a trigger nobody pressed. The two paths share
 * `togglePiP` instead, which is the part that must not be duplicated.
 */
function listenForTabHide(): void {
  enableAutoPip({ controller });
}

function togglePiPOnPage(videos: NodeListOf<HTMLVideoElement> = getVideos()): void {
  const video = pickVideo(videos);
  if (!video) return;

  togglePiP(video, controller);
}

/**
 * The one site-specific surface (RRR §4.5). Everything about YouTube's DOM lives in
 * `sites/youtube.ts`; this only says which document and which controller.
 *
 * The observer is installed only when that module has something to do, because a
 * whole-document `childList` observer on every page on the web, feeding a consumer that does
 * nothing, is RRR §5.3 at its worst (DECISIONS 134). `core/observe.ts` holds RRR §5.3's
 * number: at most one run per animation frame.
 */
function mountSiteButtons(): void {
  const youtube = mountYouTubeButton(document, controller);
  if (!youtube.active) return;

  observeSubtree(document, () => {
    youtube.refresh();
  });
}
