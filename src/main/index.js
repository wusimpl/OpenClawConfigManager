const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

const CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'openclaw.json');

let mainWindow;

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
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ── Config read/write ──

ipcMain.handle('config:read', async () => {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ok: true, data: JSON.parse(raw), path: CONFIG_PATH };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('config:write', async (_ev, json) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(json, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Gateway management ──

function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout?.trim(), stderr: stderr?.trim(), code: err?.code });
    });
  });
}

ipcMain.handle('gateway:status', () => runCmd('openclaw gateway status --json'));

ipcMain.handle('gateway:start', () => runCmd('openclaw gateway start'));

ipcMain.handle('gateway:stop', () => runCmd('openclaw gateway stop'));

ipcMain.handle('gateway:restart', () => runCmd('openclaw gateway restart'));

ipcMain.handle('gateway:health', () => runCmd('openclaw gateway health --json'));

// ── Workspace files ──

ipcMain.handle('workspace:listFiles', async (_ev, workspacePath) => {
  try {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { ok: false, error: '工作区路径不存在' };
    }
    const files = fs.readdirSync(workspacePath)
      .filter(f => f.endsWith('.md') && fs.statSync(path.join(workspacePath, f)).isFile())
      .sort();
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('workspace:readFile', async (_ev, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('workspace:writeFile', async (_ev, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
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
    } catch {}
  }
  return { ok: false, error: '无法从远程获取模型列表，请检查 URL 和 API Key' };
});
