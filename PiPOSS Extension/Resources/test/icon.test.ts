/**
 * The icon, on both surfaces it appears on (T14).
 *
 * Two properties here can break a shipped build while every other test stays green and
 * `xcodebuild` prints `** BUILD SUCCEEDED **`:
 *
 * 1. **`AppIcon.icon` reaching the product.** `actool` compiles a `.icon` only when the
 *    project hands it one; a `.icon` merely on disk, or copied as an opaque folder instead
 *    of compiled, produces an app with the *generic* icon and no diagnostic (RRR §10.1.9).
 *    `AppIcon.icon` is also a *directory* whose extension XcodeGen 2.46 does not know, so
 *    whether it comes out as one bundle reference or two walked-out loose files is worth
 *    pinning rather than assuming.
 * 2. **The toolbar PNGs staying pure black.** Safari treats a grayscale toolbar image as a
 *    *template* and tints it with the system accent colour and appearance (RRR §12). Ship
 *    one with colour and the button stops following the system — visible only in Safari, on
 *    a real toolbar. The check reads the bytes on disk, not a rendering.
 *
 * Whether it *looks* right in a Dock is RRR §10.2.4 and the owner's. What is checkable is
 * that the artefacts are the ones his Figma exports imply, at the proportion `docs/icon.md`
 * claims.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  ROOT,
  assertAnchored,
  generatedProject,
  projectDefinitions,
  readRepo,
  readResource,
  repo,
  targetBlock,
} from './helpers/paths';

const ICON_BUNDLE = 'AppIcon.icon';
const LAYER = `${ICON_BUNDLE}/Assets/glyph.svg`;
const GENERATOR = 'design/icon/render.swift';
const TOOLBAR_SOURCE = 'design/icon/ToolbarIcon.svg';
const FIGMA_APP_ICON = 'design/icon/PiP-final.svg';

beforeAll(() => {
  // Guard for every negative assertion below: a wrong repo root would make "no
  // AppIcon.appiconset exists" pass for the wrong reason.
  assertAnchored();
  expect(existsSync(repo(TOOLBAR_SOURCE))).toBe(true);
});

/* ------------------------------------------------------------------------- *
 * The bundle format, established by reading rather than from memory: `.icon` is a directory
 * holding `icon.json` plus an `Assets/` folder, and Apple ships their own macOS 26 icons this
 * way — the `Assets.car` inside `/System/Applications/FaceTime.app` decompiles (`assetutil
 * --info`) to an `IconImageStack` of `CanvasWidth 1024` over an SVG layer named
 * `AppIcon_Assets/3.camera`. Xcode's `StandardFileTypes.xcspec` gives the type as
 * `folder.iconcomposer.icon`, and `AssetCatalogCompiler.xcspec` lists it among `actool`'s
 * inputs. See `docs/icon.md`.
 * ------------------------------------------------------------------------- */

interface IconLayer {
  'image-name'?: unknown;
  name?: unknown;
}
interface IconGroup {
  layers?: IconLayer[];
}
interface IconDocument {
  fill?: unknown;
  groups?: IconGroup[];
  'supported-platforms'?: { squares?: unknown; circles?: unknown };
}

// Parsed at module load: invalid JSON fails the suite at import with the parser's own message,
// which is louder than any assertion.
const icon = JSON.parse(readRepo(`${ICON_BUNDLE}/icon.json`)) as IconDocument;

/** Every `image-name` the document references, from every group. */
function referencedImages(): string[] {
  return (icon.groups ?? [])
    .flatMap((group) => group.layers ?? [])
    .map((layer) => layer['image-name'])
    .filter((name): name is string => typeof name === 'string');
}

describe('AppIcon.icon is a well-formed Icon Composer bundle', () => {
  it('declares macOS and nothing this project does not ship (RRR §11)', () => {
    // No iOS/iPadOS target is settled, and `supported-platforms` is where a stray one appears.
    expect(icon['supported-platforms']?.squares).toEqual(['macOS']);
    expect(icon['supported-platforms']?.circles).toBeUndefined();
  });

  it('leaves the background to Icon Composer rather than shipping it as a layer', () => {
    // In the Tahoe icon model the rounded rect, its gradient and the glass on top are the
    // *system's*: `fill` names the background and Icon Composer draws it, as Apple's own icons
    // do. A background layer would be drawn on top of the one it already provides.
    expect(icon.fill).toBe('automatic');
    expect(referencedImages()).toEqual(['glyph.svg']);
  });

  it('references an image that exists, and ships no image nothing references', () => {
    const onDisk = readdirSync(repo(`${ICON_BUNDLE}/Assets`)).filter(
      (name) => name !== '.DS_Store',
    );
    const referenced = referencedImages();

    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      // The quiet failure this guards: `actool` compiles a `.icon` whose layer image is
      // missing without complaint, and the app gets a blank icon.
      expect(
        existsSync(repo(`${ICON_BUNDLE}/Assets/${name}`)),
        `${name} is referenced but absent`,
      ).toBe(true);
    }
    expect([...onDisk].sort()).toEqual([...referenced].sort());
  });
});

