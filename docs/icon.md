# The icon

The mark was drawn from a screenshot of the Picture-in-Picture button in a video playing
on macOS. Figma source, and the source of truth for the artwork:

<https://www.figma.com/file/CBgigvJeXtYDHFEx6i1dKA/Picture-in-Picture-icon?node-id=0%3A1>

![Icon](../PiPOSS/Resources/Icon.png)

Since T14 the app icon is an **Icon Composer bundle**, `AppIcon.icon/`, and every raster
file in the repository is generated from the two Figma exports in `design/icon/`. There
is no hand-edited PNG and no hand-edited SVG anywhere in the pipeline.

## Regenerating everything

```sh
make icons          # or: xcrun swift design/icon/render.swift, from the repo root
```

`design/icon/render.swift` writes all of it:

| Output | Used by |
|---|---|
| `AppIcon.icon/Assets/glyph.svg` | `actool`, via `project.yml`'s app target |
| `PiPOSS Extension/Resources/images/toolbar-icon-*.png` | `manifest.json`'s `action.default_icon` |
| `PiPOSS Extension/Resources/images/icon-*.png` | `manifest.json`'s `icons` — Safari's extension list |
| `PiPOSS/Resources/Icon.png` | this file, the README, and the app's own fallback image |

`test/icon.test.ts` re-derives the interesting properties from the Figma exports and
fails if an output has stopped matching them, so the generator is checkable rather than
merely trusted. It also refuses a layer that is not flat, a toolbar PNG that is not pure
black, and a `project.yml` that does not hand the bundle to `actool`.

macOS ships no SVG rasteriser that this repository can call — no `rsvg-convert`, no
ImageMagick, no cairo, and the system Python has no PIL — so the generator is Swift:
`NSImage(contentsOf:)` reads SVG directly (an `_NSSVGImageRep` comes back), which makes
AppKit the one rasteriser available without adding a dependency. It opens no window and
touches no keychain.

## What an `.icon` bundle is

Established by reading this machine rather than from documentation, because the format is
young and this project has had to correct five platform claims already. `.icon` is a
plain directory:

```
AppIcon.icon/
  icon.json          the document: a background fill, then groups of layers
  Assets/glyph.svg   the layer art — SVG is a first-class layer format
```

The evidence, all reproducible here:

- **Apple's own macOS 26 icons are built this way.** `xcrun assetutil --info` on
  `/System/Applications/FaceTime.app/Contents/Resources/Assets.car` reports an
  `IconImageStack` named `AppIcon` with `CanvasWidth`/`CanvasHeight` **1024**, over
  `AppIcon/Group` and `AppIcon/Group 2`, whose layers are `AppIcon_Assets/3.camera` and
  `AppIcon_Assets/2.lens` — `AssetType: Vector`, `RenditionName: image.svg`,
  `LayerPosition "0,0"`, `LayerSize "1024,1024"`. Three appearances are compiled from the
  one document: `UIAppearanceLight`, `UIAppearanceDark` and `ISAppearanceTintable`.
- **The group effects are Icon Composer's, not the artwork's.** The same dump carries
  `LayerHasSpecular`, `LayerGathersSpecularByElement`, `LayerShadowStyle 3`,
  `LayerShadowOpacity 0.5`, `LayerTranslucency 0.5`–`0.7` and `LayerBlurStrength 1`. This
  is why RRR §12 requires flat, opaque input: ship a baked shadow and it is applied twice.
- **The file type is `folder.iconcomposer.icon`**, per Xcode 26.6's
  `StandardFileTypes.xcspec`, and `AssetCatalogCompiler.xcspec` lists that type among
  `com.apple.compilers.assetcatalog`'s `InputFileTypes` with the `actool` grouping — so a
  `.icon` is compiled *together with* the target's `.xcassets` in one `actool` call.
- **Two authored bundles were read as worked examples**, both of them the owner's own:
  `WheelClick/AppIcon.icon` (PNG layers) and `MiddleClick.icon` (a single SVG layer, with
  `"shadow": {"kind": "neutral", "opacity": 0.5}` and
  `"translucency": {"enabled": true, "value": 0.5}` — the same values Apple's compiled
  icons carry).
- `actool` compiles a `.icon` standalone, no GUI involved:
  `xcrun actool AppIcon.icon --compile OUT --platform macosx --minimum-deployment-target
  11.0 --app-icon AppIcon --output-partial-info-plist P.plist`. That is how the numbers
  below were measured. Icon Composer.app itself was never launched.

**Inferred, not established:** the exact JSON schema beyond the keys used here. The
framework binary also names `fill-specializations`, `shadow-specializations`,
`specular-specializations`, `translucency-specializations`, `glass-specializations`,
`image-name-specializations`, `blend-mode-specializations` and `position-specializations`,
with appearance names `light`, `dark` and `tinted` — a per-appearance override mechanism
this document does not use and has not tested.

## The layer decomposition: one layer, and no background

`design/icon/PiP-final.svg` is a background (a gradient rounded rect) plus a glyph. Only
the glyph becomes a layer.

