/** @type {Record<string, VideoPresentationMode>} */
const PresentationMode = {
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
addCustomButtons();
observeMutations();

function enableHotkey() {
  log('enabling hotkey');

  document.addEventListener('keyup', handleKeyUp, {
    passive: true,
  });
}

function handleKeyUp(
  /** @type {KeyboardEvent} */
  event,
) {
  if (
    !(
      event.code === `Key${hotkeyUppercase}` ||
      event.key === hotkey ||
      event.key === hotkeyUppercase
    )
  )
    return;

  const hotkeyBlockingFocusedElements = ['INPUT', 'TEXTAREA'];
  /** @type {HTMLElement | null} */
  // @ts-expect-error todo? figure out a check whether activeElement is HTMLElement and not Element.
  const activeElement = document.activeElement;
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
function getVideos() {
  return document.querySelectorAll('video');
}

function togglePiPOnPage(videos = getVideos()) {
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

function togglePiPOnVideo(
  /** @type {HTMLVideoElement} */
  video,
) {
  log('toggling PiP for', video);

  if (!video.webkitSupportsPresentationMode(PresentationMode.PIP)) return; // Current browser does not support Picture in Picture

  /** @type {keyof typeof PresentationMode} */
  const currentPresentationMode = video.webkitPresentationMode;

  video.webkitSetPresentationMode(
    currentPresentationMode === PresentationMode.PIP
      ? video['lastPresentationMode'] ?? PresentationMode.INLINE
      : PresentationMode.PIP,
  );

  video['lastPresentationMode'] = currentPresentationMode;
}

/** This is needed because going fullscreen in YouTube, for example, enters a different layout view, so there would be no custom buttons. */
function observeMutations() {
  new MutationObserver(addCustomButtons).observe(document, {
    subtree: true,
    childList: true,
  });
}

function addCustomButtons() {
  const videos = getVideos();
  // @ts-expect-error NodeListOf is in fact iterable through a `for of` loop.
  for (const video of videos) {
    if (!video.src.includes('www.youtube.com')) continue;
    if (video.attributes['PiPOSSCustomButtonEnabled']) continue;

    const videoContainer = video.parentElement.parentElement;
    const controlsContainer = videoContainer.querySelector('.ytp-right-controls');

    enableBuiltinYoutubePipButton(controlsContainer);
    video.attributes['PiPOSSCustomButtonEnabled'] = 'true';
  }
}

function enableBuiltinYoutubePipButton(
  /** @type {Element | null} */
  controlsContainer,
) {
  if (!controlsContainer) return;

  log('Is youtube, gonna enable button');

  // YouTube already has a PiP button, it's just hidden. Also, it has the same icon as the "Miniplayer (i)" button, though a little bit larger.
  // So, we either need to hide the Miniplayer button and show PiP button instead, or keep both, but replace the PiP button icon with a custom one.
  /** @type {HTMLButtonElement | null} */
  const pipButton = controlsContainer.querySelector('.ytp-pip-button');
  pipButton.style.display = 'initial';
  pipButton.ariaLabel += ` (${hotkey})`;
  pipButton.title = pipButton.ariaLabel;

  /** @type {HTMLButtonElement | null} */
  const miniplayerButton = controlsContainer.querySelector('.ytp-miniplayer-button');
  if (!miniplayerButton) return;

  // removing miniplayer button instead of hiding it. Otherwise, it's being made visible automatically by YouTube.
  miniplayerButton.parentElement.removeChild(miniplayerButton);
  // miniplayerButton.style.display = 'none';
}

function log(...data) {
  const shouldLog = false;
  if (shouldLog) {
    console.log(data);
  }
}
