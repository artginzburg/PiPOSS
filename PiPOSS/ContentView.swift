//
//  ContentView.swift
//  PiPOSS
//
//  The container app's one screen (RRR §4.7): one sentence of state, the site-access
//  guide, one button.
//
//  The guide is the app's main job, because the options page has no request button —
//  only the user can widen a Safari extension's site access, so Safari's Extensions pane
//  is the only place the grant happens. The drawing lives in
//  `SafariSettingsDiagram.swift`, together with the ground truth for its strings.
//
//  There is no second button, and there cannot be one: an app cannot open its
//  extension's options page (`dispatchMessage` does not reach `runtime.onMessage`, and
//  Apple's documented port route cannot wake a non-persistent MV3 background page — the
//  account is in `src/core/messages.ts`). The pane this button opens is one click away
//  from the options page, and the drawing says which click.
//
//  Wording is checked against `PiPOSS Extension/Resources/options.html`'s Access
//  section, which this must not contradict (RRR §4.3 lets the options page point here):
//  only the user can grant this, no extension can give itself access, the toolbar button
//  works either way, and the access popover is the other place Safari asks.
//

import Combine
import OSLog
import SafariServices
import SwiftUI

// MARK: - Extension state

/// What `SFSafariExtensionManager` can tell us, and nothing more. In particular it
/// says nothing about *site access* — an extension can be on and still allowed on
/// no website at all, which is the entire reason the guide below exists.
enum ExtensionState {
    case unknown
    case on
    case off

    /// One sentence, per RRR §4.7.
    var sentence: String {
        switch self {
        case .unknown:
            return "Safari has not said whether the PiPOSS extension is on."
        case .on:
            return "The PiPOSS extension is on in Safari."
        case .off:
            return "The PiPOSS extension is off in Safari."
        }
    }

    /// Not a verdict on whether PiPOSS works — `off` is a fact, not an error, and
    /// `unknown` is usually just Safari never having been opened.
    var tint: Color {
        switch self {
        case .unknown: return Color(NSColor.secondaryLabelColor)
        case .on: return Color(NSColor.systemGreen)
        case .off: return Color(NSColor.systemOrange)
        }
    }

    /// `tint` for anything drawn at a *fraction* of the colour, because `opacity()`
    /// multiplies rather than replaces. Measured: `secondaryLabelColor` is alpha 0.498 in
    /// light and 0.549 in dark, so in `unknown` `tint.opacity(0.12)` renders a 6 % wash
    /// and `opacity(0.45)` a 22 % border — least-certain state, weakest emphasis, which
    /// is backwards. `systemGray` reads the same neutral at alpha 1.0. The status dot
    /// keeps plain `tint`, where a half-alpha grey is the right, quieter answer.
    var leadTint: Color {
        switch self {
        case .unknown: return Color(NSColor.systemGray)
        case .on, .off: return tint
        }
    }

    /// The lead-in above the numbered steps, or `nil` when there is nothing to say.
    /// `headline` is set in bold and `detail` follows it after a space supplied at the
    /// join, so neither string carries invisible padding.
    ///
    /// Safari *disables* step 3's button while the extension is off, and in the case this
    /// app is for — single-profile, unmanaged, extension simply off — says nothing about
    /// why, so a new user was given an instruction that could not be carried out. This
    /// app already knows the state. Safari's own code is quoted in
    /// `SafariSettingsDiagram.swift`'s header.
    ///
    /// A lead-in rather than a fourth step because the tick is a prerequisite: it cannot
    /// be done before step 1 (the pane has to be open), and after step 3 it is too late.
    var enablingLead: (headline: String, detail: String)? {
        switch self {
        case .on:
            return nil
        case .off:
            return (
                "Turn PiPOSS on first.",
                """
                In the list in step 2 below, tick the checkbox next to PiPOSS. \
                Safari keeps “\(SafariPaneText.allowAllWebsites)” greyed out until the \
                extension is on, so step 3 cannot be done before this. The drawing marks \
                that checkbox 0.
                """
            )
        case .unknown:
            // Not "turn it on": we do not know that it is off, and stating an instruction
            // as a fact we have not got is the same mistake in the other direction.
            return (
                "Check that PiPOSS is ticked.",
                """
                Safari has not said whether the extension is on, and it keeps \
                “\(SafariPaneText.allowAllWebsites)” greyed out until it is. If the \
                checkbox next to PiPOSS in step 2's list is not ticked, tick it. The \
                drawing marks that checkbox 0.
                """
            )
        }
    }

    /// Whether the drawing marks PiPOSS's checkbox with callout ⓪.
    var drawsEnablingCallout: Bool { enablingLead != nil }