/* ------------------------------------------------------------------------- *
 * Icon Composer input must be flat (RRR §12): it applies shadow, specular and glass itself, so
 * a layer carrying its own baked effects gets them twice. `design/icon/PiP-final.svg` carries
 * four Figma filters — a drop shadow on the background and inner shadows on the glyph — and the
 * layer is derived from `ToolbarIcon.svg`, which has none.
 * ------------------------------------------------------------------------- */

describe('the Icon Composer layer is flat and opaque (RRR §12)', () => {
  const layer = readRepo(LAYER);

  it('carries no filter, no gradient and no group opacity', () => {
    for (const forbidden of ['filter', '<defs', 'feGaussianBlur', 'feDropShadow', 'opacity']) {
      expect(
        layer,
        `${LAYER} contains "${forbidden}" — Icon Composer applies its own effects`,
      ).not.toContain(forbidden);
    }
  });

  it('would notice: the same check fails on the unstripped Figma export', () => {
    // Non-vacuity: if the needles above stopped matching anything at all, this fails instead of
    // the flatness check quietly passing on any input.
    const figma = readRepo(FIGMA_APP_ICON);
    expect(figma).toContain('filter');
    expect(figma).toContain('<defs');
    expect(figma).toContain('feGaussianBlur');
  });
});

/* ------------------------------------------------------------------------- *
 * The layer is *derived*, and the derivation is checkable. `design/icon/render.swift` writes
 * `AppIcon.icon/Assets/glyph.svg` from `design/icon/ToolbarIcon.svg`, and committing the output
 * is unavoidable — `actool` reads it at build time and Icon Composer needs a bundle that stands
 * alone — so the risk is the usual one for a committed derivative: the source moves and the copy
 * does not. These re-derive it instead of trusting it.
 * ------------------------------------------------------------------------- */

/** The `<path .../>` elements of an SVG, verbatim. */
function paths(svg: string): string[] {
  return svg.match(/<path\b[^>]*\/>/g) ?? [];
}

/** The `d` attribute of a path element. */
function pathData(element: string): string {
  const found = /\bd="([^"]*)"/.exec(element);
  expect(found, `no d attribute in ${element.slice(0, 40)}…`).not.toBeNull();
  return found![1];
}

describe('the layer is derived from the owner’s ToolbarIcon.svg', () => {
  const layer = readRepo(LAYER);
  const source = readRepo(TOOLBAR_SOURCE);

  it('has the same four paths, recoloured and nothing else', () => {
    const expected = paths(source).map((element) => element.replace(/"black"/g, '"#36DBC7"'));

    expect(expected).toHaveLength(4);
    // Byte-identical, not merely similar: the only sanctioned edit between the export and the
    // layer is the fill colour, so anything else means a generated file was hand-edited.
    // Re-run `make icons`.
    expect(paths(layer)).toEqual(expected);
  });

  it('paints the glyph in the colour PiP-final.svg uses', () => {
    expect(layer).toContain('#36DBC7');
    expect(readRepo(FIGMA_APP_ICON)).toContain('#36DBC7');
    expect(layer).not.toContain('"black"');
  });
});

/* ------------------------------------------------------------------------- *
 * `ToolbarIcon.svg` really is `PiP-final.svg`'s glyph — the inference the whole approach rests
 * on, checked rather than asserted in a comment. Instead of reconstructing a flat glyph out of
 * the filtered app-icon export, the layer reuses `ToolbarIcon.svg`, which is the same mark
 * already flattened: the window outline outlined, the three dots cut as even-odd holes rather
 * than white circles laid on top, no filter anywhere.
 *
 * The comparison covers the two cursor paths, the only parts that are a `<path>` in *both*
 * files — the window outline and inner window are `<rect>` in `PiP-final.svg` and outlined
 * paths in `ToolbarIcon.svg`, so there is nothing to compare coordinate for coordinate. The
 * window half gets its own cheaper witness below.
 *
 * Numbers are paired by SVG *command*, not by position in the string: a naive "every other
 * number is an x" is wrong on these paths and would compare x against y, because both cursor
 * arrows contain `V`, which takes a single coordinate. That is how this check could pass by luck.
 * ------------------------------------------------------------------------- */

