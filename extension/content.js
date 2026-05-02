let sidebar = null;
let currentVideoId = null;
let isProcessing = false;

function initSidebar() {
  if (document.getElementById('yt-summarizer-sidebar')) {
    sidebar = document.getElementById('yt-summarizer-sidebar');
    return;
  }

  const sidebarHtml = `
    <div id="yt-summarizer-sidebar">
      <div id="yt-summarizer-header">
        <h2>AI Summarizer</h2>
        <button id="yt-summarizer-close">&times;</button>
      </div>
      <div id="yt-summarizer-content">
        <div id="yt-summarizer-loading">
          <div class="spinner"></div>
          <div>Summarizing video...</div>
        </div>
        <div id="yt-summarizer-error"></div>
        <div id="yt-summarizer-results">
          <div class="summary-section" id="yt-speaker-section" style="display: none;">
            <h3>🎤 Speaker / Host</h3>
            <p id="yt-speaker"></p>
          </div>
          <div class="summary-section" id="yt-guest-section" style="display: none;">
            <h3>🎙️ Guest(s)</h3>
            <p id="yt-guest"></p>
          </div>
          <div class="summary-section">
            <h3>📌 Quick Summary</h3>
            <p id="yt-tldr"></p>
          </div>
          <div class="summary-section">
            <h3>Detailed Summary</h3>
            <p id="yt-detailed"></p>
          </div>
          <div class="summary-section">
            <h3>Key Points</h3>
            <ul id="yt-keypoints"></ul>
          </div>
          <div class="summary-section">
            <h3>Insights</h3>
            <ul id="yt-insights"></ul>
          </div>
          <div class="summary-section">
            <h3>Suggestions</h3>
            <ul id="yt-suggestions"></ul>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', sidebarHtml);
  sidebar = document.getElementById('yt-summarizer-sidebar');

  document.getElementById('yt-summarizer-close').addEventListener('click', () => {
    sidebar.classList.remove('open');
  });
}

function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

function getMetaData() {
  // Try to get title
  const titleEl = document.querySelector('h1.ytd-watch-metadata');
  const title = titleEl ? titleEl.textContent.trim() : 'Unknown Title';
  
  // Try to get channel
  const channelEl = document.querySelector('ytd-channel-name yt-formatted-string a');
  const channel = channelEl ? channelEl.textContent.trim() : 'Unknown Channel';

  return { title, channel };
}

async function summarizeVideo() {
  if (isProcessing) return;
  
  const videoId = getVideoId();
  if (!videoId) {
    showError("Could not detect a YouTube video ID. Are you on a video page?");
    return;
  }

  // If we already have the results for this video, don't re-fetch
  if (currentVideoId === videoId && document.getElementById('yt-summarizer-results').style.display === 'block') {
    return;
  }

  currentVideoId = videoId;
  const { title, channel } = getMetaData();

  // Reset UI
  document.getElementById('yt-summarizer-error').style.display = 'none';
  document.getElementById('yt-summarizer-results').style.display = 'none';
  document.getElementById('yt-summarizer-loading').style.display = 'flex';
  isProcessing = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'FETCH_SUMMARY',
      payload: { videoId, title, channel }
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    renderResults(response.data);
  } catch (error) {
    showError(error.message);
  } finally {
    isProcessing = false;
    document.getElementById('yt-summarizer-loading').style.display = 'none';
  }
}

function isValidPersonInfo(text) {
  if (!text) return false;
  if (typeof text === 'object') return false;
  const trimmed = String(text).trim().toLowerCase();
  return trimmed !== '' && trimmed !== 'null' && trimmed !== 'none' && trimmed !== 'n/a' && trimmed !== 'unknown';
}

function extractPersonText(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    return Object.values(value).filter(v => typeof v === 'string').join(' — ');
  }
  return String(value);
}

function renderResults(data) {
  // Speaker section
  const speakerSection = document.getElementById('yt-speaker-section');
  const speakerText = extractPersonText(data.speaker_info);
  if (isValidPersonInfo(speakerText)) {
    document.getElementById('yt-speaker').textContent = speakerText;
    speakerSection.style.display = 'block';
  } else {
    speakerSection.style.display = 'none';
  }

  // Guest section
  const guestSection = document.getElementById('yt-guest-section');
  const guestText = extractPersonText(data.guest_info);
  if (isValidPersonInfo(guestText)) {
    document.getElementById('yt-guest').textContent = guestText;
    guestSection.style.display = 'block';
  } else {
    guestSection.style.display = 'none';
  }

  document.getElementById('yt-tldr').textContent = data.tldr || '';
  document.getElementById('yt-detailed').textContent = data.detailed_summary || '';
  
  const renderList = (id, items) => {
    const ul = document.getElementById(id);
    ul.innerHTML = '';
    if (items && items.length) {
      items.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      });
    } else {
      ul.innerHTML = '<li>None</li>';
    }
  };

  renderList('yt-keypoints', data.key_points);
  renderList('yt-insights', data.insights);
  renderList('yt-suggestions', data.suggestions);

  document.getElementById('yt-summarizer-results').style.display = 'block';
}

function showError(message) {
  const errorEl = document.getElementById('yt-summarizer-error');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  document.getElementById('yt-summarizer-results').style.display = 'none';
}

function toggleSidebar() {
  initSidebar();
  
  if (sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
  } else {
    sidebar.classList.add('open');
    // Start summarizing if we're opening and on a video page
    if (window.location.pathname === '/watch') {
      summarizeVideo();
    }
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TOGGLE_SIDEBAR') {
    toggleSidebar();
  }
});

// Handle YouTube SPA Navigation
document.addEventListener('yt-navigate-finish', () => {
  // If the sidebar is open and we navigated to a new video, update it
  if (sidebar && sidebar.classList.contains('open') && window.location.pathname === '/watch') {
    const newVideoId = getVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
      summarizeVideo();
    }
  }
});
