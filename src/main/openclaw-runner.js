// openclaw 命令执行封装
const { execFile, spawn } = require('child_process');
const { toCommandString } = require('./utils');
const { openclawPath, resolveNotes } = require('./resolve-openclaw');

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

module.exports = {
  runOpenclaw,
  runOpenclawDetached,
};
