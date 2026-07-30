import { beforeEach, describe, expect, it } from 'vitest';

import { getVideos, pickVideo } from '../src/core/video';
import { definePlayback } from './helpers/video';

function makeVideo(paused: boolean): HTMLVideoElement {
  const video = document.createElement('video');
  definePlayback(video, { paused });
  return video;
}

describe('pickVideo', () => {
  it('returns null when there are no videos', () => {
    expect(pickVideo([])).toBeNull();
  });

  it('returns the only video even when it is paused', () => {
    const only = makeVideo(true);
    expect(pickVideo([only])).toBe(only);
  });

  it('returns the only video when it is playing', () => {
    const only = makeVideo(false);
    expect(pickVideo([only])).toBe(only);
  });

  it('returns the first playing video when several exist', () => {
    const first = makeVideo(true);
    const second = makeVideo(false);
    const third = makeVideo(false);
    expect(pickVideo([first, second, third])).toBe(second);
  });

  it('returns the first video when several exist and all are playing', () => {
    const first = makeVideo(false);
    const second = makeVideo(false);
    expect(pickVideo([first, second])).toBe(first);
  });

  it('returns null when several videos exist and none is playing', () => {
    expect(pickVideo([makeVideo(true), makeVideo(true)])).toBeNull();
  });
});

describe('getVideos', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds videos in document order and feeds pickVideo directly', () => {
    document.body.innerHTML = '<div><video id="a"></video></div><video id="b"></video>';
    const videos = getVideos(document);
    expect(Array.from(videos).map((video) => video.id)).toEqual(['a', 'b']);

    const b = document.getElementById('b') as HTMLVideoElement;
    Object.defineProperty(document.getElementById('a'), 'paused', { value: true });
    Object.defineProperty(b, 'paused', { value: false });
    expect(pickVideo(videos)).toBe(b);
  });

  it('returns an empty list when the document holds no video', () => {
    expect(getVideos(document).length).toBe(0);
    expect(pickVideo(getVideos(document))).toBeNull();
  });
});
