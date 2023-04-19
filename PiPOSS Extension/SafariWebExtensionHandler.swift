//
//  SafariWebExtensionHandler.swift
//  PiPOSS Extension
//
//  Created by Arthur Ginzburg on 23.08.2022.
//

import SafariServices
import os.log

let SFExtensionMessageKey = "message"

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    override init() {
        super.init()

        registerDefaultPreferenceValues()
    }

	func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems[0] as! NSExtensionItem
        let message = item.userInfo?[SFExtensionMessageKey]
        os_log(.default, "Received message from browser.runtime.sendNativeMessage: %@", message as! CVarArg)

        let response = NSExtensionItem()
        response.userInfo = [ SFExtensionMessageKey: [ "Response to": message, "def": UserDefaults(suiteName: "group.org.artginzburg.PiPOSS")!.bool(forKey: "hotkeyEnabled") ] ]

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    /// A full copy of the function in AppDelegate. TODO dedupe
    func registerDefaultPreferenceValues() {
        let defaultValuesToRegister = [
            "hotkeyEnabled": true,
        ]

        // Register the default values with the registration domain.
        UserDefaults(suiteName: "group.org.artginzburg.PiPOSS")!.register(defaults: defaultValuesToRegister)
    }
}