    /// Whether the drawing shows PiPOSS's checkbox ticked.
    ///
    /// `off` is the one state where we know it is not, so drawing it unticked makes the
    /// illustration match what the user is looking at. `unknown` is not a licence to
    /// guess, so it keeps the ticked picture and the lead-in above is worded as a check.
    var drawsExtensionTicked: Bool {
        switch self {
        case .on, .unknown: return true
        case .off: return false
        }
    }
}

/// Shared by the state reader and the settings button, because those two calls fail
/// together — both ask SafariServices to resolve the same extension identifier, so a
/// machine where one is broken has the other broken too. `os.Logger` needs macOS 11,
/// which is the deployment floor, so there is no availability check.
///
/// Discarding these errors is what left BF13 with nothing to read: the cause was 180
/// copies of this app registered with LaunchServices, all claiming this bundle
/// identifier, so SafariServices resolved it to a stray and reported `SFErrorDomain`
/// code 1. No code change could fix that and no test could catch it; one log line names
/// it in seconds. Read it back with (`log` is a zsh builtin, hence the absolute path):
///
///     /usr/bin/log show --last 10m --predicate 'subsystem == "org.artginzburg.PiPOSS"'
private let pipossLog = Logger(
    subsystem: extensionBundleIdentifier.replacingOccurrences(of: ".Extension", with: ""),
    category: "safari-services"
)

/// Reads the extension's state, and re-reads it whenever the app is brought back to
/// the front — which is exactly what happens after the user has been in Safari
/// turning the extension on, so the line is not stale by the time they look at it.
final class ExtensionStateReader: ObservableObject {
    @Published private(set) var state: ExtensionState = .unknown

    func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(
            withIdentifier: extensionBundleIdentifier
        ) { safariState, error in
            // The completion handler is main-actor-annotated in the SDK
            // (`NS_SWIFT_UI_ACTOR`), but the hop costs nothing and keeps this
            // correct if that annotation ever changes.
            DispatchQueue.main.async {
                guard let safariState = safariState, error == nil else {
                    // An error is not "off". Safari not having been launched yet is the
                    // common case, and claiming the extension is off would be a guess
                    // presented as a fact. `SFErrorDomain` code 1 is
                    // `SFErrorNoExtensionFound` — see `pipossLog` for why it is logged.
                    if let error = error as NSError? {
                        pipossLog.error(
                            """
                            getStateOfSafariExtension failed: \
                            \(error.domain, privacy: .public) \
                            code \(error.code, privacy: .public) — \
                            \(error.localizedDescription, privacy: .public)
                            """
                        )
                    } else {
                        pipossLog.error("getStateOfSafariExtension returned neither state nor error")
                    }
                    self.state = .unknown
                    return
                }
                self.state = safariState.isEnabled ? .on : .off
            }
        }
    }
}

// MARK: - The screen