/** How many (x, y) pairs each absolute path command takes; `V`/`H` take a lone axis. */
const COMMAND_ARITY: Record<string, 'pairs2' | 'pairs4' | 'pairs6' | 'x' | 'y' | 'none'> = {
  M: 'pairs2',
  L: 'pairs2',
  T: 'pairs2',
  C: 'pairs6',
  S: 'pairs4',
  Q: 'pairs4',
  H: 'x',
  V: 'y',
  Z: 'none',
};

/**
 * A path's numbers, each labelled with the axis it moves along.
 *
 * Known limitation, stated rather than fixed: the number pattern requires a digit before the
 * decimal point, so a leading-decimal coordinate (`.5`, which SVG permits) would read as `5`.
 * Neither Figma export contains one — Figma always writes the leading zero — and the failure
 * mode is loud: a misread coordinate is off by an order of magnitude and the offset assertion
 * below fails rather than passes. Widen to `-?\d*\.?\d+` if an export ever does it.
 */
function axes(data: string): Array<{ axis: 'x' | 'y'; value: number }> {
  // Lowercase is relative, and a relative coordinate does not shift under a translation — an
  // export using them would make this whole check vacuous.
  expect(data, 'relative path commands are not handled by this check').not.toMatch(/[a-z]/);

  const out: Array<{ axis: 'x' | 'y'; value: number }> = [];
  for (const [, command, args] of data.matchAll(/([A-Z])([^A-Z]*)/g)) {
    const arity = COMMAND_ARITY[command];
    expect(arity, `unhandled path command "${command}"`).toBeDefined();
    const numbers = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (arity === 'x' || arity === 'y') {
      for (const value of numbers) out.push({ axis: arity, value });
    } else {
      for (let i = 0; i < numbers.length; i += 1) {
        out.push({ axis: i % 2 === 0 ? 'x' : 'y', value: numbers[i] });
      }
    }
  }
  return out;
}

describe('the two Figma exports are the same drawing (docs/icon.md)', () => {
  /** A path reduced to its command letters, e.g. `MCCLZ` — an identity to match on. */
  function signature(data: string): string {
    return (data.match(/[A-Za-z]/g) ?? []).join('');
  }

  it('offsets ToolbarIcon.svg by exactly (+50, +49) to become PiP-final’s glyph', () => {
    const toolbar = paths(readRepo(TOOLBAR_SOURCE)).map(pathData);
    const figma = paths(readRepo(FIGMA_APP_ICON)).map(pathData);

    expect(toolbar).toHaveLength(4);
    // The two cursor paths, and only those, are `<path>` in the app-icon export too.
    expect(figma).toHaveLength(2);

    for (const [i, data] of figma.entries()) {
      // Paired by command signature rather than index, so a re-export that reorders the paths
      // still compares like with like, and an ambiguous match fails loudly.
      const counterparts = toolbar.filter((candidate) => signature(candidate) === signature(data));
      expect(
        counterparts,
        `PiP-final path ${i} (${signature(data)}) has no single counterpart in ToolbarIcon.svg`,
      ).toHaveLength(1);

      const a = axes(counterparts[0]);
      const b = axes(data);
      expect(b.map((n) => n.axis)).toEqual(a.map((n) => n.axis));

      for (let n = 0; n < a.length; n += 1) {
        // Figma rounds each export independently, so 26.9834 + 50 comes out as 76.9835. A
        // hundredth of a user unit is the tolerance; the offset itself is exact.
        expect(b[n].value - a[n].value, `${a[n].axis} number ${n} of path ${i}`).toBeCloseTo(
          a[n].axis === 'x' ? 50 : 49,
          2,
        );
      }
    }
  });

  it('places the inner PiP window at the same offset', () => {
    // A second, independent witness for the half of the mark the path comparison cannot reach:
    // in `PiP-final.svg` the inner window is a `<rect>` whose origin is `ToolbarIcon.svg`'s
    // inner-window coordinates plus the same (50, 49). Found by its fill rather than position —
    // of the three rects in that file, the inner window is the one painted in the glyph colour
    // (the background carries a gradient and the outer window is stroke-only).
    const filled = (readRepo(FIGMA_APP_ICON).match(/<rect\b[^>]*\/>/g) ?? []).filter((element) =>
      element.includes('fill="#36DBC7"'),
    );
    expect(filled, 'PiP-final.svg no longer has exactly one teal-filled <rect>').toHaveLength(1);

    const rect = /x="([\d.]+)" y="([\d.]+)"/.exec(filled[0]);
    expect(rect).not.toBeNull();
    const [, x, y] = rect!.map(Number);

    const toolbar = axes(paths(readRepo(TOOLBAR_SOURCE)).map(pathData)[1]);
    const xs = toolbar.filter((n) => n.axis === 'x').map((n) => n.value);
    const ys = toolbar.filter((n) => n.axis === 'y').map((n) => n.value);

    expect(Math.min(...xs) + 50).toBeCloseTo(x, 2);
    expect(Math.min(...ys) + 49).toBeCloseTo(y, 2);
  });
});

