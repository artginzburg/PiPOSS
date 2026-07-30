/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://www.youtube.com/watch?v=piposs" }
 */

/**
 * RRR §4.5 — YouTube's own PiP button, un-hidden and placed. The always-on guard for the
 * five design rules measured in `docs/research/youtube-player-2026-07.md`.
 *
 * Deliberately **not** here: RRR §5.1's ±1 px rendered-box invariant, which needs real
 * layout that jsdom does not perform — a geometry assertion that cannot fail is worse than
 * none, so that is `test/live/`'s job. What this file guards instead is the absence of
 * geometry *writes*, which is the actual defect: the old code compensated for a size
 * difference that no longer exists and collapsed the glyph to a sliver.
 *
 * Three load-bearing facts about how these tests are built:
 *
 * 1. **The environment options above put the document on a real YouTube hostname**, and
 *    the module reads the hostname off the document it was handed — so the positive path
 *    needs no stubbing. The negative path uses `createHTMLDocument()`, whose `location` is
 *    `null` (jsdom makes `document.location` non-configurable, so it cannot be faked); the
 *    hostname *rule* is pinned exhaustively on {@link isYouTubeHost}.
 * 2. **`Node.prototype.insertBefore` is bounded for the whole file.** Deleting the old
 *    implementation's idempotency guard made vitest hang for ever rather than fail
 *    (DECISIONS 32): `insertBefore` is itself a childList mutation, so an unthrottled
 *    whole-document observer re-enters and starves the event loop. T07 put every hop on an
 *    animation frame, so a timeout *can* now fire, but the budget stays because it names
 *    the defect and fails in milliseconds. Its limit: it bounds `insertBefore` only, so a
 *    re-entrant loop mutating the DOM another way still hangs outright.
 * 3. **The `describe` that imports `src/content` is last** (DECISIONS 90): that import
 *    attaches a `keyup` listener and a mutation observer that are never detached, and jsdom
 *    shares one document per file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONTENT_SCRIPT_FRAME_FLAG } from '../src/core/inject';
import {
  FakePresentationController,
  PresentationMode,
  lastPresentationModeOf,
} from '../src/core/presentation';
import { SETTINGS_KEY, saveSettings } from '../src/core/settings';
import { type YouTubeButtonBinding, isYouTubeHost, mountYouTubeButton } from '../src/sites/youtube';
import { hangReads, installFakeBrowser, uninstallFakeBrowser } from './helpers/fake-browser';
import { frame, macrotask } from './helpers/timing';
import { stubWebKit } from './helpers/video';

const FIXTURE = readFileSync(
  join(import.meta.dirname, 'fixtures/youtube-right-controls.html'),
  'utf8',
);

const YOUTUBE_SOURCE = readFileSync(join(import.meta.dirname, '../src/sites/youtube.ts'), 'utf8');

/** See point 2 above. Far above anything a correct run needs. */
const INSERT_BEFORE_BUDGET = 200;

interface Player {
  doc: Document;
  player: HTMLElement;
  pip: HTMLElement;
  rightControls: HTMLElement;
  rightControlsRight: HTMLElement;
  size: HTMLElement;
  remote: HTMLElement;
  fullscreen: HTMLElement;
  video: HTMLVideoElement;
}

/** The captured player, in the ambient document — which is on a YouTube URL. */
function loadPlayers(copies = 1): Player[] {
  document.body.innerHTML = new Array(copies).fill(FIXTURE).join('\n');

  return Array.from(document.querySelectorAll('.html5-video-player')).map((player) =>
    describePlayer(player as HTMLElement),
  );
}

/** The same player in a document that has no location at all — see point 1. */
function loadDetachedPlayer(): Player {
  const doc = document.implementation.createHTMLDocument('player');
  doc.body.innerHTML = FIXTURE;
  return describePlayer(doc.body.querySelector('.html5-video-player') as HTMLElement);
}

function describePlayer(player: HTMLElement): Player {
  const pick = <T extends Element>(selector: string): T => player.querySelector(selector) as T;

  return {
    doc: player.ownerDocument,
    player,
    pip: pick<HTMLElement>('.ytp-pip-button'),
    rightControls: pick<HTMLElement>('.ytp-right-controls'),
    rightControlsRight: pick<HTMLElement>('.ytp-right-controls-right'),
    size: pick<HTMLElement>('.ytp-size-button'),
    remote: pick<HTMLElement>('.ytp-remote-button'),
    fullscreen: pick<HTMLElement>('.ytp-fullscreen-button'),
    video: pick<HTMLVideoElement>('video'),
  };
}

