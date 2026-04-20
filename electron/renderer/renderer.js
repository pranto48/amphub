const input = document.getElementById('server-url');
const statusEl = document.getElementById('status');
const saveConnectBtn = document.getElementById('save-connect');
const resetBtn = document.getElementById('reset');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function loadInitialConfig() {
  const config = await window.amphubClient.getConfig();
  if (config?.serverUrl) {
    input.value = config.serverUrl;
    setStatus(`Saved server: ${config.serverUrl}`);
  }
}

saveConnectBtn.addEventListener('click', async () => {
  saveConnectBtn.disabled = true;
  setStatus('Saving server address...');

  const response = await window.amphubClient.saveServerUrl(input.value);
  if (!response.ok) {
    saveConnectBtn.disabled = false;
    setStatus(response.message || 'Failed to save server URL.', true);
    return;
  }

  setStatus('Saved. Connecting...');
  await window.amphubClient.openConfiguredServer();
  saveConnectBtn.disabled = false;
});

resetBtn.addEventListener('click', async () => {
  await window.amphubClient.resetServerUrl();
  input.value = '';
  setStatus('Saved server has been reset.');
});

void loadInitialConfig();
