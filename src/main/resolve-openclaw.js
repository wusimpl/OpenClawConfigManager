// openclaw 可执行文件路径解析 —— 启动时执行一次
const path = require('path');
const { uniqueStrings, splitPathEntries, getLoginShellValue, isExecutableFile, getNvmBinDirs } = require('./utils');

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

module.exports = {
  openclawPath,
  userPath,
  resolveNotes,
};
