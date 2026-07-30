#!/usr/bin/env xcrun swift
//
//  design/icon/render.swift — every derived icon artefact in the repository.
//
//  Run it with:      xcrun swift design/icon/render.swift        (from the repo root)
//  or:               make icons
//
//  It reads the two Figma exports the owner supplied and writes:
//
//    AppIcon.icon/Assets/glyph.svg                          the Icon Composer layer
//    PiPOSS Extension/Resources/images/toolbar-icon-*.png   Safari's toolbar button
//    PiPOSS Extension/Resources/images/icon-*.png           the manifest's `icons`
//    PiPOSS/Resources/Icon.png                              the README / app fallback
//
//  Nothing here is hand-edited, and there is deliberately no committed intermediate
//  between the Figma exports and these outputs: a second copy of the artwork that
//  nothing reads is a second source of truth, and it drifts.  `test/icon.test.ts`
//  re-derives the interesting properties and fails if an output stops matching the
//  source, so the generator is checkable rather than merely trusted.
//
//  WHY THIS IS SWIFT.  There is no SVG rasteriser on this machine — no rsvg-convert,
//  no ImageMagick, no cairo, and Python has no PIL.  macOS itself can do it:
//  `NSImage(contentsOf:)` reads SVG (it comes back as an `_NSSVGImageRep`), which
//  makes AppKit the one rasteriser available without adding a dependency.  Nothing
//  here opens a window or touches the keychain.
//
//  WHY THE GEOMETRY IS MEASURED AND NOT WRITTEN DOWN.  The glyph's bounding box
//  inside `ToolbarIcon.svg` is found by rendering it and reading the alpha, not by a
//  constant.  A re-export from Figma that moves the artwork therefore still produces
//  a correctly framed icon, and one that changes it beyond recognition trips the
//  assertion below instead of silently shipping a mis-framed glyph.
//

import AppKit
import Foundation

// ---------------------------------------------------------------- the one number

/// The glyph's bounding-box width as a fraction of the icon's rounded-rect width.
///
/// Measured on this machine from Apple's own macOS 26 icons, whose art is compiled
/// from `.icon` bundles exactly like ours (`assetutil --info` on, for instance,
/// FaceTime's `Assets.car` reports an `IconImageStack` with `CanvasWidth 1024` over
/// `AppIcon_Assets/3.camera`, an SVG layer).  Rendering their `AppIcon.icns` at 1024
/// puts the rounded rect at 824×824 every time, and the white glyph inside it at:
///
///     FaceTime 0.688   Stocks 0.703   Chess 0.738   TV 0.748     (÷ shape width)
///
/// 0.72 is the middle of that band.  The owner's drawing was at 0.633, which is why
/// he asked for the symbol to be bigger; see docs/icon.md for the full reasoning.
let glyphFraction = 0.72

/// The glyph colour, from `design/icon/PiP-final.svg`.
let teal = "#36DBC7"

// `PiP-final.svg`'s background, with its `filter0_d` drop shadow dropped: on the app
// icon Icon Composer draws the shadow, and on a flat PNG there is nothing to cast one
// onto.  Coordinates are that file's own 257-unit canvas.
let canvas = 257.0, rectOrigin = 10.0, rectSide = 236.0, cornerRadius = 50.0
let rectCentre = rectOrigin + rectSide / 2  // 128 — the rounded rect is 0.5 off the canvas centre
let gradientTop = "#F0F0F0", gradientBottom = "#FFFFFF", gradientY0 = 45.0, gradientY1 = 246.0

let toolbarSizes = [16, 19, 32, 38, 48, 72]
let manifestIconSizes = [48, 64, 96, 128, 256, 512]

// -------------------------------------------------------------------- plumbing

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)

func die(_ message: String) -> Never {
    FileHandle.standardError.write("render.swift: \(message)\n".data(using: .utf8)!)
    exit(1)
}

func read(_ relative: String) -> String {
    guard let s = try? String(contentsOf: root.appendingPathComponent(relative), encoding: .utf8)
    else { die("cannot read \(relative) — run this from the repository root") }
    return s
}

func write(_ text: String, to relative: String) {
    let url = root.appendingPathComponent(relative)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                            withIntermediateDirectories: true)
    do { try text.write(to: url, atomically: true, encoding: .utf8) }
    catch { die("cannot write \(relative): \(error)") }
    print("  wrote \(relative)")
}

/// An RGBA8 bitmap, straight (never premultiplied), so what a PNG byte says is what
/// the artwork says.  The toolbar icons are asserted to be pure black downstream and
/// premultiplication would quietly change the values that assertion reads.
struct Bitmap {
    let n: Int
    var px: [UInt8]

