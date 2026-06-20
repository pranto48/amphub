const remoteIdInput = document.getElementById('remote-id');
const connectScreenBtn = document.getElementById('btn-connect-screen');
const transferFilesBtn = document.getElementById('btn-transfer-files');
const screenSpinner = document.getElementById('screen-spinner');
const screenBtnText = document.getElementById('screen-btn-text');
const filesSpinner = document.getElementById('files-spinner');
const filesBtnText = document.getElementById('files-btn-text');

const serverUrlInput = document.getElementById('server-url');
const saveServerBtn = document.getElementById('save-connect');
const resetBtn = document.getElementById('reset');

const deskIdEl = document.getElementById('desk-id');
const copyBtn = document.getElementById('copy-id-btn');
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');
const headerStatusEl = document.getElementById('header-status');

const recentCard1 = document.getElementById('recent-card-1');
const recentCard2 = document.getElementById('recent-card-2');

const settingsToggle = document.getElementById('directory-settings-toggle');
const settingsContent = document.getElementById('directory-settings-content');
const settingsChevron = document.getElementById('settings-chevron');

// Toggle Directory Server Settings Section
settingsToggle.addEventListener('click', () => {
  const isHidden = settingsContent.style.display === 'none';
  settingsContent.style.display = isHidden ? 'flex' : 'none';
  settingsChevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
});

// Generate or retrieve a stable 9-digit Address for "This Desk"
function getOrCreateDeskId() {
  let savedId = localStorage.getItem('amphub_desk_id');
  if (!savedId) {
    const randomNum = Math.floor(100000000 + Math.random() * 900000000);
    const str = String(randomNum);
    savedId = `${str.slice(0, 3)} ${str.slice(3, 6)} ${str.slice(6, 9)}`;
    localStorage.setItem('amphub_desk_id', savedId);
  }
  return savedId;
}

// Display stable desk ID
const deskId = getOrCreateDeskId();
deskIdEl.textContent = deskId;

// Handle copying Desk ID to clipboard
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(deskId.replace(/\s+/g, ''));
    
    // Success feedback animation
    const originalIcon = copyBtn.innerHTML;
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" stroke="#10b981" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    copyBtn.style.color = '#10b981';
    
    setTimeout(() => {
      copyBtn.innerHTML = originalIcon;
      copyBtn.style.color = '';
    }, 1500);
  } catch (err) {
    console.error('Failed to copy text: ', err);
  }
});

// Set connection status messages
function setStatus(message, isError = false) {
  statusTextEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  
  if (isError) {
    headerStatusEl.textContent = 'Error';
    headerStatusEl.parentElement.style.color = '#f87171';
    headerStatusEl.parentElement.style.backgroundColor = 'rgba(248, 113, 113, 0.08)';
    headerStatusEl.parentElement.style.borderColor = 'rgba(248, 113, 113, 0.15)';
  } else {
    headerStatusEl.textContent = 'Ready';
    headerStatusEl.parentElement.style.color = '#10b981';
    headerStatusEl.parentElement.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
    headerStatusEl.parentElement.style.borderColor = 'rgba(16, 185, 129, 0.15)';
  }
}

// Load initial config if present
async function loadInitialConfig() {
  const config = await window.amphubClient.getConfig();
  if (config?.serverUrl) {
    serverUrlInput.value = config.serverUrl;
    setStatus(`Central Server: ${config.serverUrl}`);
  } else {
    setStatus('Ready for Directory Server setup.');
  }
}

// Save Directory Server Button action
saveServerBtn.addEventListener('click', async () => {
  const urlValue = serverUrlInput.value.trim();
  if (!urlValue) {
    setStatus('Please enter a server address.', true);
    return;
  }

  saveServerBtn.disabled = true;
  setStatus('Saving directory server address...');

  const response = await window.amphubClient.saveServerUrl(urlValue);
  if (!response.ok) {
    saveServerBtn.disabled = false;
    setStatus(response.message || 'Failed to save server URL.', true);
    return;
  }

  saveServerBtn.disabled = false;
  setStatus(`Saved Directory Server: ${urlValue}`);
});

// Reset action
resetBtn.addEventListener('click', async () => {
  await window.amphubClient.resetServerUrl();
  serverUrlInput.value = '';
  setStatus('Configuration reset. Ready for server setup.');
});

// Handle direct partner connection (Screen or Files)
async function connectToPartner(actionType) {
  const remoteVal = remoteIdInput.value.trim();
  if (!remoteVal) {
    setStatus('Please enter a Remote Connection ID or Local IP address.', true);
    return;
  }

  // Get active directory server URL
  const config = await window.amphubClient.getConfig();
  const serverUrl = config?.serverUrl || serverUrlInput.value.trim();
  if (!serverUrl) {
    setStatus('Please configure a Directory Server first under settings.', true);
    // Expand settings content if not configured
    settingsContent.style.display = 'flex';
    settingsChevron.style.transform = 'rotate(180deg)';
    return;
  }

  // Disable UI
  connectScreenBtn.disabled = true;
  transferFilesBtn.disabled = true;
  remoteIdInput.disabled = true;

  if (actionType === 'session') {
    screenSpinner.style.display = 'block';
    screenBtnText.textContent = 'Connecting Screen...';
  } else {
    filesSpinner.style.display = 'block';
    filesBtnText.textContent = 'Opening Files...';
  }
  
  setStatus(`Redirecting via Directory Server: ${serverUrl}...`);

  // Build connection deep link URL
  const connectUrl = `${serverUrl.replace(/\/$/, '')}/?connectTo=${encodeURIComponent(remoteVal)}&action=${actionType}`;

  // Call the main process to open this URL
  const response = await window.amphubClient.openUrl(connectUrl);
  
  if (!response.ok) {
    // Restore UI
    connectScreenBtn.disabled = false;
    transferFilesBtn.disabled = false;
    remoteIdInput.disabled = false;
    screenSpinner.style.display = 'none';
    filesSpinner.style.display = 'none';
    screenBtnText.textContent = 'Connect to Screen';
    filesBtnText.textContent = 'Transfer Files';
    setStatus(response.message || 'Failed to establish deep link connection.', true);
  }
}

connectScreenBtn.addEventListener('click', () => {
  connectToPartner('session');
});

transferFilesBtn.addEventListener('click', () => {
  connectToPartner('files');
});

// Recent connections click shortcuts
recentCard1.addEventListener('click', () => {
  serverUrlInput.value = 'http://192.168.20.5:6622';
  saveServerBtn.click();
  window.amphubClient.openConfiguredServer();
});

recentCard2.addEventListener('click', () => {
  serverUrlInput.value = 'http://localhost:5173';
  saveServerBtn.click();
  window.amphubClient.openConfiguredServer();
});

// Load config on start
void loadInitialConfig();