function onePlayer(): Player {
  return loadPlayers()[0];
}

/** Every element in `root`'s subtree that carries at least one inline style property. */
function inlineStyled(root: Element): string[] {
  const styled: string[] = [];
  const elements = [root].concat(Array.from(root.querySelectorAll('*')));

  for (const element of elements) {
    const style = (element as Partial<ElementCSSInlineStyle>).style;
    if (!style || style.length === 0) continue;

    const properties: string[] = [];
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item(index);
      properties.push(`${property}: ${style.getPropertyValue(property)}`);
    }
    styled.push(`${element.localName}.${element.className}{${properties.join('; ')}}`);
  }

  return styled;
}

/** Records what a style declaration was asked to remove, without changing behaviour. */
function watchRemoveProperty(element: HTMLElement): string[] {
  const removed: string[] = [];
  const real = element.style.removeProperty.bind(element.style);

  element.style.removeProperty = (property: string): string => {
    removed.push(property);
    return real(property);
  };

  return removed;
}

/**
 * Records every listener registration on one element, without changing behaviour.
 *
 * The DOM's own de-duplication — `addEventListener` ignores a callback identical to one
 * already registered — is what keeps repeated mounts from piling up handlers, and nothing
 * observable distinguishes one handler from twenty when the first stops the event. So the
 * *mechanism* has to be asserted: the same function reference every time.
 */
function watchAddEventListener(element: HTMLElement): EventListenerOrEventListenerObject[] {
  const registered: EventListenerOrEventListenerObject[] = [];
  const real = element.addEventListener.bind(element);

  element.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    // A null listener registers nothing in the DOM either, so dropping it here keeps the
    // recorded list free of things that were never attached.
    if (listener === null) return;

    if (type === 'click') registered.push(listener);
    real(type, listener, options);
  };

  return registered;
}

function click(element: Element): void {
  const view = element.ownerDocument.defaultView ?? window;
  element.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true }));
}

let bindings: YouTubeButtonBinding[] = [];
let insertBeforeCalls = 0;
let realInsertBefore: Node['insertBefore'];

/** Mounts, waits for the stored setting, and remembers the binding for `afterEach`. */
async function mount(
  doc: Document,
  controller: FakePresentationController,
): Promise<YouTubeButtonBinding> {
  const binding = mountYouTubeButton(doc, controller);
  bindings.push(binding);
  await binding.ready;
  return binding;
}

beforeEach(() => {
  insertBeforeCalls = 0;
  realInsertBefore = Node.prototype.insertBefore;

  Node.prototype.insertBefore = function bounded<T extends Node>(
    this: Node,
    node: T,
    child: Node | null,
  ): T {
    insertBeforeCalls += 1;
    if (insertBeforeCalls > INSERT_BEFORE_BUDGET) {
      throw new Error(
        `insertBefore called more than ${INSERT_BEFORE_BUDGET} times in one test — this is the ` +
          'DECISIONS 32 re-entrant-observer loop, failing instead of hanging the suite.',
      );
    }
    return realInsertBefore.call(this, node, child) as T;
  };

  document.body.innerHTML = '';
  installFakeBrowser();
});

afterEach(() => {
  Node.prototype.insertBefore = realInsertBefore;

  for (const binding of bindings) binding.disable();
  bindings = [];

  uninstallFakeBrowser();
  document.body.innerHTML = '';
});

describe('detection from the hostname, not from video.src (RRR §4.5)', () => {
  it('accepts youtube.com, its subdomains and the no-cookie embed host', () => {
    for (const hostname of [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'WWW.YOUTUBE.COM',
      'www.youtube-nocookie.com',
    ]) {
      expect(isYouTubeHost(hostname), hostname).toBe(true);
    }
  });

  it('rejects everything else, including hosts that merely contain the name', () => {
    for (const hostname of [
      '',
      'example.com',
      'notyoutube.com',
      'youtube.com.evil.example',
      'youtube.evil.example',
      'fakeyoutube-nocookie.com',
      'youtube.com.',
    ]) {
      expect(isYouTubeHost(hostname), hostname).toBe(false);
    }
  });

  it('is what the fixture proves video.src cannot do', () => {
    // The old check was `video.src.includes('www.youtube.com')`: on a watch page the source
    // is a blob URL that happens to carry the origin, so it passed by accident and would
    // fail for the same player on youtube-nocookie.com or driven by MediaSource.
    expect(onePlayer().video.src).toMatch(/^blob:/);
  });

  it('mounts nothing on a document that is not YouTube', async () => {
    const fake = installFakeBrowser();
    const { doc, pip, rightControls } = loadDetachedPlayer();

    const binding = await mount(doc, new FakePresentationController());

    expect(doc.location).toBeNull();
    expect(binding.active).toBe(false);
    expect(pip.style.getPropertyValue('display')).toBe('none');
    expect(pip.parentElement).toBe(rightControls);

    // Not even a settings subscription: every page on the internet that is not YouTube
    // pays for this module, so it must cost nothing at all.
    expect(fake.storage.onChanged.listenerCount).toBe(0);
    expect(() => {
      binding.refresh();
    }).not.toThrow();
    expect(pip.style.getPropertyValue('display')).toBe('none');
  });
});

