/** @see https://developer.apple.com/documentation/webkitjs/htmlvideoelement/1631913-webkitpresentationmode */
type VideoPresentationMode = 'inline' | 'picture-in-picture' | 'fullscreen';

interface HTMLVideoElement {
  webkitSupportsPresentationMode: (mode: VideoPresentationMode) => boolean;
  webkitPresentationMode: VideoPresentationMode;
  webkitSetPresentationMode: (mode: VideoPresentationMode) => void;
}