The background is Icon Composer's own concern in the Tahoe model: `icon.json`'s top-level
`fill` names it and the renderer draws the rounded rect, its gradient, the shadow under
it and the glass over it, per appearance. A background layer here would be drawn on top of
the one Icon Composer already provides.

The evidence is stronger than "FaceTime has no background art". In FaceTime's decompiled
stack, layer 0 is `AppIcon_Assets/Gradient-1` with `AssetType: Named Gradient` — a
different asset type from the `Vector` layers above it, not a picture of a background. Our
own bundle reproduces that: `fill: "automatic"` compiled `AppIcon_Assets/Gradient-1` and
`Gradient-2` (light and dark) as the bottom of each stack, with the only `Vector` in the
whole catalog being `AppIcon_Assets/glyph`. So the background is *typed* as a fill by the
format itself, and there is no place for background art to go.

So `fill` is `"automatic"`, which compiles the standard light / dark / tinted set — all
three are in the shipped `Assets.car` (`NSAppearanceNameAqua`, `NSAppearanceNameDarkAqua`,
`ISAppearanceTintable`). A fixed white fill could not have done that.

### Two visual consequences only the owner can judge (RRR §10.2.4)

**1. The background gradient runs the other way, so the two surfaces disagree.** His
gradient and Icon Composer's light fill span the same near-white range in opposite
directions:

| | top of the shape | bottom |
|---|---|---|
| `PiP-final.svg`, declared stops | `#F0F0F0` at y=45 | `white` (`#FFFFFF`) at y=246 |
| the same file, sampled at 1024 | `#F0F0F0` | `#FDFDFD` (the last stop is below the shape) |
| `fill: automatic`, light, sampled from the built app | `#FFFFFF` | `#ECECEC` |

Icon Composer's direction is the platform-consistent one — light at the top is what a
top-lit surface looks like, and its specular highlight sits up there too — so it was left
alone rather than fought. Reversing it would mean an explicit `linear-gradient` fill, which
would also freeze dark mode at near-white.

The consequence to look at: **the flat PNGs keep his direction and the compiled app icon
does not**, so the Dock reads light-at-top while Safari's extension list reads
light-at-bottom. Defensible — each surface is right for its own renderer — but they no
longer match, and that is a choice rather than an oversight.

**2. The glyph is lightened on the app icon and not on the PNGs.** `translucency: 0.5`
plus the specular pass render `#36DBC7` as roughly `#79E8DA`–`#8CEBDF` in the compiled
icon, while the flat PNGs stay exactly `#36DBC7`. It is not a colour error, and it is why
the glyph had to be located by chroma rather than by colour match when measuring the
compiled result.

`0.5` is the value Apple's own icons carry and the value the owner already chose in
`MiddleClick.icon`, which is why it was not changed. But those sit a saturated glyph on a
*dark or coloured* background; on a near-white one the same translucency washes the teal
much further. Lowering it, or turning it off, is a one-key change in `icon.json` —
`"translucency": {"enabled": false}` — and is the owner's call, not a measurable one.

The glyph layer needs no `fill` override: a layer that names no fill renders the SVG's own
colours, which is again what FaceTime does (its light-appearance group carries no fill or
gradient key, only its dark one does). The glyph stays `#36DBC7`.

### Stripping the baked effects

`PiP-final.svg` carries four Figma filters: `filter0_d_5_31`, a drop shadow on the
background; `filter1_ii_5_31`, two inner shadows on the glyph; and `filter2/3/4_dd_5_31`
on the three white dots. All of them are effects Icon Composer applies itself.

They are not stripped by editing that file. **The owner's other export already is the flat
glyph**: `design/icon/ToolbarIcon.svg` is the same mark with the window outline outlined
into a fill, the three dots cut as even-odd *holes* rather than white circles laid on top,
and no filter anywhere. It is provably the same drawing — every coordinate is
`PiP-final.svg`'s glyph translated by exactly (+50, +49), which `test/icon.test.ts` checks
number by number, pairing them by SVG command rather than by position.

So the layer is `ToolbarIcon.svg`'s four paths, verbatim, with `black` swapped for
`#36DBC7` and a `viewBox` that frames them. Nothing is redrawn, and the holes are an
improvement rather than a compromise: they let the background show through, which is how
Apple's own glyphs are cut, and in dark mode the dots follow the background instead of
staying stubbornly white.

## The glyph scale: 0.72

**The owner's actual request** was that the symbol be bigger, closer to the proportions of
real macOS icons. That needs a number, and the number is measured rather than chosen by
eye.

Every icon compiled from a `.icon` renders its rounded rect at **824 × 824 in a 1024
canvas** — 0.8047, identical across every stock app checked (FaceTime, Podcasts, Music,
Messages, Reminders, Freeform, Shortcuts, Mail, App Store, TV, Activity Monitor) and
across the bundle produced here. That is fixed and not ours to set. What *is* ours is how
much of that rounded rect the glyph covers.

Measured on Apple's own icons at 1024, taking the white glyph's bounding box over the
rounded rect's, restricted to icons that are one dominant geometric mark on a saturated
background so the threshold cannot pick up the background:

