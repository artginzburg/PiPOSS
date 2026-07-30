/**
 * WebKit-specific type definitions for Safari
 * @see https://developer.apple.com/documentation/webkitjs
 */

/** @see https://developer.apple.com/documentation/webkitjs/htmlvideoelement/1631913-webkitpresentationmode */
type VideoPresentationMode = 'inline' | 'picture-in-picture' | 'fullscreen';

/**
 * WebKit's report that a video moved between presentations. Plain `Event`, because it carries
 * no payload beyond `target`; the mode is read back from `webkitPresentationMode`.
 *
 * This map does **not** spell-check the event name on its own — `addEventListener` keeps a
 * `(type: string, …)` overload. `core/presentation.ts`'s `satisfies` at the single use site is
 * what rejects a misspelling, and carries the measurement.
 */
interface HTMLVideoElementEventMap {
  webkitpresentationmodechanged: Event;
}

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

  /**
   * PiPOSS's own `data-*` keys. Declared here because the composition root is a module now, so
   * a module-local `interface HTMLVideoElement` would no longer augment the global one. Kept
   * closed on purpose: that is what makes `tsc` the enforcement for
   * `test/presentation.test.ts`'s data-key gate.
   */
  dataset: {
    pipossCustomButtonEnabled?: `${boolean}`;
  };
}

/* ------------------------------------------------------------------------- *
 * The document's fullscreen state (BF19). The WebKit-only names, because `lib.dom` has
 * neither: `webkitFullscreenElement` and `webkitRequestFullscreen` are what macOS 11's Safari
 * 14 has, the unprefixed pair is what Safari 26 delivers. Both optional, the honest shape at
 * this floor. Why the video's presentation mode is not enough — see
 * `PresentationController.onFullscreenChange`, which carries the measurement.
 * ------------------------------------------------------------------------- */
interface Document {
  readonly webkitFullscreenElement?: Element | null;
}

interface Element {
  readonly webkitRequestFullscreen?: () => void;
}
