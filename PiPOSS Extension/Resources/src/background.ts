browser.commands.onCommand.addListener((command) => {
  if (command === 'toggle-pip') {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { action: 'toggle-pip' });
      }
    });
  }
});
