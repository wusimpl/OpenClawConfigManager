// Agent 管理 IPC handlers
const path = require('path');
const fs = require('fs');
const { ipcMain, dialog } = require('electron');
const {
  AGENT_ID_REGEX,
  REQUIRED_WORKSPACE_IDENTITY_FILES,
  OPTIONAL_WORKSPACE_IDENTITY_FILES,
  normalizePathInput,
  pathExists,
  pathIsFile,
  copyPathIfExists,
  getStateDirPath,
} = require('../utils');
const { runOpenclaw } = require('../openclaw-runner');

function inferAgentIdFromWorkspacePath(workspacePath) {
  const baseName = path.basename(workspacePath);
  if (baseName === 'workspace') return 'main';
  const match = baseName.match(/^workspace-(.+)$/);
  return match?.[1] || baseName;
}

function getTargetWorkspaceForAgent(agentId) {
  return path.join(getStateDirPath(), `workspace-${agentId}`);
}

async function inspectWorkspaceDirectory(workspaceInput) {
  const normalizedPath = normalizePathInput(workspaceInput);
  const result = {
    inputPath: typeof workspaceInput === 'string' ? workspaceInput : '',
    path: normalizedPath,
    exists: false,
    isDirectory: false,
    isWorkspace: false,
    requiredFiles: [...REQUIRED_WORKSPACE_IDENTITY_FILES],
    optionalFiles: [...OPTIONAL_WORKSPACE_IDENTITY_FILES],
    presentRequired: [],
    missingRequired: [...REQUIRED_WORKSPACE_IDENTITY_FILES],
    presentOptional: [],
    missingOptional: [...OPTIONAL_WORKSPACE_IDENTITY_FILES],
  };

  if (!normalizedPath) return result;

  try {
    const stats = await fs.promises.stat(normalizedPath);
    result.exists = true;
    result.isDirectory = stats.isDirectory();
    if (!result.isDirectory) return result;

    const presentRequired = [];
    const missingRequired = [];
    for (const fileName of REQUIRED_WORKSPACE_IDENTITY_FILES) {
      const isFile = await pathIsFile(path.join(normalizedPath, fileName));
      if (isFile) presentRequired.push(fileName);
      else missingRequired.push(fileName);
    }

    const presentOptional = [];
    const missingOptional = [];
    for (const fileName of OPTIONAL_WORKSPACE_IDENTITY_FILES) {
      const isFile = await pathIsFile(path.join(normalizedPath, fileName));
      if (isFile) presentOptional.push(fileName);
      else missingOptional.push(fileName);
    }

    result.presentRequired = presentRequired;
    result.missingRequired = missingRequired;
    result.presentOptional = presentOptional;
    result.missingOptional = missingOptional;
    result.isWorkspace = missingRequired.length === 0;
    return result;
  } catch {
    return result;
  }
}

