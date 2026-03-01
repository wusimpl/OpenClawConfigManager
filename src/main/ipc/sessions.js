// 会话状态读取 IPC handlers
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const { getStateDirPath } = require('../utils');

function register() {
  // 列出所有 agent ID（从 agents 目录）
  ipcMain.handle('sessions:listAgents', async () => {
    try {
      const agentsDir = path.join(getStateDirPath(), 'agents');
      const entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
      const agents = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
      return { ok: true, agents };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 读取指定 agent 的 sessions.json
  ipcMain.handle('sessions:list', async (_ev, agentId) => {
    try {
      if (typeof agentId !== 'string' || !agentId.trim()) {
        return { ok: false, error: 'Agent ID 不能为空' };
      }
      const sessionsFile = path.join(
        getStateDirPath(), 'agents', agentId, 'sessions', 'sessions.json'
      );
      const raw = await fs.promises.readFile(sessionsFile, 'utf-8');
      const data = JSON.parse(raw);
      return { ok: true, data };
    } catch (e) {
      if (e.code === 'ENOENT') {
        return { ok: true, data: {} };
      }
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { register };
