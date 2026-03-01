// Skills 列表 IPC handlers
const { ipcMain } = require('electron');
const { runOpenclaw } = require('../openclaw-runner');

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

function register() {
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
}

module.exports = { register };