struct ContentView: View {
    @StateObject private var reader = ExtensionStateReader()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                Divider()
                guide
                Divider()
                actions
            }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // The window must not ask the user to scroll before they have touched it.
        // Measured with `NSHostingView(rootView: ContentView().frame(width:))` laid out
        // headless, this modifier stripped so `fittingSize` reports the content. Tallest
        // state (`off`; `unknown` matches):
        //
        //     width 560 → 746    620 → 731    660 → 716    700 → 716    740 → 716
        //
        // It plateaus at 660 because the drawing is a fixed 364 pt (132 sidebar + 232
        // detail) and past that only the prose re-wraps. `on` is 637 at the same widths.
        // So 680 sits just inside the plateau with room for the scrollbar gutter, and 760
        // leaves 44 pt of slack over the 716 — ~788 with the title bar against the ~875
        // usable on a 1440×900 screen. `minHeight` stays 520 on purpose: the requirement
        // was that scrolling not be *required by default*, and a window that cannot be
        // made small is worse than one that scrolls when you make it small.
        .frame(minWidth: 560, idealWidth: 680, minHeight: 520, idealHeight: 760)
        .onAppear { reader.refresh() }
        .onReceive(
            NotificationCenter.default.publisher(
                for: NSApplication.didBecomeActiveNotification
            )
        ) { _ in
            reader.refresh()
        }
    }

    /// The three secondary-text treatments on this screen: same modifiers, same order.
    private func note(
        _ string: String,
        size: CGFloat = 12,
        color: NSColor = .secondaryLabelColor
    ) -> some View {
        Text(string)
            .font(.system(size: size))
            .foregroundColor(Color(color))
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Header — icon, name, one sentence of state

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(nsImage: Self.appIcon)
                .resizable()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("PiPOSS")
                    .font(.system(size: 22, weight: .semibold))

                HStack(spacing: 6) {
                    Circle()
                        .fill(reader.state.tint)
                        .frame(width: 7, height: 7)
                        .accessibilityHidden(true)
                    note(reader.state.sentence)
                }
            }

            Spacer(minLength: 0)
        }
    }

    /// The app's own icon, so this follows the bundle rather than a second copy that
    /// could drift from it. `Resources/Icon.png` is the fallback — it is in the bundle
    /// either way, because the README renders it.
    private static var appIcon: NSImage {
        NSImage(named: NSImage.applicationIconName)
            ?? NSImage(named: "Icon")
            ?? NSImage(size: NSSize(width: 64, height: 64))
    }

    // MARK: The guide

    private var guide: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Letting PiPOSS work on every website")
                    .font(.system(size: 15, weight: .semibold))

                // The ceiling, stated first rather than in a footnote: a tool that
                // implies it can widen its own access is lying about how Safari works.
                note(
                    """
                    Only you can grant this. No extension can give itself access to a website, \
                    and this app cannot click the button for you — it can only take you to it. \
                    The PiPOSS toolbar button works either way, on every website.
                    """
                )
            }

            // Above the steps, because a prerequisite read after the steps has not been
            // read at all. Same badge as the steps, so the ⓪ in the drawing has a
            // visible referent here.
            if let lead = reader.state.enablingLead {
                Step(0) { Text(lead.headline).bold() + Text(" ") + Text(lead.detail) }
                    .padding(10)
                    .plate(
                        radius: 6,
                        fill: reader.state.leadTint.opacity(0.12),
                        border: reader.state.leadTint.opacity(0.45),
                        lineWidth: 1
                    )
            }

            VStack(alignment: .leading, spacing: 7) {
                Step(1) { Text("Open Safari ▸ Settings ▸ Extensions. The button below does it.") }
                Step(2) { Text("Select ") + Text("PiPOSS").bold() + Text(" in the list on the left.") }
                Step(3) {
                    Text("Click ")
                        + Text(SafariPaneText.allowAllWebsites).bold()
                        + Text(" on the right.")
                }
            }

            SafariSettingsDiagram(state: reader.state)

            // The sixth honesty signal, the one outside SafariSettingsDiagram.swift: we
            // drew it, it is not the user's window, and here is the text to search for.
            note(
                """
                Drawn by PiPOSS from Safari 26's own wording — it is not a screenshot and not \
                a picture of your Safari, which may differ. The wording to look for is \
                “\(SafariPaneText.allowAllWebsites)”.
                """,
                size: 11,
                color: .tertiaryLabelColor
            )

            // options.html names this same second route; leaving it out here would make
            // the app look like it thinks all-sites is the only option.
            note(
                """
                Rather choose site by site? Safari also asks you in the access popover next to \
                the PiPOSS toolbar button, and PiPOSS's own settings always show where you stand.
                """
            )
        }
    }

    // MARK: Actions

    private var actions: some View {
        HStack(spacing: 10) {
            Button("Open Safari's Extension Settings", action: openSafariExtensionSettings)
                .keyboardShortcut(.defaultAction)
                .help("Safari ▸ Settings ▸ Extensions ▸ PiPOSS")

            Spacer(minLength: 0)
        }
    }

    /// Opens Safari ▸ Settings ▸ Extensions with PiPOSS selected, **and quits** — which
    /// is what the 2022 app did, and what the owner asked for again after a version that
    /// stayed open. By the time this is pressed the guide has done its work.
    ///
    /// Two details are load-bearing. The termination is inside the completion handler,
    /// not after the call, because quitting first can tear the process down before Safari
    /// has been asked. And it happens **only on success**: an unconditional quit turns
    /// "Safari did not open" into "the app vanished and nothing happened", which is how
    /// this shipped once. On failure the window stays, which is the only state in which
    /// the drawn guide is still in front of the person who now has to find the pane.
    private func openSafariExtensionSettings() {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: extensionBundleIdentifier
        ) { error in
            DispatchQueue.main.async {
                if let error = error as NSError? {
                    pipossLog.error(
                        """
                        showPreferencesForExtension failed: \
                        \(error.domain, privacy: .public) \
                        code \(error.code, privacy: .public) — \
                        \(error.localizedDescription, privacy: .public)
                        """
                    )
                    return
                }
                NSApplication.shared.terminate(nil)
            }
        }
    }
}

// MARK: - A numbered step, matching the badges in the drawing

private struct Step<Content: View>: View {
    let number: Int
    let content: Content

    init(_ number: Int, @ViewBuilder content: () -> Content) {
        self.number = number
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            // `alternateSelectedControlTextColor` is AppKit's "text on an accent-filled
            // selection"; see `Diagram.onSelection` for why the obvious alternative is
            // wrong in dark mode.
            Text("\(number)")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Color(NSColor.alternateSelectedControlTextColor))
                .frame(width: 16, height: 16)
                .background(Circle().fill(Color(NSColor.selectedContentBackgroundColor)))
                .accessibilityHidden(true)

            content
                .font(.system(size: 12.5))
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
    }
}