// 注册时需要传入 getMainWindow 函数获取主窗口引用（用于 dialog）
function register(getMainWindow) {
  ipcMain.handle('gateway:status', () => runOpenclaw(['gateway', 'status', '--json']));

  ipcMain.handle('agents:add', async (_ev, payload = {}) => {
    const agentId = typeof payload?.agentId === 'string' ? payload.agentId.trim() : '';
    const workspaceInput = typeof payload?.workspace === 'string' ? payload.workspace.trim() : '';

    if (!agentId) {
      return { ok: false, error: 'Agent ID 不能为空' };
    }
    if (!AGENT_ID_REGEX.test(agentId)) {
      return { ok: false, error: 'Agent ID 格式不合法' };
    }
    if (!workspaceInput) {
      return { ok: false, error: 'Workspace 不能为空' };
    }

    const args = ['agents', 'add', agentId, '--workspace', normalizePathInput(workspaceInput), '--non-interactive', '--json'];

    const result = await runOpenclaw(args);
    if (!result.ok) {
      return {
        ok: false,
        error: result.stderr || result.stdout || '执行 openclaw agents add 失败',
        detail: result,
      };
    }

    return { ok: true, result };
  });

  ipcMain.handle('agents:pickWorkspace', async () => {
    try {
      const mainWindow = getMainWindow();
      const response = await dialog.showOpenDialog(mainWindow, {
        title: '选择 Agent Workspace 文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (response.canceled || !response.filePaths?.length) {
        return { ok: true, canceled: true, path: '' };
      }
      return { ok: true, canceled: false, path: response.filePaths[0] };
    } catch (error) {
      return { ok: false, error: error?.message || '打开目录选择器失败' };
    }
  });

  ipcMain.handle('agents:validateWorkspace', async (_ev, payload = {}) => {
    try {
      const workspacePath = typeof payload?.workspacePath === 'string' ? payload.workspacePath : '';
      const inspection = await inspectWorkspaceDirectory(workspacePath);
      return { ok: true, data: inspection };
    } catch (error) {
      return { ok: false, error: error?.message || '校验 Workspace 失败' };
    }
  });

  ipcMain.handle('agents:import', async (_ev, payload = {}) => {
    const sourceWorkspaceInput = typeof payload?.sourceWorkspace === 'string' ? payload.sourceWorkspace.trim() : '';
    const targetAgentId = typeof payload?.targetAgentId === 'string' ? payload.targetAgentId.trim() : '';
    const sourceAgentIdInput = typeof payload?.sourceAgentId === 'string' ? payload.sourceAgentId.trim() : '';
    const sourceStateDirInput = typeof payload?.sourceStateDir === 'string' ? payload.sourceStateDir.trim() : '';
    const includeMemory = payload?.includeMemory !== false;
    const includeSessions = !!payload?.includeSessions;

    if (!sourceWorkspaceInput) {
      return { ok: false, error: '源 Workspace 路径不能为空' };
    }
    if (!targetAgentId) {
      return { ok: false, error: '目标 Agent ID 不能为空' };
    }
    if (!AGENT_ID_REGEX.test(targetAgentId)) {
      return { ok: false, error: '目标 Agent ID 格式不合法' };
    }

    const workspaceInspection = await inspectWorkspaceDirectory(sourceWorkspaceInput);
    const sourceWorkspacePath = workspaceInspection.path;
    if (!workspaceInspection.exists) {
      return { ok: false, error: `源 Workspace 不存在: ${sourceWorkspacePath}` };
    }
    if (!workspaceInspection.isDirectory) {
      return { ok: false, error: `源 Workspace 不是目录: ${sourceWorkspacePath}` };
    }
    if (!workspaceInspection.isWorkspace) {
      return { ok: false, error: `源 Workspace 缺少必需身份文件: ${workspaceInspection.missingRequired.join(', ')}` };
    }

    const targetWorkspacePath = getTargetWorkspaceForAgent(targetAgentId);
    if (sourceWorkspacePath === targetWorkspacePath) {
      return { ok: false, error: '源路径与目标路径不能相同' };
    }

    if (await pathExists(targetWorkspacePath)) {
      const existingEntries = await fs.promises.readdir(targetWorkspacePath);
      if (existingEntries.length > 0) {
        return { ok: false, error: `目标 Workspace 已存在且非空: ${targetWorkspacePath}` };
      }
    }

    let sourceSessionsPath = '';
    if (includeSessions) {
      const sourceAgentId = sourceAgentIdInput || inferAgentIdFromWorkspacePath(sourceWorkspacePath);
      const sourceStateDirPath = sourceStateDirInput
        ? normalizePathInput(sourceStateDirInput)
        : path.dirname(sourceWorkspacePath);
      sourceSessionsPath = path.join(sourceStateDirPath, 'agents', sourceAgentId, 'sessions');
      if (!(await pathExists(sourceSessionsPath))) {
        return { ok: false, error: `未找到源会话目录: ${sourceSessionsPath}` };
      }
    }

    const addArgs = ['agents', 'add', targetAgentId, '--workspace', targetWorkspacePath, '--non-interactive', '--json'];
    const addResult = await runOpenclaw(addArgs);
    if (!addResult.ok) {
      return {
        ok: false,
        error: addResult.stderr || addResult.stdout || '执行 openclaw agents add 失败',
        detail: addResult,
      };
    }

    const baseFiles = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md', 'HEARTBEAT.md', 'BOOT.md', 'BOOTSTRAP.md'];
    const baseDirs = ['scripts', 'skills'];
    const copied = {
      files: [],
      dirs: [],
      memory: false,
      sessions: false,
    };

    try {
      for (const fileName of baseFiles) {
        const copiedOne = await copyPathIfExists(
          path.join(sourceWorkspacePath, fileName),
          path.join(targetWorkspacePath, fileName),
        );
        if (copiedOne) copied.files.push(fileName);
      }

      for (const dirName of baseDirs) {
        const copiedOne = await copyPathIfExists(
          path.join(sourceWorkspacePath, dirName),
          path.join(targetWorkspacePath, dirName),
        );
        if (copiedOne) copied.dirs.push(dirName);
      }

      if (includeMemory) {
        const memoryFileCopied = await copyPathIfExists(
          path.join(sourceWorkspacePath, 'MEMORY.md'),
          path.join(targetWorkspacePath, 'MEMORY.md'),
        );
        const memoryDirCopied = await copyPathIfExists(
          path.join(sourceWorkspacePath, 'memory'),
          path.join(targetWorkspacePath, 'memory'),
        );
        copied.memory = memoryFileCopied || memoryDirCopied;
      }

      if (includeSessions && sourceSessionsPath) {
        const targetSessionsPath = path.join(getStateDirPath(), 'agents', targetAgentId, 'sessions');
        await fs.promises.rm(targetSessionsPath, { recursive: true, force: true });
        await fs.promises.mkdir(path.dirname(targetSessionsPath), { recursive: true });
        await fs.promises.cp(sourceSessionsPath, targetSessionsPath, {
          recursive: true,
          force: true,
          errorOnExist: false,
        });
        copied.sessions = true;
      }

      return {
        ok: true,
        data: {
          targetAgentId,
          targetWorkspace: targetWorkspacePath,
          sourceWorkspace: sourceWorkspacePath,
          includeMemory,
          includeSessions,
          sourceSessionsPath: sourceSessionsPath || null,
          copied,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || '导入失败',
        partial: true,
        data: {
          targetAgentId,
          targetWorkspace: targetWorkspacePath,
        },
      };
    }
  });

  ipcMain.handle('gateway:start', () => {
    const { runOpenclawDetached } = require('../openclaw-runner');
    return runOpenclawDetached(['gateway', 'start']);
  });

  ipcMain.handle('gateway:stop', () => {
    const { runOpenclawDetached } = require('../openclaw-runner');
    return runOpenclawDetached(['gateway', 'stop']);
  });

  ipcMain.handle('gateway:restart', () => {
    const { runOpenclawDetached } = require('../openclaw-runner');
    return runOpenclawDetached(['gateway', 'restart']);
  });

  ipcMain.handle('gateway:health', () => runOpenclaw(['gateway', 'health', '--json']));
}

module.exports = { register };
