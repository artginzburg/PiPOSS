/** Finding the video the user means. Pure DOM reads, no WebKit. */

/**
 * In Safari this does not reach into `iframe`s, which is why the content script runs in
 * every frame (`"all_frames": true` in manifest.json).
 */
export function getVideos(root: ParentNode = document): NodeListOf<HTMLVideoElement> {
  return root.querySelectorAll('video');
}

/**
 * Picks the video a PiP toggle should act on.
 *
 * - no videos → `null`
 * - exactly one video → that one, playing or not
 * - several → the first one that is not paused, or `null` if none is playing
 */
export function pickVideo(videos: ArrayLike<HTMLVideoElement>): HTMLVideoElement | null {
  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];

  const playing = Array.from(videos).filter((video) => !video.paused);
  if (playing.length === 0) return null;
  return playing[0];
}
