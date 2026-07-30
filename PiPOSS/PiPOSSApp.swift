//
//  PiPOSSApp.swift
//  PiPOSS
//
//  The container app's entry point (RRR §4.7), in place of the AppKit trio this target
//  shipped from 2022 to 2026 (`Main.storyboard` → `AppDelegate` → `ViewController` → a
//  `WKWebView`). The two build settings that went with it — `NSMainStoryboardFile` gone,
//  `-framework WebKit` gone — are justified in project.yml, next to the settings.
//
//  Deployment target is macOS 11.0 (RRR §2) and **stays** there, which is a real
//  constraint on everything in this target: no `.task`, no `foregroundStyle`, no
//  `Canvas`, no `Grid`, no dot-shorthand button styles, and no markdown in `Text`
//  (macOS 11 renders `**bold**` literally, hence the `Text(…) + Text(…).bold()`
//  concatenations in ContentView). If a build starts failing on availability, the fix is
//  the older API, not a higher floor: macOS 11 is a promise in the README.
//

import SafariServices
import SwiftUI

/// The extension's bundle id (RRR §2 pins it; renaming is out of scope per §11).
/// Both `SFSafariExtensionManager` and `SFSafariApplication` are keyed on it.
let extensionBundleIdentifier = "org.artginzburg.PiPOSS.Extension"

@main
struct PiPOSSApp: App {
    // Kept only for `applicationShouldTerminateAfterLastWindowClosed`: this is a
    // launcher, not a resident app, and SwiftUI on macOS 11 has no scene-level
    // equivalent.
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .commands {
            // One window is the whole app (RRR §4.7), so File ▸ New Window would only
            // produce a second copy of the same guide.
            CommandGroup(replacing: .newItem) {}
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