describe('un-hiding: remove the property, never assign a value (rule 2)', () => {
  it('removes the inline display declaration YouTube set', async () => {
    const { doc, pip } = onePlayer();
    const removed = watchRemoveProperty(pip);

    await mount(doc, new FakePresentationController());

    expect(removed).toContain('display');
    expect(pip.style.getPropertyValue('display')).toBe('');
    expect(pip.getAttribute('style')).not.toContain('display');
    // Assigning `initial`, `block` or anything else would leave a property behind.
    expect(pip.style.length).toBe(0);
  });

  it('leaves the icon and the tooltip exactly as YouTube shipped them (rule 4)', async () => {
    const { doc, pip } = onePlayer();
    const icon = pip.querySelector('svg') as SVGElement;
    const iconBefore = icon.outerHTML;

    await mount(doc, new FakePresentationController());

    expect(icon.outerHTML).toBe(iconBefore);
    expect(icon.getAttribute('style')).toBeNull();
    expect(pip.dataset.tooltipTitle).toBe('Picture-in-picture');
  });

  it('announces the configured hotkey instead of hardcoding one', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { hotkey: 'k' } } });
    const { doc, pip } = onePlayer();

    await mount(doc, new FakePresentationController());

    // The attribute, not the `ariaKeyShortcuts` property the old code assigned: reflection
    // is newer than the attribute and its absence is silent. It is also the only assertion
    // that *can* fail — an assignment to an unsupported property still reads back from the
    // object it landed on.
    expect(pip.getAttribute('aria-keyshortcuts')).toBe('k');

    await saveSettings({ hotkey: '' });
    await macrotask();

    // Hotkey disabled: the claim is withdrawn rather than left pointing at a dead key.
    expect(pip.getAttribute('aria-keyshortcuts')).toBeNull();
  });
});

describe('placement is derived from data-priority (rule 3)', () => {
  it('lands first inside .ytp-right-controls-right, ahead of the size button', async () => {
    const { doc, pip, rightControlsRight, size } = onePlayer();

    await mount(doc, new FakePresentationController());

    expect(pip.parentElement).toBe(rightControlsRight);
    expect(pip.nextElementSibling).toBe(size);
    expect(
      Array.from(rightControlsRight.children).map((child) => child.getAttribute('data-priority')),
    ).toEqual(['8', '9', '10', '12']);
  });

  it('appends when no sibling outranks it', async () => {
    const { doc, pip, rightControlsRight, size, remote, fullscreen } = onePlayer();
    for (const button of [size, remote, fullscreen]) {
      // All outranked *by* PiP, so the player's own statement of order is "last".
      button.setAttribute('data-priority', '1');
    }

    await mount(doc, new FakePresentationController());

    expect(pip.parentElement).toBe(rightControlsRight);
    expect(pip.nextElementSibling).toBeNull();
    expect(pip.previousElementSibling).toBe(fullscreen);
  });

  it('skips siblings that carry no priority rather than stopping at them', async () => {
    const { doc, pip, rightControlsRight, size } = onePlayer();
    const unranked = doc.createElement('button');
    unranked.className = 'ytp-unknown-button ytp-button';
    rightControlsRight.insertBefore(unranked, size);

    await mount(doc, new FakePresentationController());

    // An unranked first child must not read as "nothing outranks us, append".
    expect(pip.nextElementSibling).toBe(size);
    expect(pip.previousElementSibling).toBe(unranked);
  });

  it('leaves a button whose own priority cannot be read where the player put it', async () => {
    // Absent, empty and unparseable are one case: there is no rank to order by.
    for (const rank of [null, '', '   ', 'first']) {
      const where = `data-priority=${JSON.stringify(rank)}`;
      const { doc, pip, rightControls, rightControlsRight } = onePlayer();

      if (rank === null) pip.removeAttribute('data-priority');
      else pip.setAttribute('data-priority', rank);

      await mount(doc, new FakePresentationController());

      // Still un-hidden and still clickable: unplaceable is not unusable, and guessing a
      // position is exactly the hardcoding this rewrite removed.
      expect(pip.style.length, where).toBe(0);
      expect(pip.parentElement, where).toBe(rightControls);
      expect(rightControlsRight.contains(pip), where).toBe(false);
    }
  });

  it('re-places a button the player has moved within the group', async () => {
    const { doc, pip, rightControlsRight, size, fullscreen } = onePlayer();
    const binding = await mount(doc, new FakePresentationController());

    // Still inside the right group, wrong position: the half of the already-in-place guard
    // a parent check alone cannot see, and nothing else here moves the button within its
    // group.
    rightControlsRight.appendChild(pip);
    expect(pip.previousElementSibling).toBe(fullscreen);

    binding.refresh();

    expect(pip.nextElementSibling).toBe(size);
  });

  it('places each player independently on a page that has several', async () => {
    const players = loadPlayers(2);
    const controller = new FakePresentationController();

    await mount(document, controller);

    for (const each of players) {
      expect(each.pip.parentElement).toBe(each.rightControlsRight);
      expect(each.pip.nextElementSibling).toBe(each.size);
    }

    // And each button toggles its own player's video — the `closest` walk that replaced
    // `parentElement.parentElement` (RRR §4.5).
    click(players[1].pip);

    expect(players[1].video).not.toBe(players[0].video);
    expect(controller.setModeCalls).toEqual([
      { video: players[1].video, mode: PresentationMode.PIP },
    ]);
  });
});

