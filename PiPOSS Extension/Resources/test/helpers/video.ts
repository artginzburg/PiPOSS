/** `<video>` fixtures: playback state, and the WebKit presentation API jsdom lacks. */

export interface PlaybackState {
  paused?: boolean;
  muted?: boolean;
  /** Seconds. `NaN` models metadata that has not arrived, `Infinity` a live stream. */
  duration?: number;
}

export interface WebKitStub {
  supports?: boolean;
  mode?: VideoPresentationMode;
}

export interface StubbedVideo {
  video: HTMLVideoElement;
  /** Every mode `webkitSetPresentationMode` was called with, in order. */
  setArgs: VideoPresentationMode[];
  /** Every mode `webkitSupportsPresentationMode` was asked about, in order. */
  supportsArgs: VideoPresentationMode[];
}

/** `paused`, `muted` and `duration` are read-only getters in jsdom, so redefine them. */
export function definePlayback(video: HTMLVideoElement, state: PlaybackState = {}): void {
  Object.defineProperty(video, 'paused', { value: state.paused ?? false, configurable: true });
  Object.defineProperty(video, 'muted', { value: state.muted ?? false, configurable: true });
  Object.defineProperty(video, 'duration', { value: state.duration ?? 600, configurable: true });
}

/**
 * The WebKit presentation API the real controller drives, recorded.
 *
 * jsdom has none of it, so the real controller is verified by stubbing the members and
 * asserting that it forwards to them unchanged. We test our delegation, never WebKit
 * itself (RRR §6).
 */
export function stubWebKit(
  video: HTMLVideoElement,
  options: WebKitStub = {},
): Omit<StubbedVideo, 'video'> {
  const supportsArgs: VideoPresentationMode[] = [];
  const setArgs: VideoPresentationMode[] = [];

  video.webkitSupportsPresentationMode = (mode: VideoPresentationMode): boolean => {
    supportsArgs.push(mode);
    return options.supports ?? true;
  };
  video.webkitPresentationMode = options.mode ?? 'inline';
  video.webkitSetPresentationMode = (mode: VideoPresentationMode): void => {
    setArgs.push(mode);
    video.webkitPresentationMode = mode;
  };

  return { setArgs, supportsArgs };
}

/** A detached `<video>` with the WebKit API stubbed. */
export function makeWebKitVideo(options: WebKitStub = {}): StubbedVideo {
  const video = document.createElement('video');
  return { video, ...stubWebKit(video, options) };
}

/** The same, in `document.body` — which is where the composition root looks for one. */
export function appendVideo(options: WebKitStub & PlaybackState = {}): StubbedVideo {
  const stubbed = makeWebKitVideo(options);
  if ('paused' in options || 'muted' in options || 'duration' in options) {
    definePlayback(stubbed.video, options);
  }
  document.body.appendChild(stubbed.video);
  return stubbed;
}
