const { app, BrowserWindow, ipcMain, session, Tray, Menu, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn, spawnSync } = require('child_process');

const CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'openclaw.json');
const CONFIG_DIR = path.dirname(CONFIG_PATH);
const CONFIG_FILE_NAME = path.basename(CONFIG_PATH);

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function splitPathEntries(pathValue) {
  return (pathValue || '').split(path.delimiter).map((value) => value.trim()).filter(Boolean);
}

function getLoginShellValue(command) {
  const shell = process.env.SHELL || '/bin/zsh';
  const res = spawnSync(shell, ['-ilc', command], { timeout: 10000, encoding: 'utf-8' });
  if (res.error || res.status !== 0) return null;
  return res.stdout?.trim() || null;
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getNvmBinDirs(homePath) {
  if (!homePath) return [];
  const nvmNodeDir = path.join(homePath, '.nvm', 'versions', 'node');
  try {
    return fs.readdirSync(nvmNodeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(nvmNodeDir, entry.name, 'bin'));
  } catch {
    return [];
  }
}

function shellQuoteArg(value) {
  const text = String(value ?? '');
  if (!text) return "''";
  if (/^[A-Za-z0-9_/:=+.-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function toCommandString(executable, args) {
  return [executable, ...args].map(shellQuoteArg).join(' ');
}

const LOG_SOURCE_GATEWAY_FILE = 'gateway-file';
const LOG_SOURCE_SERVICE_STDOUT = 'service-stdout';
const LOG_SOURCE_SERVICE_STDERR = 'service-stderr';
const DEFAULT_LOG_INITIAL_BYTES = 240 * 1024;
const DEFAULT_LOG_APPEND_BYTES = 180 * 1024;
const MAX_LOG_READ_BYTES = 2 * 1024 * 1024;

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.floor(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function resolveHomePath(inputPath) {
  if (typeof inputPath !== 'string') return '';
  const trimmed = inputPath.trim();
  if (!trimmed) return '';
  const userHome = process.env.HOME || process.env.USERPROFILE || '';
  if (!userHome) return trimmed;
  if (trimmed === '~') return userHome;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(userHome, trimmed.slice(2));
  }
  return trimmed;
}

function formatDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractLoggingFileFromRaw(raw) {
  if (typeof raw !== 'string') return null;
  const loggingStart = raw.search(/["']?logging["']?\s*:/);
  if (loggingStart < 0) return null;
  const segment = raw.slice(loggingStart, loggingStart + 8000);
  const match = segment.match(/["']?file["']?\s*:\s*["']([^"']+)["']/);
  if (!match || !match[1]) return null;
  return match[1].trim();
}

function getStateDirPath() {
  const envState = resolveHomePath(process.env.OPENCLAW_STATE_DIR || '');
  if (envState) return path.resolve(envState);
  return CONFIG_DIR;
}

async function findLatestGatewayDailyLogFile() {
  const logDir = path.join('/tmp', 'openclaw');
  try {
    const entries = await fs.promises.readdir(logDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /^openclaw-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (files.length === 0) return null;
    return path.join(logDir, files[files.length - 1]);
  } catch {
    return null;
  }
}

async function resolveGatewayFileLogPath() {
  let configuredPath = null;
  try {
    const raw = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.logging?.file === 'string' && parsed.logging.file.trim()) {
        configuredPath = parsed.logging.file.trim();
      }
    } catch {
      const extracted = extractLoggingFileFromRaw(raw);
      if (extracted) configuredPath = extracted;
    }
  } catch {
    // ignore config read failures, fallback to default log path
  }

  if (configuredPath) {
    return path.resolve(resolveHomePath(configuredPath));
  }

  const todayPath = path.join('/tmp', 'openclaw', `openclaw-${formatDateStamp()}.log`);
  try {
    await fs.promises.access(todayPath);
    return todayPath;
  } catch {
    const latestPath = await findLatestGatewayDailyLogFile();
    return latestPath || todayPath;
  }
}

async function resolveLogSourcePath(source) {
  if (source === LOG_SOURCE_SERVICE_STDOUT) {
    return path.join(getStateDirPath(), 'logs', 'gateway.log');
  }
  if (source === LOG_SOURCE_SERVICE_STDERR) {
    return path.join(getStateDirPath(), 'logs', 'gateway.err.log');
  }
  return resolveGatewayFileLogPath();
}

async function readUtf8Slice(filePath, start, length) {
  if (length <= 0) return '';
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.slice(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

const openclawNames = process.platform === 'win32'
  ? ['openclaw.cmd', 'openclaw.exe', 'openclaw.bat', 'openclaw']
  : ['openclaw'];

const resolveNotes = [];
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
let loginShellPath = null;
let loginOpenclawPath = null;

if (process.platform === 'darwin') {
  loginShellPath = getLoginShellValue('echo $PATH');
  if (!loginShellPath) resolveNotes.push('无法从 login shell 读取 PATH');
  loginOpenclawPath = getLoginShellValue('command -v openclaw');
  if (!loginOpenclawPath) resolveNotes.push('login shell 未返回 openclaw 路径');
}

let pathEntries = uniqueStrings([
  ...splitPathEntries(process.env.PATH || ''),
  ...splitPathEntries(loginShellPath || ''),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(homeDir, '.local', 'bin'),
  path.join(homeDir, '.volta', 'bin'),
  path.join(homeDir, '.asdf', 'shims'),
  ...getNvmBinDirs(homeDir),
]);

function resolveOpenclawPath() {
  const candidatePaths = [];
  if (loginOpenclawPath && path.isAbsolute(loginOpenclawPath)) {
    candidatePaths.push(loginOpenclawPath);
  }
  for (const dirPath of pathEntries) {
    for (const name of openclawNames) {
      candidatePaths.push(path.join(dirPath, name));
    }
  }
  for (const candidate of uniqueStrings(candidatePaths)) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

const openclawPath = resolveOpenclawPath();
if (openclawPath) {
  pathEntries = uniqueStrings([path.dirname(openclawPath), ...pathEntries]);
} else {
  resolveNotes.push('未解析到 openclaw 绝对路径，将回退 PATH 查找');
}

const userPath = pathEntries.join(path.delimiter);
const PREFS_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'ui-prefs.json');

let mainWindow;
let tray = null;
let configWatchDebounce = null;
let configDirWatcher = null;

function isConfigRelatedFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim()) return true;
  const base = path.basename(filename);
  return base === CONFIG_FILE_NAME || base === `${CONFIG_FILE_NAME}.tmp`;
}

function emitConfigChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config:changed');
  }
}

function scheduleConfigChangedEmit() {
  clearTimeout(configWatchDebounce);
  configWatchDebounce = setTimeout(emitConfigChanged, 400);
}

function startConfigWatchers() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  } catch (err) {
    console.warn('[config-watch] 配置目录创建失败:', err.message);
  }

  try {
    configDirWatcher = fs.watch(CONFIG_DIR, (_eventType, filename) => {
      if (isConfigRelatedFilename(filename)) {
        scheduleConfigChangedEmit();
      }
    });
    configDirWatcher.on('error', (err) => {
      console.warn('[config-watch] 目录监听异常:', err.message);
    });
  } catch (err) {
    console.warn('[config-watch] 目录监听创建失败:', err.message);
  }

  fs.watchFile(CONFIG_PATH, { interval: 600 }, (curr, prev) => {
    const changed = curr.mtimeMs !== prev.mtimeMs
      || curr.size !== prev.size
      || curr.ino !== prev.ino
      || curr.nlink !== prev.nlink;
    if (changed) {
      scheduleConfigChangedEmit();
    }
  });
}

function stopConfigWatchers() {
  clearTimeout(configWatchDebounce);
  configWatchDebounce = null;

  if (configDirWatcher) {
    configDirWatcher.close();
    configDirWatcher = null;
  }

  fs.unwatchFile(CONFIG_PATH);
}

function getCloseBehavior() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8')).closeBehavior || null;
  } catch { return null; }
}

function saveCloseBehavior(behavior) {
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8')); } catch {}
  prefs.closeBehavior = behavior;
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf-8');
}

function createTrayIcon() {
  const zlib = require('zlib');
  const size = 16;
  // 构建 16x16 RGBA 像素数据（蓝色圆形）
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const dx = x - 7.5, dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 7) {
        raw[i] = 0x21; raw[i + 1] = 0x96; raw[i + 2] = 0xF3; raw[i + 3] = 0xFF;
      } else if (dist < 8) {
        const a = Math.max(0, Math.min(255, Math.round((8 - dist) * 255)));
        raw[i] = 0x21; raw[i + 1] = 0x96; raw[i + 2] = 0xF3; raw[i + 3] = a;
      }
    }
  }
  const deflated = zlib.deflateSync(raw);
  // CRC32
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflated),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('OpenClaw 管理器');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    title: 'OpenClaw 管理器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      const saved = getCloseBehavior();
      if (saved === 'minimize') {
        mainWindow.hide();
        return;
      }
      if (saved === 'quit') {
        app.isQuitting = true;
        app.quit();
        return;
      }
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['最小化到托盘', '退出程序'],
        defaultId: 0,
        cancelId: 0,
        title: '关闭窗口',
        message: '你想要最小化到系统托盘还是退出程序？',
        checkboxLabel: '不再提示，记住我的选择',
        checkboxChecked: false,
      }).then(({ response, checkboxChecked }) => {
        const behavior = response === 1 ? 'quit' : 'minimize';
        if (checkboxChecked) {
          saveCloseBehavior(behavior);
        }
        if (behavior === 'quit') {
          app.isQuitting = true;
          app.quit();
        } else {
          mainWindow.hide();
        }
      });
    }
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"],
      },
    });
  });
  createWindow();
  createTray();
  startConfigWatchers();
});
app.on('window-all-closed', () => {
  // 不退出，保持托盘运行
});
app.on('before-quit', () => {
  app.isQuitting = true;
  stopConfigWatchers();
});

