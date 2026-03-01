// 记忆文件列表 IPC handlers
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const { getStateDirPath } = require('../utils');

/**
 * 获取 agent 对应的 workspace 路径
 * 约定：~/.openclaw/workspace-<agentId>
 */
function getAgentWorkspacePath(agentId) {
  const stateDir = getStateDirPath();
  return path.join(stateDir, `workspace-${agentId}`);
}

/**
 * 收集 workspace 中的记忆文件：MEMORY.md + memory/*.md
 */
async function collectMemoryFiles(workspacePath) {
  const files = [];

  // 检查 MEMORY.md
  const memoryMdPath = path.join(workspacePath, 'MEMORY.md');
  try {
    const stat = await fs.promises.stat(memoryMdPath);
    if (stat.isFile()) {
      files.push({
        name: 'MEMORY.md',
        path: memoryMdPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
  } catch { /* 文件不存在，忽略 */ }

  // 扫描 memory/ 目录
  const memoryDir = path.join(workspacePath, 'memory');
  try {
    const entries = await fs.promises.readdir(memoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(memoryDir, entry.name);
      const stat = await fs.promises.stat(filePath);
      files.push({
        name: `memory/${entry.name}`,
        path: filePath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
  } catch { /* 目录不存在，忽略 */ }

  // 按修改时间倒序排列
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return files;
}

function register() {
  // 列出指定 agent workspace 的记忆文件
  ipcMain.handle('memory:listFiles', async (_ev, agentId) => {
    try {
      if (typeof agentId !== 'string' || !agentId.trim()) {
        return { ok: false, error: 'Agent ID 不能为空' };
      }
      const workspacePath = getAgentWorkspacePath(agentId);
      try {
        await fs.promises.access(workspacePath);
      } catch {
        return { ok: true, files: [] };
      }
      const files = await collectMemoryFiles(workspacePath);
      return { ok: true, files };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { register };