/* ------------------------------------------------------------------------- *
 * The glyph scale. One number, `glyphFraction` in `design/icon/render.swift`, decides how much
 * of the icon's rounded rect the glyph covers; it reaches the artefact as the layer SVG's
 * `viewBox` (a square window `glyphWidth / glyphFraction` across) and it is quoted in
 * `docs/icon.md`. Three places, so a three-way agreement check — the failure mode is a
 * documented number that no longer describes the shipped icon.
 * ------------------------------------------------------------------------- */

describe('the glyph scale agrees across generator, artefact and docs', () => {
  const generator = readRepo(GENERATOR);

  /** `glyphFraction` as the generator declares it. */
  const fraction = (() => {
    const found = /^let glyphFraction = ([\d.]+)$/m.exec(generator);
    expect(found, `${GENERATOR} no longer declares \`let glyphFraction = …\``).not.toBeNull();
    return Number(found![1]);
  })();

  /** The glyph width the generator asserts its source measures, in user units. */
  const glyphWidth = (() => {
    const found = /abs\(glyphWidth - ([\d.]+)\)/.exec(generator);
    expect(found, `${GENERATOR} no longer guards the measured glyph width`).not.toBeNull();
    return Number(found![1]);
  })();

  it('is a plausible fraction, so a typo cannot pass as a decision', () => {
    expect(fraction).toBeGreaterThan(0.5);
    expect(fraction).toBeLessThan(0.95);
  });

  it('is what the shipped layer’s viewBox actually encodes', () => {
    const found = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(readRepo(LAYER));
    expect(found, `${LAYER} has no numeric viewBox`).not.toBeNull();
    const [, x, y, w, h] = found!.map(Number);

    // Square, or the glyph would be stretched.
    expect(w).toBeCloseTo(h, 3);
    // The glyph covers `fraction` of that window, and the window becomes the icon's rounded
    // rect. Measured on the compiled output: 0.7209 of an 824 px shape.
    expect(glyphWidth / w).toBeCloseTo(fraction, 3);
    // Centred, so the mark sits in the middle of the icon rather than drifting as the scale
    // changes.
    expect(x + w / 2).toBeCloseTo(78.7, 1);
    expect(y + h / 2).toBeCloseTo(79.0, 1);
  });

  it('is the number docs/icon.md tells the reader', () => {
    // RRR §10.1.9 asks for the chosen scale *and its reasoning* to be written down, and a doc
    // quoting a stale number is worse than no doc.
    expect(readRepo('docs/icon.md')).toContain(String(fraction));
  });
});

/* ------------------------------------------------------------------------- *
 * The toolbar PNGs (RRR §12), read from the bytes on disk with a minimal decoder rather than an
 * image library: "pure black" is a claim about the file, and colour management in a decoder is
 * exactly what would launder a violation into a pass. No dependency — `node:zlib` plus the five
 * PNG scanline filters.
 * ------------------------------------------------------------------------- */

interface Decoded {
  width: number;
  height: number;
  /** PNG colour type: 0 gray, 2 rgb, 3 palette, 4 gray+alpha, 6 rgba. */
  colourType: number;
  /** One flat array of straight (never premultiplied) RGBA samples. */
  rgba: Uint8Array;
}

