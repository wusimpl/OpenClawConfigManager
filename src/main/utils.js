// 通用工具函数和常量
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

// ── 路径与配置常量 ──

// 参考 OpenClaw 官方路径语义：
// - OPENCLAW_HOME: 覆盖 home（影响 ~ 展开）
// - OPENCLAW_STATE_DIR: 覆盖 state dir（默认 ~/.openclaw，并兼容历史目录）
// - OPENCLAW_CONFIG_PATH: 覆盖配置文件路径（默认 <stateDir>/openclaw.json，并优先使用已存在的候选）
const STATE_DIRNAME = '.openclaw';
const LEGACY_STATE_DIRNAMES = ['.clawdbot', '.moldbot', '.moltbot'];
const CONFIG_FILENAME = 'openclaw.json';
const LEGACY_CONFIG_FILENAMES = ['clawdbot.json', 'moldbot.json', 'moltbot.json'];

const STATE_DIR = resolveStateDirPath();
const CONFIG_PATH = resolveConfigPathCandidate();
const CONFIG_DIR = path.dirname(CONFIG_PATH);
const CONFIG_FILE_NAME = path.basename(CONFIG_PATH);
const PREFS_PATH = path.join(STATE_DIR, 'ui-prefs.json');

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

function getSystemHomeDir() {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  if (typeof envHome === 'string' && envHome.trim()) return envHome.trim();
  try {
    return os.homedir();
  } catch {
    return '';
  }
}

function getOpenClawHomeDir() {
  const systemHome = getSystemHomeDir();
  const overrideRaw = typeof process.env.OPENCLAW_HOME === 'string' ? process.env.OPENCLAW_HOME.trim() : '';
  if (!overrideRaw) return systemHome;
  if (!systemHome) return path.resolve(overrideRaw.replace(/^~[\\/]/, ''));
  if (overrideRaw === '~') return systemHome;
  if (overrideRaw.startsWith('~/') || overrideRaw.startsWith('~\\')) {
    return path.resolve(path.join(systemHome, overrideRaw.slice(2)));
  }
  return path.resolve(overrideRaw);
}

function getLoginShellValue(command) {
  // Windows 没有 login shell 概念，直接返回 null
  if (process.platform === 'win32') return null;
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
  const userHome = getOpenClawHomeDir();
  if (!userHome) return trimmed;
  if (trimmed === '~') return userHome;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(userHome, trimmed.slice(2));
  }
  return trimmed;
}

function resolveStateDirPath() {
  const overrideRaw = (process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR || '').trim();
  if (overrideRaw) {
    return path.resolve(resolveHomePath(overrideRaw));
  }

  const homeDir = getOpenClawHomeDir();
  const newDir = path.join(homeDir, STATE_DIRNAME);
  try {
    if (fs.existsSync(newDir)) return newDir;
  } catch {}

  for (const legacyDirName of LEGACY_STATE_DIRNAMES) {
    const legacyDir = path.join(homeDir, legacyDirName);
    try {
      if (fs.existsSync(legacyDir)) return legacyDir;
    } catch {}
  }

  return newDir;
}

function resolveDefaultConfigCandidates() {
  const candidates = [];

  const explicitConfig = (process.env.OPENCLAW_CONFIG_PATH || process.env.CLAWDBOT_CONFIG_PATH || '').trim();
  if (explicitConfig) {
    candidates.push(path.resolve(resolveHomePath(explicitConfig)));
  }

  const stateOverride = (process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR || '').trim();
  if (stateOverride) {
    const resolvedState = path.resolve(resolveHomePath(stateOverride));
    candidates.push(path.join(resolvedState, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path.join(resolvedState, name)));
  }

  const homeDir = getOpenClawHomeDir();
  const defaultStateDirs = [
    path.join(homeDir, STATE_DIRNAME),
    ...LEGACY_STATE_DIRNAMES.map((name) => path.join(homeDir, name)),
  ];
  for (const dir of defaultStateDirs) {
    candidates.push(path.join(dir, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path.join(dir, name)));
  }

  return uniqueStrings(candidates.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean));
}

function resolveConfigPathCandidate() {
  const candidates = resolveDefaultConfigCandidates();
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  const explicitConfig = (process.env.OPENCLAW_CONFIG_PATH || process.env.CLAWDBOT_CONFIG_PATH || '').trim();
  if (explicitConfig) {
    return path.resolve(resolveHomePath(explicitConfig));
  }

  return path.join(resolveStateDirPath(), CONFIG_FILENAME);
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

  const homeDir = getOpenClawHomeDir();
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
  return STATE_DIR;
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
