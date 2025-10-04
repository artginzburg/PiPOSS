/**
 * WebKit-specific type definitions for Safari
 * @see https://developer.apple.com/documentation/webkitjs
 */

/** @see https://developer.apple.com/documentation/webkitjs/htmlvideoelement/1631913-webkitpresentationmode */
type VideoPresentationMode = 'inline' | 'picture-in-picture' | 'fullscreen';

/**
 * WebKit extensions to HTMLVideoElement
 * @see https://developer.apple.com/documentation/webkitjs/htmlvideoelement
 */
interface HTMLVideoElement {
  /** Checks whether the video element supports a presentation mode */
  webkitSupportsPresentationMode(mode: VideoPresentationMode): boolean;

  /** The current presentation mode for video playback */
  webkitPresentationMode: VideoPresentationMode;

  /** Sets the presentation mode for video playback */
  webkitSetPresentationMode(mode: VideoPresentationMode): void;
}