function decodePNG(path: string): Decoded {
  const data = readFileSync(path);
  expect(data.subarray(0, 8).toString('latin1'), `${path} is not a PNG`).toBe('\x89PNG\r\n\x1a\n');

  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('latin1');
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      depth = chunk[8];
      colourType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'IDAT') idat.push(Buffer.from(chunk));
    offset += 12 + length;
  }

  // The generator writes 8-bit non-interlaced RGBA and nothing else. Asserting rather than
  // handling means a surprise format fails loudly instead of being misread.
  expect(depth, `${path}: only 8-bit samples are handled`).toBe(8);
  expect(interlace, `${path}: only non-interlaced PNGs are handled`).toBe(0);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  expect(channels, `${path}: unknown PNG colour type ${colourType}`).toBeDefined();

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels!;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let read = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = new Uint8Array(raw.subarray(read, read + stride));
    read += stride;

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels! ? line[i - channels!] : 0;
      const up = previous[i];
      const upLeft = i >= channels! ? previous[i - channels!] : 0;
      if (filter === 1) line[i] = (line[i] + left) & 0xff;
      else if (filter === 2) line[i] = (line[i] + up) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const predictor = left + up - upLeft;
        const dl = Math.abs(predictor - left);
        const du = Math.abs(predictor - up);
        const dul = Math.abs(predictor - upLeft);
        line[i] = (line[i] + (dl <= du && dl <= dul ? left : du <= dul ? up : upLeft)) & 0xff;
      }
    }
    previous = line;

    for (let x = 0; x < width; x += 1) {
      const s = x * channels!;
      const d = (y * width + x) * 4;
      if (colourType === 6) {
        rgba[d] = line[s];
        rgba[d + 1] = line[s + 1];
        rgba[d + 2] = line[s + 2];
        rgba[d + 3] = line[s + 3];
      } else if (colourType === 4) {
        rgba[d] = rgba[d + 1] = rgba[d + 2] = line[s];
        rgba[d + 3] = line[s + 1];
      } else if (colourType === 2) {
        rgba[d] = line[s];
        rgba[d + 1] = line[s + 1];
        rgba[d + 2] = line[s + 2];
        rgba[d + 3] = 255;
      } else {
        rgba[d] = rgba[d + 1] = rgba[d + 2] = line[s];
        rgba[d + 3] = 255;
      }
    }
  }
  return { width, height, colourType, rgba };
}

/** How many visible pixels carry any colour at all, and the worst offender. */
function colouredPixels(image: Decoded): { count: number; maxChannel: number } {
  let count = 0;
  let maxChannel = 0;
  for (let i = 0; i < image.rgba.length; i += 4) {
    if (image.rgba[i + 3] === 0) continue;
    const channel = Math.max(image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]);
    if (channel > 0) {
      count += 1;
      maxChannel = Math.max(maxChannel, channel);
    }
  }
  return { count, maxChannel };
}

interface ActionManifest {
  action?: { default_icon?: Record<string, string> };
  icons?: Record<string, string>;
}
const manifest = JSON.parse(readResource('manifest.json')) as ActionManifest;

