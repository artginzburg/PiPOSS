//
//  SafariSettingsDiagram.swift
//  PiPOSS
//
//  A **drawing** of Safari's Settings ▸ Extensions pane (RRR §4.7) — not a screenshot,
//  and deliberately not a facsimile. Prose telling people to "go to Safari ▸ Settings ▸
//  Extensions" had proved insufficient; a screenshot would go stale with every Safari
//  release, could not be localised and could not follow light and dark, whereas
//  vector-drawn the only parts that can go stale are six short strings.
//
//  ## Why it must not look like Safari — and the five signals that keep it honest
//
//  This is the one screen in the product whose subject is trust, so a diagram that could
//  pass for the user's own window would be a dishonesty in exactly the wrong place. Five
//  independent signals, so that losing one in a later edit is not enough:
//
//  1. **Numbered callout badges** (①②③, and ⓪ while the extension is off) tying the
//     drawing to the steps beside it. Safari has no numbered badges anywhere.
//  2. **A dashed border captioned "Illustration — not Safari".**
//  3. **Placeholder bars instead of body text** for every sentence the user does not need
//     to *find*. Real UI has real text everywhere; a diagram has bars. This is also what
//     makes the drawing near-translation-free.
//  4. **No window chrome** — no traffic lights, title bar, toolbar, tab strip, Safari
//     icon, or other pane names invented to fill the row.
//  5. **Inert and announced**: `allowsHitTesting(false)`, and one accessibility element
//     whose label begins "Illustration".
//
//  A sixth lives in `ContentView.swift`, so an edit confined to this file cannot remove
//  every signal (DECISIONS 220).
//
//  ## Ground truth, and where it came from
//
//  The pane's detail view is not AppKit — Safari renders it from a bundled web page. Every
//  string quoted below was read out of Safari 26.5's own resources on 2026-07-28:
//
//    /System/Library/PrivateFrameworks/Safari.framework/Versions/A/Resources/
//      ExtensionPermissions.html    section shape: Permissions / Private Browsing
//      ExtensionPermissions.js      the branch an extension like PiPOSS lands in
//      en.lproj/Localizable.strings  the sidebar and window strings
//
//  For an extension that injects a content script and requests all hosts — PiPOSS:
//  `content_scripts` matching `*://*/*` plus `host_permissions` — with nothing granted
//  yet, `displayPermissions()` takes the `configuredSiteAccess != "All"` branch and emits,
//  in this order:
//
//    "Permissions:"
//    "Webpage Contents and Browsing History"
//    "When you use the “PiPOSS” toolbar button, …"          ← drawn as bars
//    "You have not allowed this extension on any websites yet."
//    button "Edit Websites…"
//    button "Always Allow on Every Website…"                ← the one to click
//
//  That last button appears only when `requestedSiteAccess == "All" &&
//  configuredSiteAccess != "All"`, i.e. exactly while the user still has the choice to
//  make. Both button labels carry a real trailing ellipsis in Safari's source.
//
//  **Not** established and therefore not drawn: the pane's pixel metrics, its sidebar
//  width, the Settings window's toolbar row (the breadcrumb strip is a label, not a copy
//  of that row), and the wording of the sheet the button opens.
//
//  ## Why the drawing depends on whether the extension is on (BF08)
//
//  Because Safari **disables** the button while the extension is off, so a single-state
//  drawing cannot stay useful. From the same file, same date:
//
//    ExtensionPermissions.js:399-403
//      allowAllWebsitesButton.textContent = …UIString("Always Allow on Every Website…");
//      let allowAllWebsitesButtonEnabled = isEnabledInAnyProfile(websiteAccess, enabled);
//      const allDomainsManaged = websiteAccess?.["AllDomainsAreManaged"] || false;
//      allowAllWebsitesButtonEnabled &&= !allDomainsManaged;
//      allowAllWebsitesButton.disabled = !allowAllWebsitesButtonEnabled;
//
//    ExtensionPermissions.js:483-486
//      function isEnabledInAnyProfile(websiteAccess, enabled)
//      { return enabled || websiteAccess?.["Enabled Profiles"]?.length > 0; }
//
//  `:392` disables "Edit Websites…" on the same condition. Two of the 21 uses of `enabled`
//  in the file *do* explain a greying — `:520-528` prints "“%@” is not active in any
//  profiles." and `:363-393` prints the device-management notice for the
//  `AllDomainsAreManaged` case at `:401-402` — so the claim is the narrow one: **when the
//  cause is this profile's extension simply being off, the new-user case and the only one
//  this app can detect, Safari prints no explanation**, and `ExtensionPermissions.html`
//  contains no "turn"/"enable"/"off" text at all. Supplying it is this app's job, which is
//  why `state` is a required initialiser argument: a diagram that silently defaulted to
//  the enabled picture would be the bug again.
//
//  Left undrawn for the same "nothing invented" reason: Safari's *disabled* rendering of
//  that button, which would be a guess at WebKit's disabled-control appearance — and a
//  dimmed button under a callout saying "click this" reads as a contradiction. The drawing
//  points at the checkbox instead.
//