describe('idempotency across repeated runs', () => {
  it('writes to the DOM once however many times it runs', async () => {
    const { doc, pip, rightControlsRight, size } = onePlayer();

    const binding = await mount(doc, new FakePresentationController());
    const afterFirstRun = insertBeforeCalls;

    for (let run = 0; run < 20; run += 1) binding.refresh();

    expect(insertBeforeCalls).toBe(afterFirstRun);
    expect(pip.parentElement).toBe(rightControlsRight);
    expect(pip.nextElementSibling).toBe(size);
    expect(pip.style.length).toBe(0);
  });

  it('attaches exactly one click handler, so one click is one toggle', async () => {
    const { doc, pip, player, video } = onePlayer();
    const controller = new FakePresentationController();
    // On the player, which is where the capture listener lives.
    const registered = watchAddEventListener(player);

    const binding = await mount(doc, controller);
    for (let run = 0; run < 20; run += 1) binding.refresh();

    click(pip);

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);

    // Every registration passed the *same* function, which is the only reason the DOM
    // collapsed 21 of them into one. A fresh closure per run would leave 21 live listeners
    // and still pass the assertion above, because the first to run stops the event.
    expect(registered.length).toBeGreaterThan(1);
    expect(new Set(registered).size).toBe(1);
  });

  it('re-hides and re-places a button the player has taken back', async () => {
    const { doc, pip, rightControls, rightControlsRight, size } = onePlayer();
    const binding = await mount(doc, new FakePresentationController());

    // What a layout change looks like: YouTube hides the button again and moves it.
    pip.style.setProperty('display', 'none');
    rightControls.appendChild(pip);

    binding.refresh();

    expect(pip.style.length).toBe(0);
    expect(pip.parentElement).toBe(rightControlsRight);
    expect(pip.nextElementSibling).toBe(size);
  });
});

describe('the module writes no geometry (rule 1, RRR §5.4)', () => {
  it('leaves not one inline style property behind anywhere in the player', async () => {
    const { doc, player } = onePlayer();

    // The captured player's only inline style is the `display: none` on the PiP button, so
    // after a correct mount the whole subtree carries none at all.
    expect(inlineStyled(player)).toEqual(['button.ytp-pip-button ytp-button{display: none}']);

    await mount(doc, new FakePresentationController());

    expect(inlineStyled(player)).toEqual([]);
  });

  it('leaves the glyph sizing attributes untouched', async () => {
    const { doc, pip } = onePlayer();
    const icon = pip.querySelector('svg') as SVGElement;

    await mount(doc, new FakePresentationController());

    expect(icon.getAttribute('width')).toBe('24');
    expect(icon.getAttribute('height')).toBe('24');
    expect(icon.getAttribute('style')).toBeNull();
  });
});

