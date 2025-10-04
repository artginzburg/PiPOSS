const PresentationMode: Record<string, VideoPresentationMode> = {
  /**
   * Picture in Picture
   */
  PIP: 'picture-in-picture',
  /**
   * On the page
   */
  INLINE: 'inline',
};

const hotkey = 'p';
const hotkeyUppercase = hotkey.toUpperCase();

enableHotkey();
enableCommandListener();
addCustomButtons();
observeMutations();

function enableHotkey(): void {
  log('enabling hotkey');

  document.addEventListener('keyup', handleKeyUp, {
    passive: true,
  });
}

function enableCommandListener(): void {
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'toggle-pip') {
      togglePiPOnPage();
    }
  });
}

function handleKeyUp(event: KeyboardEvent): void {
  if (
    !(
      event.code === `Key${hotkeyUppercase}` ||
      event.key === hotkey ||
      event.key === hotkeyUppercase
    )
  )
    return;

  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const hotkeyBlockingFocusedElements = ['INPUT', 'TEXTAREA'];
  const activeElement = document.activeElement as HTMLElement | null;
  if (
    activeElement &&
    (hotkeyBlockingFocusedElements.includes(activeElement.tagName) ||
      activeElement.isContentEditable)
  )
    return;

  log('should toggle PiP', event);

  togglePiPOnPage();
}

/**
 * This does not select videos in `iframe`s (in Safari).
 * That's why we're running this content script for every frame on the page (via `"all_frames": true` in manifest.json)
 */
function getVideos(): NodeListOf<HTMLVideoElement> {
  return document.querySelectorAll('video');
}

function togglePiPOnPage(videos: NodeListOf<HTMLVideoElement> = getVideos()): void {
  log('videos', videos);

  if (videos.length === 0) return; // No videos, stop.
  if (videos.length === 1) {
    // Only one video, execute and stop.
    togglePiPOnVideo(videos[0]);
    return;
  }
  // Multiple videos, only execute for the first one playing.
  //? If there is multiple playing or none playing, maybe it should calculate the closest video and execute?
  const playing = Array.from(videos).filter((video) => !video.paused);
  if (playing.length === 0) return;
  togglePiPOnVideo(playing[0]);
}

function togglePiPOnVideo(video: HTMLVideoElement): void {
  log('toggling PiP for', video);

  if (!video.webkitSupportsPresentationMode(PresentationMode.PIP)) return; // Current browser does not support Picture in Picture

  const currentPresentationMode: VideoPresentationMode = video.webkitPresentationMode;

  video.webkitSetPresentationMode(
    currentPresentationMode === PresentationMode.PIP
      ? (video as any)['lastPresentationMode'] ?? PresentationMode.INLINE
      : PresentationMode.PIP,
  );

  (video as any)['lastPresentationMode'] = currentPresentationMode;
}

/** This is needed because going fullscreen in YouTube, for example, enters a different layout view, so there would be no custom buttons. */
function observeMutations(): void {
  new MutationObserver(addCustomButtons).observe(document, {
    subtree: true,
    childList: true,
  });
}

function addCustomButtons(): void {
  const videos = getVideos();
  for (const video of Array.from(videos)) {
    if (!video.src.includes('www.youtube.com')) continue;
    if ((video as any).attributes['PiPOSSCustomButtonEnabled']) continue;

    const videoContainer = video.parentElement?.parentElement;
    const controlsContainer = videoContainer?.querySelector('.ytp-right-controls');

    enableBuiltinYoutubePipButton(controlsContainer || null);
    (video as any).attributes['PiPOSSCustomButtonEnabled'] = 'true';
  }
}

function enableBuiltinYoutubePipButton(controlsContainer: Element | null): void {
  if (!controlsContainer) return;

  log('Is youtube, gonna enable button');

  // YouTube already has a PiP button, it's just hidden. Also, it has the same icon as the "Miniplayer (i)" button, though a little bit larger.
  // So, we either need to hide the Miniplayer button and show PiP button instead, or keep both, but replace the PiP button icon with a custom one.
  const pipButton = controlsContainer.querySelector('.ytp-pip-button') as HTMLButtonElement | null;
  if (pipButton) {
    pipButton.style.display = 'initial';
    pipButton.ariaKeyShortcuts = 'p';

    const pipButtonIcon = pipButton.querySelector('svg');
    if (pipButtonIcon) {
      const defaults = {
        '--yt-delhi-pill-top-height': '8px',
      };
      pipButtonIcon.style.padding = `calc(var(--yt-delhi-pill-top-height, ${defaults["--yt-delhi-pill-top-height"]}) / 4) calc(var(--yt-delhi-pill-top-height, ${defaults["--yt-delhi-pill-top-height"]}) / 4 * 3)`;
      pipButtonIcon.style.height = `${pipButtonIcon.viewBox.baseVal.height}px`;
      pipButtonIcon.style.width = `${pipButtonIcon.viewBox.baseVal.width}px`;
    }

    // Move PiP button to right controls, before fullscreen (or AirPlay if present)
    const rightControls = controlsContainer.querySelector('.ytp-right-controls-right') as HTMLElement | null;
    if (rightControls) {
      const airplayButton = rightControls.querySelector('.ytp-remote-button');
      const fullscreenButton = rightControls.querySelector('.ytp-fullscreen-button');
      const insertBefore = airplayButton ?? fullscreenButton;

      if (insertBefore) {
        rightControls.insertBefore(pipButton, insertBefore);
      }
    }
  }

  const miniplayerButton = controlsContainer.querySelector('.ytp-miniplayer-button') as HTMLButtonElement | null;
  if (!miniplayerButton) return;

  // removing miniplayer button instead of hiding it. Otherwise, it's being made visible automatically by YouTube.
  miniplayerButton.parentElement?.removeChild(miniplayerButton);
  // miniplayerButton.style.display = 'none';
}

function log(...data: any[]): void {
  const shouldLog = false;
  if (shouldLog) {
    console.log(data);
  }
}
