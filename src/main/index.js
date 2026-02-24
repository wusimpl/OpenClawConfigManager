const { app, BrowserWindow, ipcMain, session, Tray, Menu, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawnSync } = require('child_process');

const CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'openclaw.json');

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

  // Watch config file for external changes
  let watchDebounce = null;
  fs.watch(path.dirname(CONFIG_PATH), (eventType, filename) => {
    if (filename === path.basename(CONFIG_PATH)) {
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('config:changed');
        }
      }, 500);
    }
  });
});
app.on('window-all-closed', () => {
  // 不退出，保持托盘运行
});
app.on('before-quit', () => {
  app.isQuitting = true;
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
    execFile(openclawPath || 'openclaw', args, {
      timeout: 30000,
      env: { ...process.env, PATH: userPath },
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const stdoutText = stdout?.trim();
      let stderrText = stderr?.trim();
      if (err && err.code === 'ENOENT' && !stderrText) {
        const notesText = resolveNotes.length ? `（${resolveNotes.join('；')}）` : '';
        stderrText = `openclaw 命令不可用${notesText}`;
      }
      resolve({ ok: !err, stdout: stdoutText, stderr: stderrText, code: err?.code });
    });
  });
}

ipcMain.handle('gateway:status', () => runOpenclaw(['gateway', 'status', '--json']));

ipcMain.handle('gateway:start', () => runOpenclaw(['gateway', 'start']));

ipcMain.handle('gateway:stop', () => runOpenclaw(['gateway', 'stop']));

ipcMain.handle('gateway:restart', () => runOpenclaw(['gateway', 'restart']));

ipcMain.handle('gateway:health', () => runOpenclaw(['gateway', 'health', '--json']));

// ── Workspace files ──

function isPathInside(child, parent) {
  const resolved = path.resolve(child);
  const resolvedParent = path.resolve(parent) + path.sep;
  return resolved.startsWith(resolvedParent) || resolved === path.resolve(parent);
}

ipcMain.handle('workspace:listFiles', async (_ev, workspacePath) => {
  try {
    if (!workspacePath) {
      return { ok: false, error: '工作区路径不存在' };
    }
    try { await fs.promises.access(workspacePath); } catch {
      return { ok: false, error: '工作区路径不存在' };
    }
    const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
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
    const filePath = path.join(workspacePath, fileName);
    if (!isPathInside(filePath, workspacePath)) {
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
    const filePath = path.join(workspacePath, fileName);
    if (!isPathInside(filePath, workspacePath)) {
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