// ── Config read/write ──

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

// ── Gateway management ──

function runOpenclaw(args) {
  return new Promise((resolve) => {
    const executable = openclawPath || 'openclaw';
    const command = toCommandString(executable, args);
    const startedAt = Date.now();

    execFile('bash', ['-c', `unset npm_config_prefix; export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.volta/bin:$HOME/.asdf/shims:$PATH"; ${command}`], {
      timeout: 30000,
    }, (err, stdout, stderr) => {
      const durationMs = Date.now() - startedAt;
      const stdoutText = stdout?.trim();
      let stderrText = stderr?.trim();
      if (err && err.code === 'ENOENT' && !stderrText) {
        const notesText = resolveNotes.length ? `（${resolveNotes.join('；')}）` : '';
        stderrText = `openclaw 命令不可用${notesText}`;
      }
      resolve({
        ok: !err,
        stdout: stdoutText,
        stderr: stderrText,
        code: err ? err.code : 0,
        command,
        timestamp: new Date(startedAt).toISOString(),
        durationMs,
      });
    });
  });
}

function runOpenclawDetached(args) {
  return new Promise((resolve) => {
    const executable = openclawPath || 'openclaw';
    const command = toCommandString(executable, args);
    const startedAt = Date.now();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        command,
        timestamp: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
      });
    };

    const unavailableMessage = () => {
      const notesText = resolveNotes.length ? `（${resolveNotes.join('；')}）` : '';
      return `openclaw 命令不可用${notesText}`;
    };

    try {
      const child = spawn('bash', ['-c', `unset npm_config_prefix; export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.volta/bin:$HOME/.asdf/shims:$PATH"; ${command}`], {
        stdio: 'ignore',
      });

      child.once('error', (err) => {
        const stderrText = err?.code === 'ENOENT' ? unavailableMessage() : (err?.message || '命令触发失败');
        finish({
          ok: false,
          dispatched: false,
          stdout: '',
          stderr: stderrText,
          code: err?.code || 1,
          pid: null,
        });
      });

      child.once('spawn', () => {
        child.unref();
        finish({
          ok: true,
          dispatched: true,
          stdout: '',
          stderr: '',
          code: 0,
          pid: child.pid,
        });
      });
    } catch (err) {
      const stderrText = err?.code === 'ENOENT' ? unavailableMessage() : (err?.message || '命令触发失败');
      finish({
        ok: false,
        dispatched: false,
        stdout: '',
        stderr: stderrText,
        code: err?.code || 1,
        pid: null,
      });
    }
  });
}