describe('the youtubeButton setting, live (RRR §3)', () => {
  it('is on by default, with nothing stored', async () => {
    const { doc, pip, rightControlsRight } = onePlayer();

    await mount(doc, new FakePresentationController());

    expect(pip.style.length).toBe(0);
    expect(pip.parentElement).toBe(rightControlsRight);
  });

  it('mounts nothing when it is off', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { youtubeButton: false } } });
    const { doc, pip, rightControls, video } = onePlayer();
    const controller = new FakePresentationController();

    await mount(doc, controller);

    expect(pip.style.getPropertyValue('display')).toBe('none');
    expect(pip.parentElement).toBe(rightControls);

    click(pip);
    expect(controller.setModeCalls).toEqual([]);
    expect(lastPresentationModeOf(video)).toBeUndefined();
  });

  it('takes effect the moment it is switched on', async () => {
    installFakeBrowser({ items: { [SETTINGS_KEY]: { youtubeButton: false } } });
    const { doc, pip, rightControlsRight, size } = onePlayer();

    await mount(doc, new FakePresentationController());
    expect(pip.style.getPropertyValue('display')).toBe('none');

    await saveSettings({ youtubeButton: true });
    await macrotask();

    expect(pip.style.length).toBe(0);
    expect(pip.parentElement).toBe(rightControlsRight);
    expect(pip.nextElementSibling).toBe(size);
  });

  it('discards a stored value that a live change has already overtaken', async () => {
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { youtubeButton: true } } });
    const release = hangReads(fake);
    const { doc, pip } = onePlayer();

    const binding = mountYouTubeButton(doc, new FakePresentationController());
    bindings.push(binding);

    // The options page switches the button off while our read is still in flight.
    fake.storage.onChanged.emit({ [SETTINGS_KEY]: { newValue: { youtubeButton: false } } });
    expect(pip.style.getPropertyValue('display')).toBe('none');

    release({ [SETTINGS_KEY]: { youtubeButton: true } });
    await binding.ready;

    // That read carries the value from *before* the change, so applying it would undo what
    // the user just did — a button reappearing a moment after they dismissed it
    // (DECISIONS 85).
    expect(pip.style.getPropertyValue('display')).toBe('none');
  });

  it('restores the player’s own hidden state the moment it is switched off', async () => {
    const { doc, pip, video } = onePlayer();
    const controller = new FakePresentationController();

    await mount(doc, controller);

    await saveSettings({ youtubeButton: false });
    await macrotask();

    expect(pip.style.getPropertyValue('display')).toBe('none');
    expect(pip.getAttribute('aria-keyshortcuts')).toBeNull();

    click(pip);
    expect(controller.setModeCalls).toEqual([]);
    expect(lastPresentationModeOf(video)).toBeUndefined();
  });

  it('still restores the hidden state after the observer has re-run the mount', async () => {
    const { doc, pip } = onePlayer();

    const binding = await mount(doc, new FakePresentationController());

    // The production observer does this dozens of times per page, and each re-run re-reads
    // an inline declaration that is now empty *because we removed it* — so a capture that
    // is not once-only records nothing, and switching the setting off leaves the button
    // visible instead of restoring it.
    for (let run = 0; run < 5; run += 1) binding.refresh();

    await saveSettings({ youtubeButton: false });
    await macrotask();

    expect(pip.style.getPropertyValue('display')).toBe('none');
  });

  it('does nothing at all until the stored setting has arrived', async () => {
    const fake = installFakeBrowser({ items: { [SETTINGS_KEY]: { youtubeButton: true } } });
    const release = hangReads(fake);
    const { doc, pip } = onePlayer();

    const binding = mountYouTubeButton(doc, new FakePresentationController());
    bindings.push(binding);

    // Whatever wakes us in this window — and the observer fires constantly during page
    // load — the answer is nothing. Acting on the default would mean DOM surgery on the
    // page of a user who switched the button off, then visibly undoing it.
    binding.refresh();
    binding.refresh();
    expect(pip.style.getPropertyValue('display')).toBe('none');

    release({ [SETTINGS_KEY]: { youtubeButton: true } });
    await binding.ready;

    expect(pip.style.length).toBe(0);
  });

  it('replays whatever the player had there, rather than a value of its own', async () => {
    const { doc, pip } = onePlayer();
    // Not `none`: the module must know no CSS value at all, so switching the setting off
    // has to give back exactly what it found. The §5.4 gate below catches only a hardcoded
    // *number*, so this is the assertion that stands in for it on keywords.
    pip.style.setProperty('display', 'inline-block');

    await mount(doc, new FakePresentationController());
    expect(pip.style.length).toBe(0);

    await saveSettings({ youtubeButton: false });
    await macrotask();

    expect(pip.style.getPropertyValue('display')).toBe('inline-block');
  });
});

