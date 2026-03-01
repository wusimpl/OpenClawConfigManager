// 配置读写 IPC handlers
const fs = require('fs');
const { ipcMain } = require('electron');
const { CONFIG_PATH, CONFIG_DIR } = require('../utils');
const { collectMaskedSecretPaths } = require('../config-guard');

function register() {
  ipcMain.handle('config:read', async () => {
    try {
      const raw = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
      return { ok: true, data: JSON.parse(raw), path: CONFIG_PATH };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('config:write', async (_ev, json) => {
    try {
      const suspiciousPaths = collectMaskedSecretPaths(json);
      if (suspiciousPaths.length > 0) {
        return {
          ok: false,
          error: `检测到疑似占位密钥，已阻止写入：${suspiciousPaths.join(', ')}`,
        };
      }
      await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
      const tmpPath = CONFIG_PATH + '.tmp';
      const content = JSON.stringify(json, null, 2);
      await fs.promises.writeFile(tmpPath, content, 'utf-8');
      await fs.promises.rename(tmpPath, CONFIG_PATH);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { register };
