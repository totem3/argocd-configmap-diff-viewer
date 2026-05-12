chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:\/\//.test(tab.url)) return;

  try {
    await Promise.all([
      chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles.css'],
      }),
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      }),
    ]);
  } catch (error) {
    console.error('Failed to inject ConfigMap Diff Viewer:', error);
  }
});
