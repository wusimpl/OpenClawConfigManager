// Workspace 文件操作 IPC handlers
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const { normalizeWorkspacePath, isPathInside } = require('../utils');

function register() {
  ipcMain.handle('workspace:listFiles', async (_ev, workspacePath) => {
    try {
      const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
      if (!normalizedWorkspacePath) {
        return { ok: false, error: '工作区路径不存在' };
      }
      try { await fs.promises.access(normalizedWorkspacePath); } catch {
        return { ok: false, error: '工作区路径不存在' };
      }
      const entries = await fs.promises.readdir(normalizedWorkspacePath, { withFileTypes: true });
      const files = entries
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(e => e.name)
        .sort();
      return { ok: true, files };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('workspace:readFile', async (_ev, workspacePath, fileName) => {
    try {
      const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
      if (!normalizedWorkspacePath) {
        return { ok: false, error: '工作区路径不存在' };
      }
      const filePath = path.join(normalizedWorkspacePath, fileName);
      if (!isPathInside(filePath, normalizedWorkspacePath)) {
        return { ok: false, error: '路径越界，拒绝访问' };
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('workspace:writeFile', async (_ev, workspacePath, fileName, content) => {
    try {
      const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
      if (!normalizedWorkspacePath) {
        return { ok: false, error: '工作区路径不存在' };
      }
      const filePath = path.join(normalizedWorkspacePath, fileName);
      if (!isPathInside(filePath, normalizedWorkspacePath)) {
        return { ok: false, error: '路径越界，拒绝访问' };
      }
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { register };