| Stock icon | glyph width ÷ shape width |
|---|---|
| FaceTime (camera body — the closest analogue, a rounded-rect media glyph) | 0.688 |
| Stocks | 0.703 |
| Chess | 0.738 |
| TV | 0.748 |

**PiPOSS was at 0.633** — measured on `PiP-final.svg` itself (595 × 486 px of glyph inside
a 940 px rounded rect at 1024), and 0.617 on the `icon-1024.png` that shipped, the
difference being the inner-shadow filter darkening the glyph's rim out of the colour
match. Visibly below the band, which is exactly what the owner was reacting to.

`0.72` is the middle of the measured band. It is one constant, `glyphFraction` in
`design/icon/render.swift`, and it reaches the artwork as the layer SVG's `viewBox`: a
square window `glyphWidth / glyphFraction` across, centred on the glyph. Measured on the
compiled result, a glyph filling fraction *f* of the 1024 layer canvas fills exactly *f*
of the rendered rounded rect, centred — so that one number is the whole decision.

Verified end to end, on the `AppIcon.icns` inside the built `PiPOSS.app`:

```
shape bbox   206x206  (0.8047 of a 256 canvas)
ink bbox     148x122
ink/shape    0.7184 x 0.5922      ink offset  dx 0.00  dy 0.00
```

0.7184 against a target of 0.72, the difference being one pixel of antialiasing at that
size; 0.7209 when the same bundle is measured at 1024. Nothing is clipped by the
rounded rect's corner curvature — a clipped glyph would measure *smaller* than the
fraction asked for, not equal to it.

The glyph is 149.4 × 122.0 user units, so 0.72 of the width puts the height at 0.592 and
the area at 0.228 of the rounded rect — between FaceTime's 0.164 and Messages' 0.268.

**Not enlarged: the toolbar icons.** Those keep the framing of the PNGs they replace,
edge to edge horizontally, because padding a toolbar button is Safari's business and the
owner has been looking at that weight for four years. `glyphFraction` deliberately does
not apply there.

## Why the toolbar stays a PNG size map

RRR §12, as corrected during T03: SVG in `action.default_icon` works only from **Safari
16.4**, MV3's floor is 15.4, and a manifest cannot declare an SVG *and* a raster fallback.
A single SVG would silently lose the toolbar icon for Safari 15.4–16.3 users on macOS
11/12. So the six PNGs stay.

They must be **pure black with alpha**: Safari treats a grayscale toolbar image as a
template and tints it with the system accent colour and appearance, which is the whole
reason the button follows the system today. The generator guarantees it by construction —
it zeroes every colour channel after rasterising — and `test/icon.test.ts` verifies it by
decoding the PNG bytes on disk, with no image library in between, since colour management
in a decoder is exactly the sort of thing that would launder a violation into a pass.

## Things worth knowing before changing this

- **What has to stay true of `project.yml` is the *shape*, not the `type: file` line.**
  `AppIcon.icon` must come out as **one** reference that a copy phase lists; if it is ever
  walked into `icon.json` plus `Assets/glyph.svg` as two loose resources, actool is never
  handed a bundle and the app ships the generic icon with a green build.
  `test/icon.test.ts` asserts exactly that shape.
  `type: file` is **defensive, not required**, and an earlier version of this document had
  it the other way round on plausible reasoning nobody ran the counterfactual for.
  Measured: remove the line, regenerate, and `project.pbxproj` is **byte-identical** with
  the icon test still green — XcodeGen 2.46 treats any extension-bearing directory as one
  opaque `PBXFileReference`, confirmed in an isolated spec against both `.icon` and a
  fabricated `.zzz`. Keep the line; do not rely on it.
- XcodeGen writes `lastKnownFileType = wrapper.icon`, which it invents and which appears
  nowhere in Xcode's own specs. (It does know the extension in that narrow sense — it
  emits no type at all for `.zzz`.) It does not matter — the build system resolves `.icon`
  by extension and groups it into the same `actool` invocation as `Assets.xcassets`
  (confirmed in the build log) — and no XcodeGen key overrides it, so the test
  deliberately does not assert it.
- **`AppIcon.appiconset` was deleted, and had to be.**
  `ASSETCATALOG_COMPILER_APPICON_NAME` names one asset, and two assets called `AppIcon`
  in one `actool` call is an ambiguity nothing would report. `LargeIcon.imageset` went
  with it: it held only a `Contents.json` and nothing referenced it.
- The compiled `AppIcon.icns` contains four representations — 16, 16@2x, 128, 128@2x.
  That is not a defect of this bundle: WheelClick's Icon-Composer build and Apple's own
  FaceTime ship byte-identical representation sets. The 1024 art lives in `Assets.car`
  under `CFBundleIconName`, which is what macOS 12+ reads.
- The PNGs are the artwork **without** a system treatment, not a worse copy of one. Icon
  Composer's shadow, specular and glass are applied by whoever draws the icon — the Dock,
  Finder, Spotlight — and cannot be reproduced outside its renderer, so the flat render
  is the honest counterpart for Safari's extension list and for this page.
