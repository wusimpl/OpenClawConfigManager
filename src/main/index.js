// OpenClaw 管理器 —— Electron 主入口
const { app, BrowserWindow, session, Tray, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { CONFIG_PATH, CONFIG_DIR, PREFS_PATH, isConfigRelatedFilename } = require('./utils');
const { createTrayIcon } = require('./tray-icon');

// ── 注册所有 IPC handlers ──
require('./ipc/config').register();
require('./ipc/agents').register(() => mainWindow);
require('./ipc/logs').register();
require('./ipc/workspace').register();
require('./ipc/models').register();
require('./ipc/skills').register();

// ── 状态变量 ──

let mainWindow;
let tray = null;
let configWatchDebounce = null;
let configDirWatcher = null;

// ── 配置文件监听 ──

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

// ── 用户偏好（关闭行为） ──

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

// ── 托盘 ──

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

// ── 主窗口 ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
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

// ── App 生命周期 ──

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
