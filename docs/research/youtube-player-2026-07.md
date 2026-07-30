# YouTube player DOM/CSS — captured 2026-07-27

Captured from a live `youtube.com/watch` page (player build `ytp-delhi-modern`)
by inspecting the rendered DOM and the accessible stylesheets. This is the
ground truth behind task T-YT (fixing the shrunken PiP button) — do not
re-derive it from memory.

## The bug, exactly

`src/content.ts` (pre-fix) forced this onto the PiP button's `<svg>`:

```
padding    = calc(var(--yt-delhi-pill-top-height, 12px) - 6px) 6px
boxSizing  = border-box
```

The `-6px` came from `halfSvgSizeDiff = (36 - 24) / 2`, i.e. the assumption
that YouTube's PiP `<svg>` is 36 px while its siblings are 24 px.

**That assumption is dead.** Current YouTube styles *every* control button's
SVG identically, PiP included:

```css
.ytp-delhi-modern-icons .ytp-chrome-controls .ytp-button svg {
  padding: var(--yt-delhi-pill-top-height, 12px) 12px;
}

.ytp-xsmall-width-mode.ytp-delhi-modern-icons .ytp-right-controls
  .ytp-button:not(.ytp-expand-right-bottom-section-button) svg {
  width: 18px; height: 18px; padding: 7px;
}

.ytp-big-mode.ytp-delhi-modern-icons .ytp-chrome-controls .ytp-button svg {
  vertical-align: top;
  padding: calc((var(--yt-delhi-big-mode-pill-height, 56px) - 24px) / 2);
}
```

and the PiP button's own markup is a plain 24×24 icon, same as its neighbours:

```html
<button class="ytp-pip-button ytp-button" data-priority="8"
        data-tooltip-title="Picture-in-picture" style="display: none;">
  <svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24">…</svg>
</button>
```

So the old code takes an already-correct icon and squeezes it. Measured live:

| | value |
|---|---|
| `--yt-delhi-pill-top-height` (live) | **8px** — not the 12px fallback the code assumed |
| YouTube's own SVG box | `18×18` content + `7px` padding, `content-box` → 32×32 button |
| after our override | `padding: 2px 6px` + `border-box` → content collapses to **6×14 px** |

That 6×14 glyph inside a 32×32 button *is* the reported "button renders tiny".
It is not a YouTube regression; it is our compensation firing with no
size difference left to compensate for.

## Two more findings

**`.ytp-miniplayer-button` no longer exists.** The delhi player dropped it.
The code that removes it is dead — it was the reason the old implementation
needed to fight YouTube for visibility at all.

**PiP already ships a correct icon and tooltip.** No icon replacement is
needed. The button is suppressed only by an *inline* `style="display:none"`
set by YouTube; there is no CSS rule hiding `.ytp-pip-button`.

## Layout of the right controls

`.ytp-right-controls` has three children, and PiP is the odd one out — it is a
direct child, a *sibling* of the two grouping divs rather than inside them:

```
.ytp-right-controls
├── .ytp-right-controls-left      → expand-button, autonav-toggle,
│                                   subtitles (priority 5), settings
├── .ytp-right-controls-right     → size (9), remote (10), fullscreen (12)
└── .ytp-pip-button (priority 8)  ← unparented, hidden inline
```

Every button carries `data-priority`. PiP's `8` sits between subtitles (5) and
size (9), which is YouTube's own statement of where it belongs: first position
inside `.ytp-right-controls-right`, ahead of the size button.

## Design consequences for the fix

1. **Touch no geometry.** Do not set `padding`, `box-sizing`, `width` or
   `height` on the SVG. YouTube sizes it correctly; every line of pixel math
   we write is a line that breaks at the next redesign.
2. **Un-hide by removing the property**, not by assigning a value:
   `button.style.removeProperty('display')`. Assigning `display: initial`
   overrides whatever layout mode YouTube's stylesheet intends.
3. **Order by `data-priority`**, not by hardcoded neighbour selectors. Insert
   before the first sibling whose priority exceeds ours; append if there is
   none. This is declarative and survives buttons being added or removed.
4. **Assert the invariant, not the pixels.** The regression guard must be
   *"our button's rendered SVG box equals a sibling control button's box"* —
   never an absolute px value. A relative assertion keeps passing across
   redesigns and fails exactly when we have actually broken something. This is
   the property that makes the fix durable for the next half-year redesign.
5. Width-responsive classes (`ytp-xsmall-width-mode`, `ytp-tiny-mode`,
   `ytp-big-mode`) change the geometry contract at runtime, so any absolute
   expectation is wrong in at least one of them.

## Reproducing this capture

Load a watch page, then read `getComputedStyle` on `.ytp-pip-button svg` and on
a sibling such as `.ytp-fullscreen-button svg`, and dump the `cssRules` whose
selector matches `ytp-button` and whose text mentions `svg`. Note that the
player collapses to `ytp-xsmall-width-mode`/`ytp-tiny-mode` in a small or
zero-size viewport and sets `display: none` on most buttons — measure in a real
desktop-sized viewport or the numbers will all read zero.
