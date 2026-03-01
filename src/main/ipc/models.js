// 远程模型获取 IPC handler
const https = require('https');
const http = require('http');
const { ipcMain } = require('electron');

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

function register() {
  ipcMain.handle('models:fetch', async (_ev, { baseUrl, apiKey, api }) => {
    // 去掉末尾斜杠
    const base = baseUrl.replace(/\/+$/, '');

    // 根据 api 类型构建认证头
    const headers = { 'Accept': 'application/json' };
    if (api === 'openai-completions') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      // anthropic-messages 风格
      headers['x-api-key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // 尝试多个常见端点
    const paths = ['/v1/models', '/models'];
    for (const p of paths) {
      try {
        const res = await fetchJson(base + p, headers);
        if (res.status === 200 && res.body) {
          // OpenAI 格式: { data: [{ id, ... }] }
          if (res.body.data && Array.isArray(res.body.data)) {
            return { ok: true, models: res.body.data.map(m => ({ id: m.id, name: m.id })) };
          }
          // 纯数组格式
          if (Array.isArray(res.body)) {
            return { ok: true, models: res.body.map(m => ({ id: m.id || m, name: m.name || m.id || m })) };
          }
          // Anthropic 格式或其他: { models: [...] }
          if (res.body.models && Array.isArray(res.body.models)) {
            return { ok: true, models: res.body.models.map(m => ({ id: m.id || m, name: m.name || m.display_name || m.id || m })) };
          }
        }
      } catch (e) {
        console.warn(`[models:fetch] ${base}${p} 失败:`, e.message);
      }
    }
    return { ok: false, error: '无法从远程获取模型列表，请检查 URL 和 API Key' };
  });
}

module.exports = { register };
