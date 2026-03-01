// 通用工具函数和常量
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ── 路径与配置常量 ──

const CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'openclaw.json');
const CONFIG_DIR = path.dirname(CONFIG_PATH);
const CONFIG_FILE_NAME = path.basename(CONFIG_PATH);
const PREFS_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'ui-prefs.json');

// ── 日志常量 ──

const LOG_SOURCE_GATEWAY_FILE = 'gateway-file';
const LOG_SOURCE_SERVICE_STDOUT = 'service-stdout';
const LOG_SOURCE_SERVICE_STDERR = 'service-stderr';
const DEFAULT_LOG_INITIAL_BYTES = 240 * 1024;
const DEFAULT_LOG_APPEND_BYTES = 180 * 1024;
const MAX_LOG_READ_BYTES = 2 * 1024 * 1024;

// ── Agent 常量 ──

const AGENT_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REQUIRED_WORKSPACE_IDENTITY_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md'];
const OPTIONAL_WORKSPACE_IDENTITY_FILES = ['USER.md', 'TOOLS.md', 'HEARTBEAT.md'];

// ── 纯工具函数 ──

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

function isConfigRelatedFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim()) return true;
  const base = path.basename(filename);
  return base === CONFIG_FILE_NAME || base === `${CONFIG_FILE_NAME}.tmp`;
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

function isPathInside(child, parent) {
  const resolved = path.resolve(child);
  const resolvedParent = path.resolve(parent) + path.sep;
  return resolved.startsWith(resolvedParent) || resolved === path.resolve(parent);
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

function getStateDirPath() {
  const envState = resolveHomePath(process.env.OPENCLAW_STATE_DIR || '');
  if (envState) return path.resolve(envState);
  return CONFIG_DIR;
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

module.exports = {
  // 常量
  CONFIG_PATH,
  CONFIG_DIR,
  CONFIG_FILE_NAME,
  PREFS_PATH,
  LOG_SOURCE_GATEWAY_FILE,
  LOG_SOURCE_SERVICE_STDOUT,
  LOG_SOURCE_SERVICE_STDERR,
  DEFAULT_LOG_INITIAL_BYTES,
  DEFAULT_LOG_APPEND_BYTES,
  MAX_LOG_READ_BYTES,
  AGENT_ID_REGEX,
  REQUIRED_WORKSPACE_IDENTITY_FILES,
  OPTIONAL_WORKSPACE_IDENTITY_FILES,
  // 函数
  uniqueStrings,
  splitPathEntries,
  getLoginShellValue,
  isExecutableFile,
  getNvmBinDirs,
  shellQuoteArg,
  toCommandString,
  clampNumber,
  resolveHomePath,
  formatDateStamp,
  normalizePathInput,
  pathExists,
  pathIsFile,
  isConfigRelatedFilename,
  normalizeWorkspacePath,
  isPathInside,
  copyPathIfExists,
  getStateDirPath,
  readUtf8Slice,
};
