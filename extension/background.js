chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle_sidebar') {
    try {
      // Get the active tab in the current window
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Ensure we are on a YouTube watch page
      if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
        // Send a message to the content script in that tab
        chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_SIDEBAR' }).catch(err => {
          console.error("Content script not ready or error sending message:", err);
          // If the content script isn't loaded (e.g. extension was just installed), we could inject it here.
          // But Manifest V3 handles content script injection on matches reliably.
        });
      }
    } catch (error) {
      console.error('Error toggling sidebar:', error);
    }
  }
});

// Listen for fetch requests from content script to avoid Mixed Content errors
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_SUMMARY') {
    fetch('http://localhost:3000/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request.payload)
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => { throw new Error(err.error || 'Failed to summarize video') });
      }
      return response.json();
    })
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // Keep the message channel open for async response
  }
});
