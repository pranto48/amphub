const fs = require('node:fs');
const path = require('node:path');

function getConfigPath(userDataPath) {
  return path.join(userDataPath, 'client-config.json');
}

function readConfig(userDataPath) {
  const configPath = getConfigPath(userDataPath);
  if (!fs.existsSync(configPath)) {
    return { serverUrl: '' };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (typeof parsed.serverUrl !== 'string') {
      return { serverUrl: '' };
    }
    return { serverUrl: parsed.serverUrl };
  } catch {
    return { serverUrl: '' };
  }
}

function writeConfig(userDataPath, nextConfig) {
  const configPath = getConfigPath(userDataPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), 'utf8');
}

module.exports = { readConfig, writeConfig };