import Foundation
import SwiftUI

// MARK: - Safari's own strings, in one place

/// Every string this drawing quotes from Safari's own resources, named once — because the
/// spoken description below and `ContentView.swift` quote the same labels, and a rename
/// that touched only `DrawnButton` would make them disagree silently (DECISIONS 227).
///
/// The trailing ellipses are real U+2026, as they are in Safari's source.
enum SafariPaneText {
    static let permissionsHeading = "Permissions:"
    static let permissionKind = "Webpage Contents and Browsing History"
    static let noWebsitesYet = "You have not allowed this extension on any websites yet."
    static let editWebsites = "Edit Websites…"
    static let allowAllWebsites = "Always Allow on Every Website…"

    /// `allowAllWebsites` with the one line break the drawn button needs, derived rather
    /// than written out again, so the label above stays the single literal — which is also
    /// what makes it findable in the built binary.
    ///
    /// **The failure mode, measured:** if the words " Every" ever leave the label,
    /// `replacingOccurrences` returns the string unchanged with no diagnostic, and the
    /// unbroken title is 150 pt wide → a 162 pt button, which with "Edit Websites…"
    /// (80 pt) and the 6 pt gap needs 248 pt inside a **212 pt** box. 36 pt of overflow:
    /// silent *and* visually wrong. A reword of the label owes this line a look.
    static let allowAllWebsitesDrawn = allowAllWebsites.replacingOccurrences(
        of: " Every", with: "\nEvery"
    )
}

// MARK: - Diagram

