function show(enabled) {
    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);

// Custom from this line.

async function toggleHotkey(event) {
    console.log(event);
    event.preventDefault();
//    inputToggleHotkey.checked = !event.target.checked;
    return webkit.messageHandlers.controller.postMessage("toggle-hotkey");
}

const inputToggleHotkey = document.querySelector("input.toggle-hotkey");

inputToggleHotkey.addEventListener("click", toggleHotkey);

function updateHotkeyEnabled(enabled) {
    console.log("new state:", enabled);
    if (typeof enabled === "boolean") {
        inputToggleHotkey.checked = enabled;
    }
}