describe('the toolbar PNGs are template images (RRR §12)', () => {
  const declared = Object.entries(manifest.action?.default_icon ?? {});

  it('has one for every size the manifest declares', () => {
    // The size map is kept rather than replaced by a single SVG: SVG in `action.default_icon`
    // works only from Safari 16.4 while MV3's floor is 15.4, and a manifest cannot declare an
    // SVG plus a raster fallback (RRR §12).
    expect(declared.length).toBeGreaterThan(1);
    for (const [, path] of declared) {
      expect(path.endsWith('.png'), `${path} is not a PNG — see RRR §12`).toBe(true);
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it.each(declared)('%s×%s is pure black with alpha, and that size', (size, path) => {
    const image = decodePNG(join(ROOT, path));

    expect(image.width, `${path} is ${image.width}px but declared as ${size}`).toBe(Number(size));
    expect(image.height).toBe(Number(size));
    // Alpha is what carries the shape once Safari has thrown the colour away.
    expect([4, 6], `${path} has no alpha channel`).toContain(image.colourType);

    const coloured = colouredPixels(image);
    expect(
      coloured.count,
      `${path} has ${coloured.count} visible pixels with colour in them (worst channel ` +
        `${coloured.maxChannel}). Safari tints a grayscale toolbar icon with the system ` +
        'accent colour; anything else stops following the system. Re-run `make icons`.',
    ).toBe(0);
  });

  it('would notice: the manifest’s own colour icons are not pure black', () => {
    // Non-vacuity for the decoder as well as the assertion: if `decodePNG` ever returned zeroes
    // for everything, the check above would pass on any input.
    const colourIcon = Object.values(manifest.icons ?? {})[0];
    expect(colourIcon).toBeDefined();
    expect(colouredPixels(decodePNG(join(ROOT, colourIcon))).count).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------- *
 * The build has to compile the bundle, checked against **every** project definition on disk
 * (DECISIONS 231 — see {@link projectDefinitions}).
 *
 * The app target is anchored on `PiPOSSApp.swift` rather than on its name, and on a file that is
 * never itself one of the paths checked here, so the anchor cannot pass itself. It matters for
 * the same reason as `manifest.test.ts`'s extension anchor: an `AppIcon.icon` listed under the
 * *extension* target compiles into the `.appex`, leaving `PiPOSS.app` with a generic icon and
 * the build green.
 * ------------------------------------------------------------------------- */

describe('the .icon reaches the built app (RRR §10.1.9)', () => {
  it('is listed by the app target, in every project definition on disk', () => {
    for (const project of projectDefinitions()) {
      const haystack =
        project.path === 'project.yml'
          ? targetBlock(project.text, 'PiPOSSApp.swift')
          : project.text;

      expect(
        haystack,
        `${project.path} does not name ${ICON_BUNDLE} for the app target — actool is ` +
          'never handed the bundle and the app ships the generic icon',
      ).toContain(ICON_BUNDLE);
    }
  });

  it('is one reference in a copy phase, not a directory that got walked', () => {
    const generated = generatedProject();
    if (!generated) return; // fresh clone: nothing generated yet, the spec branch above stands

    // The property, without a cause attached: the bundle is *one* reference that a copy phase
    // lists, rather than `icon.json` and `Assets/glyph.svg` walked out as two loose resources.
    // That shape is what routes it to actool; lose it and the build stays green while the app
    // gets the generic icon.
    //
    // What produces the shape today is XcodeGen 2.46's own default — it treats any
    // extension-bearing directory as opaque, measured against both `.icon` and a fabricated
    // `.zzz`. So `project.yml`'s `type: file` is defensive rather than load-bearing: removing it
    // regenerates a byte-identical `project.pbxproj` and this test still passes. Kept anyway,
    // because the assertion is about the outcome rather than about XcodeGen keeping a default.
    const references = generated.text
      .split('\n')
      .filter((line) => line.includes(ICON_BUNDLE) && line.includes('isa = PBXFileReference'));
    expect(references, `no single PBXFileReference for ${ICON_BUNDLE}`).toHaveLength(1);

    expect(
      generated.text,
      `${ICON_BUNDLE} is referenced but no copy phase lists it, so nothing hands it to actool`,
    ).toContain(`${ICON_BUNDLE} in Resources`);
    expect(generated.text).not.toContain('glyph.svg in Resources');
    expect(generated.text).not.toContain('icon.json in Resources');

    // Deliberately NOT asserted: that the reference carries
    // `lastKnownFileType = folder.iconcomposer.icon`, the type `AssetCatalogCompiler.xcspec`
    // lists among actool's inputs. XcodeGen 2.46 has no entry for the `.icon` extension and
    // writes an invented `wrapper.icon` instead, with no spec key to override it
    // (`fileTypes.icon` sets the build phase, not the type). Measured: it does not matter —
    // `wrapper.icon` appears nowhere in Xcode's `StandardFileTypes.xcspec` and the build system
    // resolves `.icon` by extension anyway, grouping the bundle into the same actool invocation
    // as `Assets.xcassets`. Asserting the string would pin a value this generator cannot emit.
  });

  it('is the only asset named AppIcon, so actool cannot pick the other one', () => {
    // `ASSETCATALOG_COMPILER_APPICON_NAME` names one asset, so two assets called `AppIcon` in
    // one actool invocation is an ambiguity nothing here would notice.
    expect(existsSync(repo('PiPOSS/Assets.xcassets/AppIcon.appiconset'))).toBe(false);

    for (const project of projectDefinitions()) {
      expect(project.text).toContain('ASSETCATALOG_COMPILER_APPICON_NAME');
      expect(project.text).toMatch(/ASSETCATALOG_COMPILER_APPICON_NAME[ =:]+"?AppIcon"?;?/);
    }
  });
});