    /// Rasterises SVG source through AppKit at `n`×`n`.
    init(svg: String, size n: Int) {
        self.n = n
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("piposs-render-\(UUID().uuidString).svg")
        try? svg.write(to: tmp, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: tmp) }
        guard let image = NSImage(contentsOf: tmp) else { die("AppKit could not rasterise the SVG") }

        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8,
                                  bytesPerRow: n * 4, space: space,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { die("cannot make a \(n)x\(n) bitmap context") }
        ctx.clear(CGRect(x: 0, y: 0, width: n, height: n))
        ctx.interpolationQuality = .high
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        image.draw(in: CGRect(x: 0, y: 0, width: n, height: n),
                   from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()

        let base = ctx.data!.bindMemory(to: UInt8.self, capacity: n * n * 4)
        px = [UInt8](repeating: 0, count: n * n * 4)
        for i in stride(from: 0, to: n * n * 4, by: 4) {
            let a = Int(base[i + 3])
            px[i + 3] = base[i + 3]
            guard a > 0 else { continue }
            for c in 0..<3 { px[i + c] = UInt8(min(255, (Int(base[i + c]) * 255 + a / 2) / a)) }
        }
    }

    /// Zeroes every colour channel, keeping alpha.  Safari treats a grayscale toolbar
    /// image as a template and tints it with the system accent colour and appearance
    /// (RRR §12), so the shipped PNGs must be black-with-alpha and nothing else.  Doing
    /// it here makes that a property of the pipeline rather than of the artwork.
    mutating func blacken() {
        for i in stride(from: 0, to: n * n * 4, by: 4) where px[i + 3] > 0 {
            px[i] = 0; px[i + 1] = 0; px[i + 2] = 0
        }
    }

    func writePNG(to relative: String) {
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: n, pixelsHigh: n,
                                        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                        isPlanar: false,
                                        colorSpaceName: .deviceRGB,
                                        bitmapFormat: .alphaNonpremultiplied,
                                        bytesPerRow: n * 4, bitsPerPixel: 32)
        else { die("cannot make a bitmap rep") }
        _ = px.withUnsafeBufferPointer { memcpy(rep.bitmapData!, $0.baseAddress!, n * n * 4) }
        guard let data = rep.representation(using: .png, properties: [:])
        else { die("PNG encoding failed") }
        let url = root.appendingPathComponent(relative)
        do { try data.write(to: url) } catch { die("cannot write \(relative): \(error)") }
        print("  wrote \(relative)  (\(n)×\(n))")
    }

    /// The bounding box of everything not fully transparent, in pixels.
    var inkBox: (x0: Int, y0: Int, x1: Int, y1: Int)? {
        var x0 = n, y0 = n, x1 = -1, y1 = -1
        for y in 0..<n {
            for x in 0..<n where px[(y * n + x) * 4 + 3] > 0 {
                x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
            }
        }
        return x1 < 0 ? nil : (x0, y0, x1, y1)
    }
}

// ----------------------------------------------------- the owner's glyph, measured

let toolbarSource = read("design/icon/ToolbarIcon.svg")

/// The `<path .../>` elements of `ToolbarIcon.svg`, verbatim apart from the fill colour.
///
/// That file is the whole mark already flattened: the window outline is an outlined
/// path, the three dots are even-odd holes rather than white circles on top, and no
/// filter is involved.  It is also provably the same geometry as the glyph inside
/// `PiP-final.svg`, translated by (+50, +49) — every corresponding coordinate agrees,
/// which is checked in `test/icon.test.ts`.  So the flat, effect-free glyph Icon
/// Composer needs already exists in the owner's own export and does not have to be
/// reconstructed from the filtered one.
func glyphPaths(fill: String) -> String {
    let pattern = try! NSRegularExpression(pattern: "<path\\b[^>]*/>")
    let ns = toolbarSource as NSString
    let found = pattern.matches(in: toolbarSource, range: NSRange(location: 0, length: ns.length))
        .map { ns.substring(with: $0.range) }
    guard found.count == 4 else {
        die("expected 4 <path> elements in ToolbarIcon.svg, found \(found.count)")
    }
    return found
        .map { $0.replacingOccurrences(of: "\"black\"", with: "\"\(fill)\"") }
        .joined(separator: "\n")
}

/// `ToolbarIcon.svg` re-framed on an arbitrary square window of its own user space.
func glyphSVG(fill: String, centre: (Double, Double), side: Double, pixels: Int) -> String {
    let box = String(format: "%.4f %.4f %.4f %.4f",
                     centre.0 - side / 2, centre.1 - side / 2, side, side)
    return """
        <svg width="\(pixels)" height="\(pixels)" viewBox="\(box)" fill="none" \
        xmlns="http://www.w3.org/2000/svg">
        \(glyphPaths(fill: fill))
        </svg>

        """
}

