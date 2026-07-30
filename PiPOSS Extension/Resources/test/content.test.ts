/**
 * The composition root's characterisation harness (T01): the same test against both the
 * pre- and post-extraction `content.ts`.
 *
 * The module has import-time side effects — a `keyup` listener and a mutation observer —
 * so it is imported exactly once for the whole file.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { lastPresentationModeOf } from '../src/core/presentation';
import { macrotask } from './helpers/timing';
import { appendVideo, definePlayback } from './helpers/video';

/**
 * Every `MutationObserver.observe` call made in this file's realm.
 *
 * Patched at module scope rather than in a hook because the import's side effects are
 * what is being measured. It delegates faithfully and is never restored: nothing else
 * here uses a mutation observer, and the import happens once for the whole file.
 */
const observedTargets: Node[] = [];
const realObserve = MutationObserver.prototype.observe;

MutationObserver.prototype.observe = function recorded(
  this: MutationObserver,
  target: Node,
  options?: MutationObserverInit,
): void {
  observedTargets.push(target);
  realObserve.call(this, target, options);
};

function pressKey(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
}

/**
 * A player-shaped DOM with the nesting the pre-T06 code walked
 * (`video.parentElement.parentElement`) and the source it sniffed for
 * `www.youtube.com`. This file's jsdom document is on `localhost`, so this markup is the
 * *negative* case.
 */
function buildYouTubePlayer(): { pipButton: HTMLButtonElement; fullscreen: HTMLButtonElement } {
  document.body.innerHTML = `
    <div class="html5-video-player">
      <div class="html5-video-container">
        <video src="https://www.youtube.com/watch?v=x"></video>
      </div>
      <div class="ytp-chrome-bottom">
        <div class="ytp-right-controls">
          <button class="ytp-pip-button" data-priority="8" style="display: none"><svg></svg></button>
          <div class="ytp-right-controls-right">
            <button class="ytp-fullscreen-button" data-priority="12"></button>
          </div>
        </div>
      </div>
    </div>`;

  return {
    pipButton: document.querySelector('.ytp-pip-button') as HTMLButtonElement,
    fullscreen: document.querySelector('.ytp-fullscreen-button') as HTMLButtonElement,
  };
}

