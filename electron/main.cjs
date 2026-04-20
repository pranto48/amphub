const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const { readConfig, writeConfig } = require('./config-store.cjs');

let mainWindow;

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { ok: false, reason: 'Server address is required.' };
  }

  let parsed;
  try {
    parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'Use a valid URL (for example: https://amphub.company.com).' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'Only HTTP/HTTPS server addresses are supported.' };
  }

  return { ok: true, value: parsed.toString().replace(/\/$/, '') };
}

function getCurrentConfig() {
  return readConfig(app.getPath('userData'));
}

function saveConfig(config) {
  writeConfig(app.getPath('userData'), config);
}

async function loadConfiguredServerOrSetup() {
  const { serverUrl } = getCurrentConfig();
  const normalized = normalizeServerUrl(serverUrl);

  if (normalized.ok) {
    await mainWindow.loadURL(normalized.value);
    return;
  }

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createMenu() {
  const template = [
    {
      label: 'Amphub',
      submenu: [
        {
          label: 'Change Server Address',
          click: async () => {
            if (!mainWindow) return;
            await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
          },
        },
        {
          label: 'Reset Saved Server',
          click: () => {
            saveConfig({ serverUrl: '' });
            if (mainWindow) {
              void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggledevtools' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'amphub',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void loadConfiguredServerOrSetup();
}

ipcMain.handle('client:get-config', () => getCurrentConfig());

ipcMain.handle('client:save-server-url', async (_event, incomingUrl) => {
  const normalized = normalizeServerUrl(incomingUrl);
  if (!normalized.ok) {
    return { ok: false, message: normalized.reason };
  }

  saveConfig({ serverUrl: normalized.value });
  return { ok: true, serverUrl: normalized.value };
});

ipcMain.handle('client:reset-server-url', async () => {
  saveConfig({ serverUrl: '' });
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
  return { ok: true };
});

ipcMain.handle('client:open-configured-server', async () => {
  const config = getCurrentConfig();
  const normalized = normalizeServerUrl(config.serverUrl);

  if (!normalized.ok) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Server address required',
      message: normalized.reason,
    });
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    }
    return { ok: false, message: normalized.reason };
  }

  if (mainWindow) {
    await mainWindow.loadURL(normalized.value);
  }

  return { ok: true };
});

app.whenReady().then(() => {
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
