// 日志读取 IPC handlers
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const {
  CONFIG_PATH,
  LOG_SOURCE_GATEWAY_FILE,
  LOG_SOURCE_SERVICE_STDOUT,
  LOG_SOURCE_SERVICE_STDERR,
  DEFAULT_LOG_INITIAL_BYTES,
  DEFAULT_LOG_APPEND_BYTES,
  MAX_LOG_READ_BYTES,
  clampNumber,
  resolveHomePath,
  formatDateStamp,
  getStateDirPath,
  readUtf8Slice,
} = require('../utils');

function extractLoggingFileFromRaw(raw) {
  if (typeof raw !== 'string') return null;
  const loggingStart = raw.search(/["']?logging["']?\s*:/);
  if (loggingStart < 0) return null;
  const segment = raw.slice(loggingStart, loggingStart + 8000);
  const match = segment.match(/["']?file["']?\s*:\s*["']([^"']+)["']/);
  if (!match || !match[1]) return null;
  return match[1].trim();
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
    // 忽略配置读取失败，回退到默认日志路径
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

function register() {
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
}

module.exports = { register };
