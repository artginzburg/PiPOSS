//
//  AppDelegate.swift
//  PiPOSS
//
//  Created by Arthur Ginzburg on 23.08.2022.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Override point for customization after application launch.

        registerDefaultPreferenceValues()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}

func registerDefaultPreferenceValues() {
    let defaultValuesToRegister = [
        "hotkeyEnabled": true,
    ]

    // Register the default values with the registration domain.
    UserDefaults(suiteName: "group.org.artginzburg.PiPOSS")!.register(defaults: defaultValuesToRegister)
}