struct SafariSettingsDiagram: View {
    /// Whether Safari says the extension is on — which decides whether PiPOSS's own
    /// checkbox is drawn ticked, and whether callout ⓪ marks it. Deliberately has
    /// **no default value**: see the note on BF08 in the file header.
    let state: ExtensionState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            breadcrumb
            Divider()
            HStack(alignment: .top, spacing: 0) {
                sidebar
                Divider()
                detail
            }
            // A floor for the whole pane, so the sidebar's four rows are not the only
            // thing setting its height. `Divider()` in an `HStack` spans the taller column
            // either way, so neither column needs a fixed height.
            .frame(minHeight: 150, alignment: .topLeading)
        }
        .plate(radius: 7, fill: Diagram.paneFill, border: Diagram.hairline, lineWidth: 1)
        .padding(Diagram.mountInset)
        .overlay(mountBorder)
        // A user who aims at the drawn button has misunderstood it, and a control that
        // highlights under the pointer invites exactly that misunderstanding.
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.accessibilityDescription(for: state))
    }

    /// Assembled from `SafariPaneText` rather than retyping the drawn labels, so the spoken
    /// description cannot drift from the drawing (DECISIONS 227). It still hand-describes
    /// the *layout* — but that is this file's own invention, not Safari's, so it cannot go
    /// stale behind our back.
    static func accessibilityDescription(for state: ExtensionState) -> Text {
        Text(accessibilityText(for: state))
    }

    /// Split out from the `Text` above so it can be printed: almost nothing else about
    /// this file can be verified by running anything.
    static func accessibilityText(for state: ExtensionState) -> String {
        // The callout ⓪ clause is appended as its own sentence rather than spliced into
        // the one below, so the `on` label is word for word the one that shipped.
        let checkboxSentence: String
        switch state {
        case .on:
            checkboxSentence = ""
        case .off:
            checkboxSentence =
                " PiPOSS's own checkbox is drawn unticked and marked callout 0:"
                + " Safari keeps that second button greyed out until it is ticked."
        case .unknown:
            checkboxSentence =
                " PiPOSS's own checkbox is drawn ticked and marked callout 0:"
                + " Safari keeps that second button greyed out until the extension is on,"
                + " and Safari has not said whether it is."
        }

        return """
            Illustration, drawn by PiPOSS and not a picture of your Safari. \
            It shows Safari's Settings, Extensions pane: a list of installed extensions \
            on the left with PiPOSS selected, and on the right a Permissions section \
            reading “\(SafariPaneText.noWebsitesYet)” above two \
            buttons, “\(SafariPaneText.editWebsites)” and \
            “\(SafariPaneText.allowAllWebsites)”. \
            The second button is the one to click.\(checkboxSentence)
            """
    }

    // MARK: Mount — the dashed border and its caption

    private var mountBorder: some View {
        RoundedRectangle(cornerRadius: 11)
            .strokeBorder(
                Diagram.accent.opacity(0.55),
                style: StrokeStyle(lineWidth: 1, dash: [4, 3])
            )
    }

    /// In the drawing's own header rather than floating in the dashed ring, so it can
    /// never be clipped or overlap the pane.
    private var mountCaption: some View {
        Text("Illustration — not Safari")
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(Diagram.accent)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Capsule().fill(Diagram.captionFill))
    }

    // MARK: Breadcrumb — a label, not a copy of Safari's toolbar row

    private var breadcrumb: some View {
        HStack(spacing: 6) {
            CalloutBadge(1)
            Text("Settings ▸ Extensions")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(Diagram.dimText)
            Spacer(minLength: 8)
            mountCaption
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
    }

    // MARK: Sidebar — "Installed", with PiPOSS selected

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 5) {
            // Safari groups the sidebar under headers; "Installed" is the one an ordinary
            // user sees ("Temporary" and "On Other Devices" are the others).
            Text("Installed")
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(Diagram.dimText)
                .padding(.leading, 6)

            PlaceholderRow(width: 52)
            selectedRow
            PlaceholderRow(width: 44)
            PlaceholderRow(width: 58)

            Spacer(minLength: 0)
        }
        .padding(.vertical, 7)
        // Width is fixed because it is part of the drawing's proportions; height is a
        // floor, not a cap. A fixed height plus wrapping text is how a diagram silently
        // clips itself where font metrics differ, and no build log can show that.
        .frame(width: 132, alignment: .topLeading)
    }

    private var selectedRow: some View {
        HStack(spacing: 5) {
            // ⓪ rather than a fourth number: the tick is a prerequisite for step 3, not a
            // fourth thing to do afterwards, so badges ①②③ stay tied to the same three
            // steps. It carries no drawn words — the sidebar is 132 pt wide, and words
            // next to a Safari control could be read as one of Safari's own labels.
            if state.drawsEnablingCallout {
                CalloutBadge(0, onAccent: true)
            }
            DrawnCheckbox(
                checked: state.drawsExtensionTicked,
                // `&& !checked` because `emphasised` has no effect on a ticked box — both
                // `fill` and `border` early-return on `checked`, so passing it in
                // `unknown` (ticked *and* callout) claimed emphasis that was not drawn.
                emphasised: state.drawsEnablingCallout && !state.drawsExtensionTicked
            )
            Text("PiPOSS")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(Diagram.onSelection)
            Spacer(minLength: 0)
            CalloutBadge(2, onAccent: true)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 4).fill(Diagram.selectionFill))
        .padding(.horizontal, 4)
    }

    // MARK: Detail — the Permissions section

    private var detail: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(SafariPaneText.permissionsHeading)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Diagram.text)

            Text(SafariPaneText.permissionKind)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(Diagram.text)

            // Safari's long "When you use the “PiPOSS” toolbar button…" paragraph: the
            // user has no reason to hunt for it, and bars are what stop this drawing
            // reading as a screenshot.
            VStack(alignment: .leading, spacing: 3) {
                PlaceholderBar(width: 196)
                PlaceholderBar(width: 208)
                PlaceholderBar(width: 122)
            }
            .padding(.top, 1)

            // Real text, because it is the sentence that tells the user they are looking
            // at the right thing and have not done it yet.
            Text(SafariPaneText.noWebsitesYet)
                .font(.system(size: 9.5))
                .foregroundColor(Diagram.dimText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 1)

            buttons
                .padding(.top, 6)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(width: 232, alignment: .topLeading)
    }

    private var buttons: some View {
        HStack(alignment: .top, spacing: 6) {
            // Named rather than left as a bar: seeing both labels is how the user
            // confirms they are in the right pane. Dimmed and unbadged, so there is no
            // doubt which of the two the callout means.
            DrawnButton(title: SafariPaneText.editWebsites, emphasised: false)

            VStack(spacing: 3) {
                DrawnButton(title: SafariPaneText.allowAllWebsitesDrawn, emphasised: true)
                HStack(spacing: 3) {
                    CalloutBadge(3)
                    Text("click this")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(Diagram.accent)
                }
            }
        }
    }
}

// MARK: - Diagram parts

/// A filled rounded rectangle with a border of the same radius — the shape this drawing
/// repeats, and the one `ContentView.swift` draws its lead-in box with.
extension View {
    func plate(radius: CGFloat, fill: Color, border: Color, lineWidth: CGFloat) -> some View {
        background(RoundedRectangle(cornerRadius: radius).fill(fill))
            .overlay(
                RoundedRectangle(cornerRadius: radius).strokeBorder(border, lineWidth: lineWidth)
            )
    }
}

/// A numbered callout, tying a spot in the drawing to a numbered step beside it.
/// Nothing in Safari looks like this, which is the point.
private struct CalloutBadge: View {
    let number: Int
    let onAccent: Bool