const AGENT_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REQUIRED_WORKSPACE_IDENTITY_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md'];
const OPTIONAL_WORKSPACE_IDENTITY_FILES = ['USER.md', 'TOOLS.md', 'HEARTBEAT.md'];

function normalizePathInput(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return '';
  return path.resolve(resolveHomePath(value));
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathIsFile(targetPath) {
  try {
    const stats = await fs.promises.stat(targetPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function inferAgentIdFromWorkspacePath(workspacePath) {
  const baseName = path.basename(workspacePath);
  if (baseName === 'workspace') return 'main';
  const match = baseName.match(/^workspace-(.+)$/);
  return match?.[1] || baseName;
}

function getTargetWorkspaceForAgent(agentId) {
  return path.join(getStateDirPath(), `workspace-${agentId}`);
}

async function copyPathIfExists(sourcePath, targetPath) {
  if (!(await pathExists(sourcePath))) return false;
  const stats = await fs.promises.stat(sourcePath);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  if (stats.isDirectory()) {
    await fs.promises.cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  } else {
    await fs.promises.copyFile(sourcePath, targetPath);
  }
  return true;
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

ipcMain.handle('gateway:start', () => runOpenclawDetached(['gateway', 'start']));

ipcMain.handle('gateway:stop', () => runOpenclawDetached(['gateway', 'stop']));

ipcMain.handle('gateway:restart', () => runOpenclawDetached(['gateway', 'restart']));

ipcMain.handle('gateway:health', () => runOpenclaw(['gateway', 'health', '--json']));

// ── OpenClaw log files ──

ipcMain.handle('logs:read', async (_ev, options = {}) => {
  try {
    const source = typeof options.source === 'string' ? options.source : LOG_SOURCE_GATEWAY_FILE;
    const initialBytes = clampNumber(options.initialBytes, 32 * 1024, MAX_LOG_READ_BYTES, DEFAULT_LOG_INITIAL_BYTES);
    const appendBytes = clampNumber(options.appendBytes, 8 * 1024, MAX_LOG_READ_BYTES, DEFAULT_LOG_APPEND_BYTES);
    const filePath = await resolveLogSourcePath(source);
    const pathHint = typeof options.pathHint === 'string' ? options.pathHint : '';
    const ignoreCursor = !!(pathHint && pathHint !== filePath);
    const hasCursor = !ignoreCursor && options.cursor !== undefined && options.cursor !== null && options.cursor !== '';
    const cursorValue = hasCursor ? Number(options.cursor) : null;
    const cursor = Number.isFinite(cursorValue) && cursorValue >= 0 ? Math.floor(cursorValue) : null;

    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return {
          ok: true,
          data: {
            source,
            path: filePath,
            exists: false,
            size: 0,
            updatedAt: null,
            content: '',
            nextCursor: 0,
            resetCursor: hasCursor || ignoreCursor,
            truncatedHead: false,
          },
        };
      }
      throw e;
    }

    if (!stats.isFile()) {
      return { ok: false, error: '日志路径不是文件' };
    }

    const fileSize = stats.size;
    let start = cursor === null ? Math.max(0, fileSize - initialBytes) : cursor;
    let resetCursor = false;
    let truncatedHead = false;

    if (cursor !== null && start > fileSize) {
      start = Math.max(0, fileSize - appendBytes);
      resetCursor = true;
      truncatedHead = start > 0;
    }

    const pendingBytes = fileSize - start;
    if (cursor !== null && pendingBytes > appendBytes) {
      start = Math.max(0, fileSize - appendBytes);
      resetCursor = true;
      truncatedHead = start > 0;
    }

    if (cursor === null && start > 0) {
      truncatedHead = true;
    }

    const contentLength = Math.max(0, fileSize - start);
    const content = await readUtf8Slice(filePath, start, contentLength);

    return {
      ok: true,
      data: {
        source,
        path: filePath,
        exists: true,
        size: fileSize,
        updatedAt: stats.mtime.toISOString(),
        content,
        nextCursor: fileSize,
        resetCursor,
        truncatedHead,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Workspace files ──

function isPathInside(child, parent) {
  const resolved = path.resolve(child);
  const resolvedParent = path.resolve(parent) + path.sep;
  return resolved.startsWith(resolvedParent) || resolved === path.resolve(parent);
}

function normalizeWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string') return null;
  const trimmed = workspacePath.trim();
  if (!trimmed) return null;

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir && trimmed === '~') {
    return path.resolve(homeDir);
  }
  if (homeDir && (trimmed.startsWith('~/') || trimmed.startsWith('~\\'))) {
    return path.resolve(path.join(homeDir, trimmed.slice(2)));
  }
  return path.resolve(trimmed);
}

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

// ── Fetch remote models ──

const https = require('https');
const http = require('http');

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

ipcMain.handle('models:fetch', async (_ev, { baseUrl, apiKey, api }) => {
  // Normalize baseUrl: strip trailing slash
  const base = baseUrl.replace(/\/+$/, '');

  // Build auth header based on api type
  const headers = { 'Accept': 'application/json' };
  if (api === 'openai-completions') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    // anthropic-messages style
    headers['x-api-key'] = apiKey;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Try multiple common endpoints
  const paths = ['/v1/models', '/models'];
  for (const p of paths) {
    try {
      const res = await fetchJson(base + p, headers);
      if (res.status === 200 && res.body) {
        // OpenAI format: { data: [{ id, ... }] }
        if (res.body.data && Array.isArray(res.body.data)) {
          return { ok: true, models: res.body.data.map(m => ({ id: m.id, name: m.id })) };
        }
        // Plain array format
        if (Array.isArray(res.body)) {
          return { ok: true, models: res.body.map(m => ({ id: m.id || m, name: m.name || m.id || m })) };
        }
        // Anthropic format or other: { models: [...] }
        if (res.body.models && Array.isArray(res.body.models)) {
          return { ok: true, models: res.body.models.map(m => ({ id: m.id || m, name: m.name || m.display_name || m.id || m })) };
        }
      }
    } catch (e) {
      console.warn(`[models:fetch] ${base}${p} failed:`, e.message);
    }
  }
  return { ok: false, error: '无法从远程获取模型列表，请检查 URL 和 API Key' };
});

// ── List skills ──

// 获取所有 skills 并按来源分组
async function fetchAllSkills() {
  const result = await runOpenclaw(['skills', 'list', '--json']);

  if (!result.ok) {
    return { ok: false, error: result.stderr || '执行 openclaw skills list 失败' };
  }

  const stdout = result.stdout || '';
  if (!stdout.trim()) {
    return { ok: false, error: 'openclaw skills list 返回为空' };
  }

  const data = JSON.parse(stdout);
  return { ok: true, skills: data.skills || [] };
}

ipcMain.handle('skills:listBundled', async () => {
  try {
    const result = await fetchAllSkills();
    if (!result.ok) return result;
    const bundledSkills = result.skills.filter(s => s.bundled === true);
    return { ok: true, skills: bundledSkills };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('skills:listAll', async () => {
  try {
    const result = await fetchAllSkills();
    if (!result.ok) return result;

    const allSkills = result.skills;
    const groups = {
      bundled: [],
      managed: [],
      workspace: [],
      personal: [],
    };

    for (const skill of allSkills) {
      if (skill.source === 'openclaw-bundled') {
        groups.bundled.push(skill);
      } else if (skill.source === 'openclaw-managed') {
        groups.managed.push(skill);
      } else if (skill.source === 'openclaw-workspace') {
        groups.workspace.push(skill);
      } else {
        // agents-skills-personal 和其他未知来源归入 personal
        groups.personal.push(skill);
      }
    }

    return { ok: true, skills: allSkills, groups };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
