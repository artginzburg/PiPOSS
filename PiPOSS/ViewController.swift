//
//  ViewController.swift
//  PiPOSS
//
//  Created by Arthur Ginzburg on 23.08.2022.
//

import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "org.artginzburg.PiPOSS.Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                webView.evaluateJavaScript("show(\(state.isEnabled))")
            }
        }

        let isHotkeyEnabled = UserDefaults(suiteName: "group.org.artginzburg.PiPOSS")!.bool(forKey: "hotkeyEnabled")

        DispatchQueue.main.async {
            webView.evaluateJavaScript("updateHotkeyEnabled(\(isHotkeyEnabled))")
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.body as! String {
            case "toggle-hotkey":
                toggleHotkey()
            case "open-preferences":
                openPreferences()
            default:
                break
        }
    }

    func toggleHotkey() {
        DispatchQueue.main.async {
            let currentValue = UserDefaults(suiteName: "group.org.artginzburg.PiPOSS")!.bool(forKey: "hotkeyEnabled");
            let newValue = !currentValue
            print("prev val: \(currentValue), new: \(newValue)")
            UserDefaults(suiteName: "group.org.artginzburg.PiPOSS")!.setValue(newValue, forKey: "hotkeyEnabled")

            self.webView.evaluateJavaScript("updateHotkeyEnabled(\(newValue))")
            
            SFSafariApplication.dispatchMessage(withName: "Hello from world", toExtensionWithIdentifier: extensionBundleIdentifier, userInfo: ["AdditionalInformation": "Goes Here"], completionHandler: {
                    (error) -> Void in
                        print("Dispatching message to the extension finished")
                }
            )
        }
    }

    func openPreferences() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            DispatchQueue.main.async {
                NSApplication.shared.terminate(nil)
            }
        }
    }

}