    init(_ number: Int, onAccent: Bool = false) {
        self.number = number
        self.onAccent = onAccent
    }

    var body: some View {
        Text("\(number)")
            .font(.system(size: 8, weight: .bold))
            .foregroundColor(onAccent ? Diagram.selectionFill : Diagram.onSelection)
            .frame(width: 13, height: 13)
            .background(Circle().fill(onAccent ? Diagram.onSelection : Diagram.accent))
    }
}

/// Body copy the user does not need to read, drawn as what it is: a placeholder.
private struct PlaceholderBar: View {
    let width: CGFloat
    var height: CGFloat = 4

    var body: some View {
        Capsule()
            .fill(Diagram.placeholder)
            .frame(width: width, height: height)
    }
}

/// A sidebar row for some other extension. Unnamed on purpose — inventing names for
/// extensions the user may not have would be inventing a screenshot.
private struct PlaceholderRow: View {
    let width: CGFloat

    var body: some View {
        HStack(spacing: 5) {
            DrawnCheckbox(checked: false)
            PlaceholderBar(width: width)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
    }
}

/// Drawn with a `Path` rather than an SF Symbol: the deployment floor is macOS 11
/// (SF Symbols 2), so a symbol name is one more thing that can silently render as
/// nothing on an old system. A path cannot.
private struct DrawnCheckbox: View {
    let checked: Bool

    /// Set for PiPOSS's own checkbox while the extension is off, i.e. exactly when callout
    /// ⓪ points at it. An unticked box sits on the accent-filled selected row there, where
    /// `controlFill` (`labelColor` at 5.5 %) would be all but invisible — so it is drawn
    /// in `onSelection` instead. No new colour is guessed.
    var emphasised: Bool = false

    var body: some View {
        RoundedRectangle(cornerRadius: 2.5)
            .fill(fill)
            .overlay(
                RoundedRectangle(cornerRadius: 2.5)
                    .strokeBorder(border, lineWidth: emphasised ? 1.2 : 0.8)
            )
            .overlay(checked ? AnyView(checkmark) : AnyView(EmptyView()))
            .frame(width: 10, height: 10)
    }

    private var fill: Color {
        if checked { return Diagram.selectionFill }
        return emphasised ? Diagram.onSelection.opacity(0.18) : Diagram.controlFill
    }

    private var border: Color {
        if checked { return .clear }
        return emphasised ? Diagram.onSelection : Diagram.hairline
    }

    private var checkmark: some View {
        Path { path in
            path.move(to: CGPoint(x: 2.2, y: 5.2))
            path.addLine(to: CGPoint(x: 4.1, y: 7.2))
            path.addLine(to: CGPoint(x: 7.8, y: 2.9))
        }
        .stroke(Diagram.onSelection, style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
    }
}

/// A drawn push button. Flat and undersized next to a real AppKit button, which is
/// another reason the drawing does not pass for the real pane.
private struct DrawnButton: View {
    let title: String
    let emphasised: Bool

    var body: some View {
        Text(title)
            .font(.system(size: 9, weight: emphasised ? .semibold : .regular))
            .multilineTextAlignment(.center)
            .foregroundColor(emphasised ? Diagram.accent : Diagram.dimText)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .plate(
                radius: 4,
                fill: emphasised ? Diagram.emphasisFill : Diagram.controlFill,
                border: emphasised ? Diagram.accent : Diagram.hairline,
                lineWidth: emphasised ? 1.4 : 0.8
            )
    }
}

// MARK: - Palette

/// Deliberately flat and low-contrast: a diagram's palette, not the system control
/// palette, so the drawing does not sit in the window looking like live controls. All of
/// it is derived from semantic `NSColor`s, so light and dark and the user's accent colour
/// come for free — which a screenshot could never do.
private enum Diagram {
    static let mountInset: CGFloat = 7

    static let accent = Color.accentColor
    static let text = Color(NSColor.labelColor)
    static let dimText = Color(NSColor.secondaryLabelColor)

    /// The two colours AppKit itself uses for a selected list row, rather than
    /// `accentColor` plus a guess at what reads on it. `textBackgroundColor` was the first
    /// guess and it is near-black in dark mode, so a badge drawn with it on an
    /// accent-filled row was dark-on-dark. These two are defined as a pair and are correct
    /// in both appearances.
    static let selectionFill = Color(NSColor.selectedContentBackgroundColor)
    static let onSelection = Color(NSColor.alternateSelectedControlTextColor)

    static let paneFill = Color(NSColor.textBackgroundColor).opacity(0.55)
    static let controlFill = Color(NSColor.labelColor).opacity(0.055)
    static let emphasisFill = Color.accentColor.opacity(0.13)
    static let captionFill = emphasisFill
    static let placeholder = Color(NSColor.labelColor).opacity(0.16)
    static let hairline = Color(NSColor.separatorColor)
}
