// openclaw 命令执行封装 —— 跨平台兼容（Windows/macOS/Linux）
const { execFile, spawn } = require('child_process');
const { toCommandString } = require('./utils');
const { openclawPath, userPath, resolveNotes } = require('./resolve-openclaw');

// 构建跨平台的子进程环境变量
function buildChildEnv() {
  const env = { ...process.env, PATH: userPath || process.env.PATH };
  // npm_config_prefix 会干扰全局命令解析，移除它
  delete env.npm_config_prefix;
  return env;
}

// Windows 上 .cmd 文件需要通过 shell 执行
const isWin32 = process.platform === 'win32';

function runOpenclaw(args) {
  return new Promise((resolve) => {
    const executable = openclawPath || 'openclaw';
    const command = toCommandString(executable, args);
    const startedAt = Date.now();

    execFile(executable, args, {
      timeout: 30000,
      env: buildChildEnv(),
      // Windows 上 .cmd 文件需要 shell 模式执行
      shell: isWin32,
      windowsHide: true,
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
      const child = spawn(executable, args, {
        stdio: 'ignore',
        detached: !isWin32, // Unix 上 detach 以脱离父进程；Windows 上不需要
        env: buildChildEnv(),
        shell: isWin32,
        windowsHide: true,
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

module.exports = {
  runOpenclaw,
  runOpenclawDetached,
};