// Measure the glyph rather than trusting a constant: render the owner's export at 10×
// its own canvas and read the alpha bounds back into user units.
let probeScale = 10.0
let probeCanvas = 158.0  // `ToolbarIcon.svg`'s own width/height attribute
let probe = Bitmap(svg: toolbarSource.replacingOccurrences(
    of: "width=\"158\" height=\"158\"",
    with: "width=\"\(Int(probeCanvas * probeScale))\" height=\"\(Int(probeCanvas * probeScale))\""),
    size: Int(probeCanvas * probeScale))
guard let ink = probe.inkBox else { die("ToolbarIcon.svg rendered empty") }

let glyphWidth = Double(ink.x1 - ink.x0 + 1) / probeScale
let glyphHeight = Double(ink.y1 - ink.y0 + 1) / probeScale
let glyphCentre = (Double(ink.x0 + ink.x1 + 1) / 2 / probeScale,
                   Double(ink.y0 + ink.y1 + 1) / 2 / probeScale)

print(String(format: "glyph in ToolbarIcon.svg: %.2f × %.2f at centre (%.2f, %.2f)",
             glyphWidth, glyphHeight, glyphCentre.0, glyphCentre.1))

// A re-export may move the artwork; it may not become a different drawing unnoticed.
// 149.4, not 149.3: that is what the measurement returns, and `test/icon.test.ts` reads
// this constant to check the shipped viewBox encodes `glyphFraction`. A tenth of a unit
// out here moved that derived fraction to 0.71952 — inside the test's tolerance by
// 0.00048, i.e. a false failure waiting for the next re-export.
guard abs(glyphWidth - 149.4) < 2, abs(glyphHeight - 122.0) < 2 else {
    die("""
        the glyph in design/icon/ToolbarIcon.svg now measures \
        \(String(format: "%.2f × %.2f", glyphWidth, glyphHeight)) user units, not the \
        149.4 × 122.0 this generator was written against.
        If the drawing really changed, update the expected size here and in
        docs/icon.md — do not widen the tolerance to make this pass.
        """)
}

// ----------------------------------------------------------- 1. the Icon Composer layer

// The layer is authored on the 1024-point canvas Icon Composer uses (`CanvasWidth
// 1024` in every compiled `.icon` on this machine, Apple's included), with the glyph
// occupying `glyphFraction` of it.  Measured: a glyph filling fraction f of the layer
// canvas fills exactly f of the rendered rounded rect, centred — so this one number is
// the whole size decision.
write(glyphSVG(fill: teal, centre: glyphCentre, side: glyphWidth / glyphFraction, pixels: 1024),
      to: "AppIcon.icon/Assets/glyph.svg")

// -------------------------------------------------------------- 2. the toolbar PNGs
//
// Framing is inherited from the PNGs this replaces, which are edge-to-edge
// horizontally: the window is Safari's to pad, and the owner has been looking at that
// weight in his toolbar for four years.  `glyphFraction` deliberately does not apply
// here — the owner asked for a bigger symbol inside the *app* icon.

print("toolbar icons:")
for size in toolbarSizes {
    var bitmap = Bitmap(svg: glyphSVG(fill: "black", centre: glyphCentre,
                                      side: glyphWidth, pixels: size), size: size)
    bitmap.blacken()
    bitmap.writePNG(to: "PiPOSS Extension/Resources/images/toolbar-icon-\(size).png")
}

// ------------------------------------------------- 3. the flat composite, and its PNGs
//
// `PiP-final.svg` with the four baked filters gone and the glyph resized: the same
// composition, drawn flat.  Icon Composer supplies shadow, specular and glass for the
// app icon itself, so these PNGs — Safari's extension list and the README — are the
// artwork without a system treatment, not a worse copy of one.

let flat = """
    <svg width="1024" height="1024" viewBox="0 0 \(Int(canvas)) \(Int(canvas))" fill="none" \
    xmlns="http://www.w3.org/2000/svg">
    <defs>
    <linearGradient id="bg" x1="\(rectCentre)" y1="\(gradientY0)" x2="\(rectCentre)" \
    y2="\(gradientY1)" gradientUnits="userSpaceOnUse">
    <stop stop-color="\(gradientTop)"/>
    <stop offset="1" stop-color="\(gradientBottom)"/>
    </linearGradient>
    </defs>
    <rect x="\(rectOrigin)" y="\(rectOrigin)" width="\(rectSide)" height="\(rectSide)" \
    rx="\(cornerRadius)" fill="url(#bg)"/>
    <g transform="translate(\(rectCentre) \(rectCentre)) \
    scale(\(rectSide * glyphFraction / glyphWidth)) \
    translate(\(-glyphCentre.0) \(-glyphCentre.1))">
    \(glyphPaths(fill: teal))
    </g>
    </svg>

    """

print("manifest icons:")
for size in manifestIconSizes {
    Bitmap(svg: flat, size: size)
        .writePNG(to: "PiPOSS Extension/Resources/images/icon-\(size).png")
}
print("app fallback / README image:")
Bitmap(svg: flat, size: 1024).writePNG(to: "PiPOSS/Resources/Icon.png")
