browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Received request: ", request);
    
    sendResponse(browser)
//
//  if (request.greeting === "hello")
//      sendResponse({ farewell: "goodbye" });
});

//browser.runtime.sendNativeMessage("kek")


//
//
//function onResponse(response) {
//  console.log(`Received ${response}`);
//}
//
//function onError(error) {
//  console.log(`Error: ${error}`);
//}
//
///*
//On a click on the browser action, send the app a message.
//*/
//browser.browserAction.enable()
//browser.browserAction.onClicked.addListener(() => {
//  console.log("Sending:  ping");
//  let sending = browser.runtime.sendMessage("PiPOSS", "ping");
//  sending.then(onResponse, onError);
//});
////
////let sending = browser.runtime.sendMessage("PiPOSS", "ping");
////sending.then(onResponse, onError);
//
////browser.runtime.openOptionsPage()
//
//browser.runtime.connectNative("PiPOSS")


/*
See LICENSE folder for this sample’s licensing information.

Abstract:
Script that makes up the extension's background page.
*/
// Send a message to the native app extension from the background page.
browser.runtime.sendNativeMessage("application.id", {message: "Hello from background page"}, function(response) {
    console.log("Received sendNativeMessage response:");
    console.log(response);
});

// Set up a connection to receive messages from the native app.
let port = browser.runtime.connectNative("application.id");
port.postMessage("Hello from JavaScript Port");
port.onMessage.addListener(function(message) {
    console.log("Received native port message:");
    console.log(message);
});
port.onDisconnect.addListener(function(disconnectedPort) {
    console.log("Received native port disconnect:");
    console.log(disconnectedPort);
});
