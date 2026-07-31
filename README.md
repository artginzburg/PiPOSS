<div align="center">

<img src="PiPOSS/Resources/Icon.png" width="200" height="200">

# PiPOSS

> Abbreviation for "Picture in Picture Open Source Software"

Brings Picture in Picture to any video, with one keypress or one click.

</div>

## Install

Needs macOS 11 or later **and Safari 15.4 or later** — the extension is Manifest
V3, which older Safari cannot load. So if PiPOSS does not turn up in Safari's
extension list, check Safari's version before concluding the app is broken.

### Via [Homebrew Cask](//brew.sh) (Recommended)

```ps1
brew install --cask artginzburg/tap/piposs
```

> Check out [the cask][cask] if you're interested.

### Direct Download

**[Latest Release ![GitHub release](https://img.shields.io/github/release/artginzburg/piposs?label=%20)](//github.com/artginzburg/PiPOSS/releases/latest/download/PiPOSS.zip)**

---

## Usage

Run the app, then enable the PiPOSS extension in Safari ▸ Settings ▸ Extensions.

On any page with a video:

- <kbd>P</kbd> toggles Picture in Picture for the video that is playing — or, on a
  page with a single video, for that one whether it plays or not. It keeps out of
  the way while you are typing in a text field, and you can change the key, or
  switch it off, in PiPOSS's settings.
- **The PiPOSS toolbar button** does the same in one click, including on sites you
  have not given the extension access to.
- <kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd> does the same again, and it is the shortcut
  Safari itself knows about: it appears in Safari ▸ Settings ▸ Extensions ▸ PiPOSS
  under *Offers keyboard shortcuts*, and Safari 26 lets you reassign it there.
  Safari only accepts shortcuts that include a modifier key, which is why a plain
  <kbd>P</kbd> cannot live there and is ours to handle instead.
- **On YouTube**, Picture in Picture appears in the player's own controls.

### Access to websites

Safari decides which sites an extension may act on, and only you can widen that —
no extension can grant itself access, and PiPOSS will not pretend otherwise.
PiPOSS's settings show where you currently stand, and the PiPOSS app shows you
where to click: it draws the part of Safari's settings that decides this. Changing
it is yours to do — either there, or in the access popover next to the toolbar
button. The toolbar button works either way.

### Settings

The settings page opens by itself right after you install, and the PiPOSS app can
reopen it. Besides the hotkey it has:

- **Picture in Picture when you switch tabs** — off by default. Turn it on and a
  video that is *playing and not muted* floats out when you leave its tab; muted
  videos and clips of a few seconds are deliberately left alone, so that a page's
  silent background loop cannot hijack the floating window. It keeps floating when
  you come back, in case that is where you wanted it.
- **Put it back when you return to the tab** — on by default, and greyed out until
  you switch the one above on, because it cannot do anything on its own. It undoes
  exactly what that switch did: a window PiPOSS floated out by itself, and only if
  you left it floating the whole time. Open or reopen the floating window yourself
  and it stays — that one is yours. The video goes back to the presentation it came
  from, though a player that was fullscreen usually comes back inline: only Safari
  can put a page back into fullscreen, and only right after you press something.
- **The YouTube button** — on by default.

## Development

See [docs/development.md](docs/development.md): `make check` runs everything that
does not need a human.

[ARCHITECTURE.md](ARCHITECTURE.md) is the map — it opens with the whole path for
adding support for a second video site, which is the most likely thing you want.

[cask]: https://github.com/artginzburg/homebrew-tap/blob/main/Casks/piposs.rb