beforeAll(async () => {
  await import('../src/content');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('hotkey wiring', () => {
  it('toggles PiP on a lowercase p', () => {
    const { setArgs, video } = appendVideo();
    pressKey({ key: 'p', code: 'KeyP' });
    expect(setArgs).toEqual(['picture-in-picture']);
    expect(lastPresentationModeOf(video)).toBe('inline');
  });

  it('toggles PiP on an uppercase P with no code', () => {
    const { setArgs } = appendVideo();
    pressKey({ key: 'P' });
    expect(setArgs).toEqual(['picture-in-picture']);
  });

  it('toggles PiP on code KeyP even when the key is a different layout', () => {
    const { setArgs } = appendVideo();
    pressKey({ key: 'з', code: 'KeyP' });
    expect(setArgs).toEqual(['picture-in-picture']);
  });

  it('ignores other keys', () => {
    const { setArgs } = appendVideo();
    pressKey({ key: 'q', code: 'KeyQ' });
    expect(setArgs).toEqual([]);
  });

  it('ignores the hotkey while an input is focused', () => {
    const { setArgs } = appendVideo();
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    pressKey({ key: 'p', code: 'KeyP' });
    expect(setArgs).toEqual([]);
  });

  it('ignores the hotkey while a textarea is focused', () => {
    const { setArgs } = appendVideo();
    const textarea = document.body.appendChild(document.createElement('textarea'));
    textarea.focus();
    pressKey({ key: 'p', code: 'KeyP' });
    expect(setArgs).toEqual([]);
  });

  it('ignores the hotkey while a contenteditable element is focused', () => {
    const { setArgs } = appendVideo();
    const editable = document.body.appendChild(document.createElement('div'));
    editable.contentEditable = 'true';
    // jsdom does not implement editing, so isContentEditable is always false.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    editable.tabIndex = 0;
    editable.focus();
    pressKey({ key: 'p', code: 'KeyP' });
    expect(setArgs).toEqual([]);
  });

  it('does nothing when the page has no video', () => {
    expect(() => pressKey({ key: 'p', code: 'KeyP' })).not.toThrow();
  });

  it('acts on the first playing video when several are present', () => {
    const paused = appendVideo();
    const playing = appendVideo();
    definePlayback(paused.video, { paused: true });
    definePlayback(playing.video, { paused: false });

    pressKey({ key: 'p', code: 'KeyP' });

    expect(paused.setArgs).toEqual([]);
    expect(playing.setArgs).toEqual(['picture-in-picture']);
  });

  it('restores the previous mode on the second press', () => {
    const { setArgs, video } = appendVideo();
    pressKey({ key: 'p', code: 'KeyP' });
    pressKey({ key: 'p', code: 'KeyP' });
    expect(setArgs).toEqual(['picture-in-picture', 'inline']);
    // The record is written only on the way in, so the second press leaves the mode the
    // first press entered from (BF01). `presentation.test.ts` owns why.
    expect(lastPresentationModeOf(video)).toBe('inline');
  });

  it('does nothing when the video does not support PiP', () => {
    const { setArgs, video } = appendVideo({ supports: false });
    pressKey({ key: 'p', code: 'KeyP' });
    expect(setArgs).toEqual([]);
    expect(lastPresentationModeOf(video)).toBeUndefined();
  });
});

/**
 * What only the composition root can answer: this document is on `localhost`, so **none
 * of the YouTube path happens**. The old code decided by looking at `video.src`, which on
 * a real watch page is a blob URL carrying the origin as text — so it fired on any page
 * with a video whose source mentioned `www.youtube.com`, including this fixture.
 *
 * The four assertions T06 made obsolete were not deleted but moved: they live in
 * `test/youtube.test.ts`, where each is still true of the new implementation.
 */
describe('the YouTube path does nothing off YouTube (RRR §4.5)', () => {
  it('leaves a player-shaped DOM completely alone on a non-YouTube hostname', async () => {
    const { pipButton, fullscreen } = buildYouTubePlayer();

    await macrotask();

    expect(document.location.hostname).not.toContain('youtube');
    expect(pipButton.style.getPropertyValue('display')).toBe('none');
    expect(pipButton.getAttribute('aria-keyshortcuts')).toBeNull();
    expect(pipButton.parentElement?.className).toBe('ytp-right-controls');
    expect(fullscreen.parentElement?.className).toBe('ytp-right-controls-right');
    expect(pipButton.querySelector('svg')?.getAttribute('style')).toBeNull();
    expect(document.querySelector('video')?.dataset.pipossCustomButtonEnabled).toBeUndefined();
  });

  it('keeps ignoring it however much the page mutates', async () => {
    const { pipButton } = buildYouTubePlayer();
    await macrotask();

    for (let mutation = 0; mutation < 50; mutation += 1) {
      document.body.appendChild(document.createElement('div'));
    }
    await macrotask();

    expect(pipButton.style.getPropertyValue('display')).toBe('none');
  });

  /**
   * DECISIONS 134: off YouTube the page is not merely left alone, it is **not watched at
   * all**. Dropping the `binding.active` gate in `content.ts` keeps both tests above
   * green — the inert binding's `refresh` does nothing — while putting a whole-document
   * `childList` observer on every page on the web for a consumer with nothing to do.
   * Nothing else in the project fails if that gate goes; this does.
   */
  it('installs no mutation observer at all on a non-YouTube page (RRR §5.3)', () => {
    expect(document.location.hostname).not.toContain('youtube');
    expect(observedTargets).toEqual([]);
  });
});