describe('clicking toggles PiP through the injected controller', () => {
  it('enters on the first click and restores on the second', async () => {
    const { doc, pip, video } = onePlayer();
    const controller = new FakePresentationController();

    await mount(doc, controller);

    click(pip);
    click(pip);

    expect(controller.setModeCalls).toEqual([
      { video, mode: PresentationMode.PIP },
      { video, mode: PresentationMode.INLINE },
    ]);
  });

  it('does nothing on a video that does not support PiP', async () => {
    const { doc, pip } = onePlayer();
    const controller = new FakePresentationController({ supported: false });

    await mount(doc, controller);
    click(pip);

    expect(controller.setModeCalls).toEqual([]);
  });

  /**
   * The two measurements that decided where the listener goes. jsdom implements event
   * propagation to spec, so these measure the mechanism rather than stand in for it — and in
   * both, the YouTube-like handler is registered *before* mounting, because that is the real
   * order on a watch page: we un-hide a button they have already wired.
   *
   * The second is the one the *choice of element* rests on: a capturing listener on the
   * button would pass the first and lose the second.
   */
  it('runs instead of YouTube’s own button handler, not in addition to it', async () => {
    const { doc, pip, video } = onePlayer();
    const controller = new FakePresentationController();

    let youtubesOwnHandler = 0;
    pip.addEventListener('click', () => {
      youtubesOwnHandler += 1;
    });

    await mount(doc, controller);
    click(pip);

    // Both halves matter: theirs must not run (two handlers would drive PiP twice through
    // two different APIs), and ours must.
    expect(youtubesOwnHandler).toBe(0);
    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('wins against a handler delegated to an ancestor of the button, in capture', async () => {
    // Why the listener is on the *player* and not the button: who runs first is decided by
    // the capture flag rather than the element, but between two *capturing* listeners the
    // higher node wins, and the player is the highest node we control. Delegating control
    // handling to `.ytp-chrome-controls` is something YouTube may do without announcing it.
    const { doc, pip, video } = onePlayer();
    const controller = new FakePresentationController();
    const chromeControls = document.querySelector('.ytp-chrome-controls') as HTMLElement;

    let youtubesDelegatedHandler = 0;
    chromeControls.addEventListener(
      'click',
      () => {
        youtubesDelegatedHandler += 1;
      },
      true,
    );

    await mount(doc, controller);
    click(pip);

    expect(youtubesDelegatedHandler).toBe(0);
    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('keeps the click away from the player’s delegated handlers too', async () => {
    const { doc, pip, player, rightControls } = onePlayer();
    const reached: string[] = [];
    player.addEventListener('click', () => reached.push('player (bubble)'));
    rightControls.addEventListener('click', () => reached.push('right controls'));
    document.addEventListener('click', () => reached.push('document'), { once: true });

    await mount(doc, new FakePresentationController());
    click(pip);

    expect(reached).toEqual([]);
  });

  it('leaves every other control in the player alone', async () => {
    // The listener is on the player, so it sees every click inside it. Nothing but our own
    // button may be affected: this is the cost of the capture hook, and its containment.
    const { doc, size, fullscreen, remote } = onePlayer();
    const controller = new FakePresentationController();
    const reached: string[] = [];

    await mount(doc, controller);

    for (const other of [size, fullscreen, remote]) {
      other.addEventListener('click', (event) => {
        reached.push(other.className);
        expect(event.defaultPrevented).toBe(false);
      });
      click(other);
    }

    expect(reached).toEqual([
      'ytp-size-button ytp-button',
      'ytp-fullscreen-button ytp-button',
      'ytp-remote-button ytp-button',
    ]);
    expect(controller.setModeCalls).toEqual([]);
  });

  it('answers a click that landed on the glyph inside the button', async () => {
    const { doc, pip, video } = onePlayer();
    const controller = new FakePresentationController();

    await mount(doc, controller);
    // What a real pointer hits: the `<svg>`, or a `<path>` inside it.
    click(pip.querySelector('path') as unknown as Element);

    expect(controller.setModeCalls).toEqual([{ video, mode: PresentationMode.PIP }]);
  });

  it('survives a player whose video has gone away', async () => {
    const { doc, pip, video } = onePlayer();
    const controller = new FakePresentationController();

    await mount(doc, controller);
    video.remove();

    expect(() => {
      click(pip);
    }).not.toThrow();
    expect(controller.setModeCalls).toEqual([]);
  });
});

describe('degrading silently on a player that is not the captured one', () => {
  it('does nothing when the player has no PiP button at all', async () => {
    const { doc, pip, rightControlsRight } = onePlayer();
    pip.remove();

    const binding = await mount(doc, new FakePresentationController());
    binding.refresh();

    expect(binding.active).toBe(true);
    expect(rightControlsRight.children).toHaveLength(3);
  });

  it('does nothing on a YouTube page with no player at all', async () => {
    document.body.innerHTML = '<div id="content">no player here yet</div>';

    const binding = await mount(document, new FakePresentationController());

    expect(() => {
      binding.refresh();
    }).not.toThrow();
    expect(document.body.innerHTML).toBe('<div id="content">no player here yet</div>');
  });

  it('un-hides even when the right-hand control group is missing', async () => {
    const { doc, pip, rightControls, rightControlsRight } = onePlayer();
    rightControlsRight.remove();

    await mount(doc, new FakePresentationController());

    expect(pip.style.length).toBe(0);
    expect(pip.parentElement).toBe(rightControls);
  });

  it('stops touching the DOM once disabled, and detaches its subscription', async () => {
    const fake = installFakeBrowser();
    const { doc, pip, rightControlsRight } = onePlayer();
    const binding = await mount(doc, new FakePresentationController());

    expect(fake.storage.onChanged.listenerCount).toBe(1);

    binding.disable();
    binding.disable(); // idempotent
    pip.style.setProperty('display', 'none');
    binding.refresh();

    expect(pip.style.getPropertyValue('display')).toBe('none');

    // Two separate claims: the `enabled` flag alone would satisfy the second and leave a
    // listener attached for the life of the page.
    expect(fake.storage.onChanged.listenerCount).toBe(0);
    await saveSettings({ youtubeButton: false });
    await macrotask();
    expect(rightControlsRight.contains(pip)).toBe(true);
  });
});

/**
 * RRR §5.4's static gate: **no numeric literal describing YouTube's layout may appear in
 * `src/sites/youtube.ts`**. Every pixel constant the old code carried was a promise about a
 * stylesheet we do not own, and all of them had expired.
 *
 * The split into three checks is the point: the first two read the file **raw, comments
 * included**, so the gate cannot be satisfied by commenting a constant out or restating it
 * in prose; the third reads it with comments and string literals removed, where the rule can
 * be absolute — no digit at all. That is stronger than a list of banned units because it
 * catches the shape the old bug had: a bare `24` and `36` divided into a half-difference,
 * with no unit anywhere near them.
 *
 * **What it cannot do**, so nobody rediscovers it as a surprise: it reads one file as text,
 * so a constant assembled in a template literal, produced by `String.fromCharCode`, spelled
 * as a word, imported, or written elsewhere gets past — as does a CSS *keyword*, which
 * carries no digit. Acceptable only because this is the second line of defence: rule 1's
 * whole-subtree assertion above catches anything that actually reaches the DOM.
 */
describe('no YouTube geometry constants in the module (RRR §5.4)', () => {
  /**
   * Strips comments, and asserts the assumption that makes doing so safe: no `//` inside a
   * string literal, which would let comment-stripping eat real code and hide the rest of
   * the line. Asserted here rather than in one caller, so no future check can forget it.
   */
  function withoutComments(source: string): string {
    expect(source, 'the gate cannot parse a URL scheme in the source').not.toMatch(/:\/\//);

    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  }

  /** Comments gone, then string and template literals emptied. */
  function codeOnly(source: string): string {
    return withoutComments(source)
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  }

  /**
   * Every line matching `pattern`, annotated with its line number *after* filtering —
   * a line number is itself a digit and would make the no-digit check match every line it
   * reported on.
   */
  function offendingLines(source: string, pattern: RegExp): string[] {
    return source
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter((entry) => pattern.test(entry.line))
      .map((entry) => `line ${entry.number}: ${entry.line}`);
  }

  it('contains no CSS dimension, in code or in a comment', () => {
    const dimension = /\d\s*(?:px|r?em|pt|vh|vw|ch|ex)\b|\d\s*%/i;

    expect(offendingLines(YOUTUBE_SOURCE, dimension)).toEqual([]);
  });

  it('never reaches for an inline style property other than the one it removes', () => {
    // `.style.<member>` only through the three property-name APIs, and the only property
    // name they may be passed is the one YouTube hides with.
    const allowed = ['removeProperty', 'setProperty', 'getPropertyValue'];
    const members = Array.from(YOUTUBE_SOURCE.matchAll(/\.style\.([A-Za-z_$][\w$]*)/g)).map(
      (match) => match[1],
    );

    expect(members.length).toBeGreaterThan(0);
    expect(members.filter((member) => allowed.indexOf(member) < 0)).toEqual([]);

    const properties = Array.from(
      YOUTUBE_SOURCE.matchAll(/(?:setProperty|getPropertyValue)\(\s*(['"`])([^'"`]*)\1/g),
    ).map((match) => match[2]);

    expect(properties.length).toBeGreaterThan(0);
    expect(properties.filter((property) => property !== 'display')).toEqual([]);

    expect(YOUTUBE_SOURCE).not.toMatch(/cssText/);
    expect(YOUTUBE_SOURCE).not.toMatch(/setAttribute\(\s*(['"`])style\1/);
    expect(YOUTUBE_SOURCE).not.toMatch(
      /(['"])(?:padding|margin|width|height|box-sizing|boxSizing|inset)\1/i,
    );
  });

  /**
   * Rule 5, and the only honest way to pin it: `.ytp-miniplayer-button` does not exist in
   * the delhi player, so the fixture correctly has none and no behavioural test can tell
   * the dead code from its absence — re-introducing the removal passes every other test in
   * this file.
   *
   * Comments are stripped and string literals are **not**: prose may record that the
   * element is gone, while no code, not even a selector string, may name it.
   */
  it('does not resurrect the miniplayer removal (rule 5)', () => {
    expect(offendingLines(withoutComments(YOUTUBE_SOURCE), /miniplayer/i)).toEqual([]);
  });

  it('contains no numeric literal at all once comments and strings are gone', () => {
    const code = codeOnly(YOUTUBE_SOURCE);

    // And the stripping did not simply empty the file, which would make the digit check
    // pass for the wrong reason.
    expect(code).toMatch(/export function mountYouTubeButton/);
    expect(code.replace(/\s+/g, '').length).toBeGreaterThan(400);

    expect(offendingLines(code, /\d/)).toEqual([]);
  });
});

/**
 * The composition root, last in the file and exercised exactly once (DECISIONS 90):
 * `src/content.ts` attaches a `keyup` listener and a whole-document `MutationObserver` that
 * are never detached, and jsdom shares one document per file. It is also the only place
 * that observer exists, so the only one exposed to the DECISIONS 32 loop the `insertBefore`
 * budget bounds.
 */
describe('the content script mounts the button on a real YouTube document', () => {
  it('un-hides, places and wires the button through the WebKit controller', async () => {
    delete (globalThis as Record<string, unknown>)[CONTENT_SCRIPT_FRAME_FLAG];
    installFakeBrowser();

    expect(document.location.hostname).toBe('www.youtube.com');

    const { pip, rightControlsRight, size, video } = onePlayer();
    const { setArgs } = stubWebKit(video);

    await import('../src/content');
    await macrotask();

    expect(pip.style.length).toBe(0);
    expect(pip.parentElement).toBe(rightControlsRight);
    expect(pip.nextElementSibling).toBe(size);

    click(pip);
    expect(setArgs).toEqual([PresentationMode.PIP]);

    // The observer feeds a re-run into the very insertion that produced the mutation it
    // woke on, and converges instead of looping.
    await frame();
    expect(pip.parentElement).toBe(rightControlsRight);
    expect(insertBeforeCalls).toBeLessThan(INSERT_BEFORE_BUDGET);
  });

  /**
   * Why the composition root watches the document at all. Nothing else in either test file
   * exercises it: deleting the `MutationObserver` from `content.ts` leaves every other test
   * in the project passing.
   */
  it('mounts again after the player rebuilds its controls', async () => {
    // The content script is already imported by the test above, its observer still attached
    // to this document — exactly the state to test in.
    const rebuilt = onePlayer();
    const { setArgs } = stubWebKit(rebuilt.video);

    // Nothing called `refresh`, so only the observer can have noticed — one frame later
    // (RRR §5.3). A `macrotask()` is not long enough and made this test fail, which is the
    // correct behaviour of a test that pins the observer: it broke when the observer's
    // timing changed rather than passing on a barrier that no longer reaches it.
    await frame();

    expect(rebuilt.pip.style.length).toBe(0);
    expect(rebuilt.pip.parentElement).toBe(rebuilt.rightControlsRight);
    expect(rebuilt.pip.nextElementSibling).toBe(rebuilt.size);

    // And it came back wired, not merely un-hidden.
    click(rebuilt.pip);
    expect(setArgs).toEqual([PresentationMode.PIP]);
  });
});
