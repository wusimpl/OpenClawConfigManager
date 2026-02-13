// ── State ──
let config = null;
let configPath = '';

// ── Navigation ──
const allPages = ['config', 'providers', 'workspace', 'gateway'];
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    allPages.forEach(p => document.getElementById('page-' + p).classList.toggle('hidden', p !== page));
    if (page === 'gateway') refreshGatewayStatus();
    if (page === 'providers') renderProviders();
    if (page === 'workspace') initWorkspacePage();
  });
});

// ── Toast ──
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Config Page ──

async function loadConfig() {
  const res = await window.api.config.read();
  if (!res.ok) {
    document.getElementById('config-loading').textContent = '加载失败: ' + res.error;
    return;
  }
  config = res.data;
  configPath = res.path;
  document.getElementById('config-loading').classList.add('hidden');
  renderAgents();
  renderDefaultModel();
}

function getAllModels() {
  const models = [];
  const providers = config.models?.providers || {};
  for (const [providerKey, provider] of Object.entries(providers)) {
    for (const model of (provider.models || [])) {
      models.push({
        value: `${providerKey}/${model.id}`,
        label: `${providerKey} / ${model.name || model.id}`,
        provider: providerKey,
        modelId: model.id,
        modelName: model.name || model.id,
      });
    }
  }
  return models;
}

function getAgentModel(agent) {
  if (agent.model) {
    if (typeof agent.model === 'string') return agent.model;
    if (agent.model.primary) return agent.model.primary;
  }
  return null;
}

function getDefaultModel() {
  const d = config.agents?.defaults?.model;
  if (!d) return null;
  if (typeof d === 'string') return d;
  return d.primary || null;
}

function renderAgents() {
  const container = document.getElementById('agents-list');
  const agents = config.agents?.list || [];
  const allModels = getAllModels();
  const defaultModel = getDefaultModel();

  if (agents.length === 0) {
    container.innerHTML = '<div class="card"><p style="color:#8b949e">没有配置 agent</p></div>';
    return;
  }

  let html = '<div class="card"><h3>Agents</h3>';
  for (const agent of agents) {
    const currentModel = getAgentModel(agent) || defaultModel || '(未设置)';
    const isInherited = !getAgentModel(agent);

    html += `<div class="agent-row">
      <div>
        <div class="agent-name">${agent.name || agent.id}</div>
        <div class="agent-id">ID: ${agent.id}${agent.default ? ' (默认)' : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <select data-agent-id="${agent.id}" data-orig="${isInherited ? '' : (getAgentModel(agent) || '')}" class="agent-model-select">
          <option value=""${isInherited ? ' selected' : ''}>继承默认 (${defaultModel || '无'})</option>`;

    for (const m of allModels) {
      const sel = (!isInherited && currentModel === m.value) ? ' selected' : '';
      html += `<option value="${m.value}"${sel}>${m.label}</option>`;
    }

    html += `</select>
        <button class="btn btn-dormant btn-save-agent" data-agent-id="${agent.id}" disabled>保存</button>
      </div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  // Bind change detection + save
  container.querySelectorAll('.agent-model-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const btn = container.querySelector(`.btn-save-agent[data-agent-id="${sel.dataset.agentId}"]`);
      const dirty = sel.value !== sel.dataset.orig;
      btn.disabled = !dirty;
      btn.className = dirty ? 'btn btn-dirty btn-save-agent' : 'btn btn-dormant btn-save-agent';
    });
  });
  container.querySelectorAll('.btn-save-agent').forEach(btn => {
    btn.addEventListener('click', () => saveAgentModel(btn.dataset.agentId));
  });
}

function renderDefaultModel() {
  const container = document.getElementById('default-model-card');
  const allModels = getAllModels();
  const defaultModel = getDefaultModel();

  let html = '<div class="card"><h3>全局默认模型 (agents.defaults.model.primary)</h3>';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;">';
  html += `<select id="default-model-select" data-orig="${defaultModel || ''}">`;
  html += `<option value="">不设置</option>`;
  for (const m of allModels) {
    const sel = defaultModel === m.value ? ' selected' : '';
    html += `<option value="${m.value}"${sel}>${m.label}</option>`;
  }
  html += '</select>';
  html += '<button class="btn btn-dormant" id="btn-save-default" disabled>保存</button>';
  html += '</div></div>';
  container.innerHTML = html;

  document.getElementById('default-model-select').addEventListener('change', () => {
    const sel = document.getElementById('default-model-select');
    const btn = document.getElementById('btn-save-default');
    const dirty = sel.value !== sel.dataset.orig;
    btn.disabled = !dirty;
    btn.className = dirty ? 'btn btn-dirty' : 'btn btn-dormant';
  });
  document.getElementById('btn-save-default').addEventListener('click', saveDefaultModel);
}

async function saveAgentModel(agentId) {
  const select = document.querySelector(`select[data-agent-id="${agentId}"]`);
  const value = select.value;
  const agents = config.agents?.list || [];
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;

  if (value === '') {
    delete agent.model;
  } else {
    agent.model = { primary: value };
  }

  const res = await window.api.config.write(config);
  if (res.ok) {
    toast(`Agent "${agentId}" 模型已更新`);
    // reset button to dormant, update orig
    select.dataset.orig = value;
    const btn = document.querySelector(`.btn-save-agent[data-agent-id="${agentId}"]`);
    btn.disabled = true;
    btn.className = 'btn btn-dormant btn-save-agent';
  } else {
    toast('保存失败: ' + res.error, 'error');
  }
}

async function saveDefaultModel() {
  const value = document.getElementById('default-model-select').value;
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};

  if (value === '') {
    delete config.agents.defaults.model;
  } else {
    if (!config.agents.defaults.model) config.agents.defaults.model = {};
    if (typeof config.agents.defaults.model === 'string') {
      config.agents.defaults.model = { primary: value };
    } else {
      config.agents.defaults.model.primary = value;
    }
  }

  const res = await window.api.config.write(config);
  if (res.ok) {
    toast('默认模型已更新');
    // reset button to dormant, update orig
    const sel = document.getElementById('default-model-select');
    sel.dataset.orig = value;
    const btn = document.getElementById('btn-save-default');
    btn.disabled = true;
    btn.className = 'btn btn-dormant';
    renderAgents(); // refresh inherited labels
  } else {
    toast('保存失败: ' + res.error, 'error');
  }
}

// ── Provider Management ──

function findAffectedByProvider(providerKey) {
  const affected = [];
  const agents = config.agents?.list || [];
  const defaultModel = getDefaultModel();

  // check default model
  if (defaultModel && defaultModel.startsWith(providerKey + '/')) {
    affected.push({ type: 'default', label: '全局默认模型', model: defaultModel });
  }

  // check each agent
  for (const agent of agents) {
    const m = getAgentModel(agent);
    if (m && m.startsWith(providerKey + '/')) {
      affected.push({ type: 'agent', id: agent.id, label: agent.name || agent.id, model: m });
    }
  }

  // check agents.defaults.models
  const defaultModels = config.agents?.defaults?.models || {};
  for (const key of Object.keys(defaultModels)) {
    if (key.startsWith(providerKey + '/')) {
      affected.push({ type: 'defaults-models', label: `agents.defaults.models["${key}"]`, model: key });
    }
  }

  return affected;
}

function showModal(html) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(overlay);
  // close on overlay click (not modal body)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  return overlay;
}

function closeModal(overlay) {
  if (overlay) overlay.remove();
}

function renderProviders() {
  const container = document.getElementById('providers-list');
  if (!config) { container.innerHTML = '<span class="loading">配置未加载</span>'; return; }
  const providers = config.models?.providers || {};
  const keys = Object.keys(providers);

  if (keys.length === 0) {
    container.innerHTML = '<div class="card"><p style="color:#8b949e">没有配置 provider</p></div>';
    return;
  }

  let html = '';
  for (const key of keys) {
    const p = providers[key];
    const models = p.models || [];
    const maskedKey = p.apiKey ? p.apiKey.slice(0, 6) + '...' + p.apiKey.slice(-4) : '(未设置)';
    html += `<div class="provider-card">
      <div class="provider-header">
        <div>
          <div class="provider-name">${key}</div>
          <div class="provider-url">${p.baseUrl || '(无 URL)'}</div>
          <div class="provider-api">API: ${p.api || '(未设置)'} &nbsp;|&nbsp; Key: ${maskedKey}</div>
        </div>
        <div class="provider-actions">
          <button class="btn btn-secondary btn-sm btn-edit-provider" data-key="${key}">编辑</button>
          <button class="btn btn-danger btn-sm btn-delete-provider" data-key="${key}">删除</button>
        </div>
      </div>
      <div class="provider-models">`;
    if (models.length === 0) {
      html += '<span style="color:#8b949e;font-size:12px">无模型</span>';
    } else {
      for (const m of models) {
        html += `<span class="provider-model-tag">${m.name || m.id}</span>`;
      }
    }
    html += '</div></div>';
  }
  container.innerHTML = html;

  // bind edit/delete
  container.querySelectorAll('.btn-edit-provider').forEach(btn => {
    btn.addEventListener('click', () => openProviderEditor(btn.dataset.key));
  });
  container.querySelectorAll('.btn-delete-provider').forEach(btn => {
    btn.addEventListener('click', () => deleteProvider(btn.dataset.key));
  });
}

function buildProviderFormHtml(key, provider) {
  const isNew = !provider;
  const p = provider || { baseUrl: '', apiKey: '', api: 'anthropic-messages', models: [] };
  const title = isNew ? '添加 Provider' : `编辑 Provider: ${key}`;
  return `<h3>${title}</h3>
    <div class="form-group">
      <label>Provider Key (唯一标识)</label>
      <input class="form-input" id="pf-key" value="${key || ''}" ${isNew ? '' : 'disabled'} placeholder="如: openai, kiro">
    </div>
    <div class="form-group">
      <label>Base URL</label>
      <input class="form-input" id="pf-url" value="${p.baseUrl || ''}" placeholder="https://api.example.com">
    </div>
    <div class="form-group">
      <label>API Key</label>
      <input class="form-input" id="pf-apikey" value="${p.apiKey || ''}" placeholder="sk-...">
    </div>
    <div class="form-group">
      <label>API 类型</label>
      <select class="form-input" id="pf-api" style="min-width:auto">
        <option value="anthropic-messages"${p.api === 'anthropic-messages' ? ' selected' : ''}>anthropic-messages</option>
        <option value="openai-completions"${p.api === 'openai-completions' ? ' selected' : ''}>openai-completions</option>
      </select>
    </div>
    <div class="form-group">
      <label>模型列表</label>
      <div class="fetch-bar">
        <button class="btn btn-secondary btn-sm" id="pf-fetch">🔄 从 API 获取模型</button>
        <button class="btn btn-secondary btn-sm" id="pf-add-model">➕ 手动添加</button>
        <span class="fetch-status" id="pf-fetch-status"></span>
      </div>
      <div class="model-row-header"><span>Model ID</span><span>显示名称</span><span></span></div>
      <div class="model-rows" id="pf-model-rows"></div>
    </div>
    <div class="btn-group">
      <button class="btn btn-secondary" id="pf-cancel">取消</button>
      <button class="btn btn-primary" id="pf-save">${isNew ? '添加' : '保存'}</button>
    </div>`;
}

function createModelRowEl(id, name) {
  const row = document.createElement('div');
  row.className = 'model-row';
  row.innerHTML = `<input type="text" class="mr-id" value="${id}" placeholder="model-id">
    <input type="text" class="mr-name" value="${name}" placeholder="显示名称">
    <button class="btn-rm" title="删除">×</button>`;
  row.querySelector('.btn-rm').addEventListener('click', () => row.remove());
  return row;
}

function collectModelsFromEditor(overlay) {
  const rows = overlay.querySelectorAll('#pf-model-rows .model-row');
  const models = [];
  rows.forEach(row => {
    const id = row.querySelector('.mr-id').value.trim();
    const name = row.querySelector('.mr-name').value.trim();
    if (id) {
      models.push({
        id,
        name: name || id,
        reasoning: true,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      });
    }
  });
  return models;
}

function showModelPicker(remoteModels, rowsContainer) {
  // collect already-added IDs
  const getExistingIds = () => {
    const ids = new Set();
    rowsContainer.querySelectorAll('.model-row .mr-id').forEach(inp => {
      if (inp.value.trim()) ids.add(inp.value.trim());
    });
    return ids;
  };

  const pickerEl = document.createElement('div');
  pickerEl.className = 'picker-overlay';

  let listHtml = '';
  const existingIds = getExistingIds();
  for (let i = 0; i < remoteModels.length; i++) {
    const m = remoteModels[i];
    const already = existingIds.has(m.id);
    listHtml += `<div class="picker-item${already ? ' already' : ''}" data-idx="${i}" data-id="${m.id}">
      <div><span class="pi-name">${m.name || m.id}</span><span class="pi-id">${m.id}</span></div>
      ${already
        ? '<span class="pi-added">✓ 已添加</span>'
        : '<button class="pi-add">➕ 添加</button>'}
    </div>`;
  }

  pickerEl.innerHTML = `<div class="picker">
    <h3>选择要添加的模型</h3>
    <input class="picker-search" placeholder="搜索模型..." />
    <div class="picker-count">共 ${remoteModels.length} 个模型</div>
    <div class="picker-list">${listHtml}</div>
    <div class="btn-group">
      <button class="btn btn-secondary" id="pk-close">关闭</button>
    </div>
  </div>`;

  document.body.appendChild(pickerEl);

  // close
  pickerEl.querySelector('#pk-close').addEventListener('click', () => pickerEl.remove());
  pickerEl.addEventListener('click', (e) => { if (e.target === pickerEl) pickerEl.remove(); });

  // search filter
  pickerEl.querySelector('.picker-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    pickerEl.querySelectorAll('.picker-item').forEach(item => {
      const id = item.dataset.id.toLowerCase();
      const name = item.querySelector('.pi-name').textContent.toLowerCase();
      item.style.display = (id.includes(q) || name.includes(q)) ? '' : 'none';
    });
  });

  // add buttons
  pickerEl.querySelectorAll('.pi-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.picker-item');
      const idx = parseInt(item.dataset.idx);
      const m = remoteModels[idx];
      // add to editor
      rowsContainer.appendChild(createModelRowEl(m.id, m.name || m.id));
      // update button to "added"
      btn.replaceWith(Object.assign(document.createElement('span'), {
        className: 'pi-added',
        textContent: '✓ 已添加'
      }));
      item.classList.add('already');
    });
  });
}
function openProviderEditor(existingKey) {
  const provider = existingKey ? (config.models?.providers || {})[existingKey] : null;
  const overlay = showModal(buildProviderFormHtml(existingKey || '', provider));
  // widen modal for model rows
  overlay.querySelector('.modal').classList.add('modal-wide');

  // populate existing models
  const rowsContainer = overlay.querySelector('#pf-model-rows');
  for (const m of (provider?.models || [])) {
    rowsContainer.appendChild(createModelRowEl(m.id, m.name || m.id));
  }

  // add model manually
  overlay.querySelector('#pf-add-model').addEventListener('click', () => {
    rowsContainer.appendChild(createModelRowEl('', ''));
    const inputs = rowsContainer.querySelectorAll('.model-row:last-child input');
    if (inputs.length) inputs[0].focus();
  });

  // fetch models from remote
  overlay.querySelector('#pf-fetch').addEventListener('click', async () => {
    const baseUrl = overlay.querySelector('#pf-url').value.trim();
    const apiKey = overlay.querySelector('#pf-apikey').value.trim();
    const api = overlay.querySelector('#pf-api').value;
    const statusEl = overlay.querySelector('#pf-fetch-status');
    if (!baseUrl) { toast('请先填写 Base URL', 'error'); return; }
    statusEl.textContent = '获取中...';
    statusEl.style.color = '#8b949e';
    const fetchBtn = overlay.querySelector('#pf-fetch');
    fetchBtn.disabled = true;
    const res = await window.api.models.fetch({ baseUrl, apiKey, api });
    fetchBtn.disabled = false;
    if (res.ok && res.models.length > 0) {
      statusEl.textContent = `获取到 ${res.models.length} 个模型`;
      statusEl.style.color = '#3fb950';
      showModelPicker(res.models, rowsContainer);
    } else {
      statusEl.textContent = res.error || '未获取到模型';
      statusEl.style.color = '#f85149';
    }
  });

  // cancel
  overlay.querySelector('#pf-cancel').addEventListener('click', () => closeModal(overlay));
  // save
  overlay.querySelector('#pf-save').addEventListener('click', async () => {
    const key = overlay.querySelector('#pf-key').value.trim();
    const baseUrl = overlay.querySelector('#pf-url').value.trim();
    const apiKey = overlay.querySelector('#pf-apikey').value.trim();
    const api = overlay.querySelector('#pf-api').value;
    const models = collectModelsFromEditor(overlay);
    if (!key) { toast('Provider Key 不能为空', 'error'); return; }
    if (!existingKey && config.models?.providers?.[key]) {
      toast(`Provider "${key}" \u5df2\u5b58\u5728`, 'error');
      return;
    }
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    config.models.providers[key] = { baseUrl, apiKey, api, models };
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) {
      toast(existingKey ? `Provider "${key}" 已更新` : `Provider "${key}" 已添加`);
      renderProviders();
      renderAgents();
      renderDefaultModel();
    } else {
      toast('保存失败: ' + res.error, 'error');
    }
  });
}

function deleteProvider(providerKey) {
  const affected = findAffectedByProvider(providerKey);

  if (affected.length === 0) {
    // no dependencies, simple confirm
    const overlay = showModal(`
      <h3>删除 Provider</h3>
      <p>确定要删除 Provider <strong style="color:#f0883e">${providerKey}</strong> 吗？</p>
      <div class="btn-group">
        <button class="btn btn-secondary" id="dc-cancel">取消</button>
        <button class="btn btn-danger" id="dc-confirm">删除</button>
      </div>`);
    overlay.querySelector('#dc-cancel').addEventListener('click', () => closeModal(overlay));
    overlay.querySelector('#dc-confirm').addEventListener('click', () => {
      closeModal(overlay);
      executeDeleteProvider(providerKey, []);
    });
    return;
  }

  // has dependencies — show affected list and require confirmation
  let affectedHtml = '<div class="affected-list">';
  for (const a of affected) {
    if (a.type === 'default') {
      affectedHtml += `<div class="affected-item">🔗 ${a.label}: ${a.model}</div>`;
    } else if (a.type === 'agent') {
      affectedHtml += `<div class="affected-item">🤖 Agent "${a.label}" (${a.id}): ${a.model}</div>`;
    } else {
      affectedHtml += `<div class="affected-item">📋 ${a.label}</div>`;
    }
  }
  affectedHtml += '</div>';

  const overlay = showModal(`
    <h3>⚠️ 删除 Provider: ${providerKey}</h3>
    <p>以下配置正在使用该 Provider 的模型，删除后这些引用将被清除：</p>
    ${affectedHtml}
    <p style="color:#f85149">此操作不可撤销，确定继续？</p>
    <div class="btn-group">
      <button class="btn btn-secondary" id="dc-cancel">取消</button>
      <button class="btn btn-danger" id="dc-confirm">确认删除并清除引用</button>
    </div>`);
  overlay.querySelector('#dc-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#dc-confirm').addEventListener('click', () => {
    closeModal(overlay);
    executeDeleteProvider(providerKey, affected);
  });
}

async function executeDeleteProvider(providerKey, affected) {
  // clean up references
  for (const a of affected) {
    if (a.type === 'default') {
      if (config.agents?.defaults?.model) {
        if (typeof config.agents.defaults.model === 'string') {
          delete config.agents.defaults.model;
        } else {
          delete config.agents.defaults.model.primary;
          if (Object.keys(config.agents.defaults.model).length === 0) {
            delete config.agents.defaults.model;
          }
        }
      }
    } else if (a.type === 'agent') {
      const agent = (config.agents?.list || []).find(ag => ag.id === a.id);
      if (agent) delete agent.model;
    } else if (a.type === 'defaults-models') {
      if (config.agents?.defaults?.models) {
        delete config.agents.defaults.models[a.model];
      }
    }
  }

  // delete the provider
  delete config.models.providers[providerKey];
  if (Object.keys(config.models.providers).length === 0) {
    delete config.models.providers;
  }

  const res = await window.api.config.write(config);
  if (res.ok) {
    toast(`Provider "${providerKey}" 已删除` + (affected.length ? '，相关引用已清除' : ''));
    renderProviders();
    renderAgents();
    renderDefaultModel();
  } else {
    toast('删除失败: ' + res.error, 'error');
  }
}

document.getElementById('btn-add-provider').addEventListener('click', () => openProviderEditor(null));

// ── Gateway Page ──

async function refreshGatewayStatus() {
  const el = document.getElementById('gw-status');
  el.innerHTML = '<span class="loading">查询中...</span>';

  const [statusRes, healthRes] = await Promise.all([
    window.api.gateway.status(),
    window.api.gateway.health(),
  ]);

  let statusData = null;
  try { statusData = JSON.parse(statusRes.stdout); } catch {}

  let running = false;
  let statusHtml = '';

  if (statusRes.ok && statusData) {
    running = true;
    statusHtml = `<span class="badge badge-green">运行中</span>`;
    if (statusData.version) statusHtml += `<div class="gw-info" style="margin-top:12px">
      <span class="gw-label">版本</span><span>${statusData.version}</span>
    </div>`;
  } else if (statusRes.stdout?.includes('running')) {
    running = true;
    statusHtml = `<span class="badge badge-green">运行中</span>`;
  } else {
    statusHtml = `<span class="badge badge-red">已停止</span>`;
  }

  if (healthRes.ok) {
    let healthData = null;
    try { healthData = JSON.parse(healthRes.stdout); } catch {}
    if (healthData) {
      running = true;
      statusHtml = `<span class="badge badge-green">运行中</span>`;
      statusHtml += `<div class="gw-info" style="margin-top:12px">`;
      if (healthData.version) statusHtml += `<span class="gw-label">版本</span><span>${healthData.version}</span>`;
      if (healthData.uptime) statusHtml += `<span class="gw-label">运行时间</span><span>${healthData.uptime}</span>`;
      if (healthData.agents) statusHtml += `<span class="gw-label">Agents</span><span>${healthData.agents}</span>`;
      if (healthData.sessions) statusHtml += `<span class="gw-label">Sessions</span><span>${healthData.sessions}</span>`;
      statusHtml += `</div>`;
    }
  }

  el.innerHTML = statusHtml;

  // Update button states
  document.getElementById('btn-gw-start').disabled = running;
  document.getElementById('btn-gw-stop').disabled = !running;
  document.getElementById('btn-gw-restart').disabled = !running;

  // Gateway config info
  renderGatewayConfig();
}

function renderGatewayConfig() {
  const el = document.getElementById('gw-config-info');
  if (!config) { el.textContent = '配置未加载'; return; }
  const gw = config.gateway || {};
  el.innerHTML = `<div class="gw-info">
    <span class="gw-label">端口</span><span>${gw.port || 18789}</span>
    <span class="gw-label">模式</span><span>${gw.mode || '(未设置)'}</span>
    <span class="gw-label">绑定</span><span>${gw.bind || 'loopback'}</span>
    <span class="gw-label">认证模式</span><span>${gw.auth?.mode || '(未设置)'}</span>
    <span class="gw-label">Tailscale</span><span>${gw.tailscale?.mode || 'off'}</span>
  </div>`;
}

async function gatewayAction(action, btnId) {
  const btn = document.getElementById(btnId);
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '执行中...';

  const res = await window.api.gateway[action]();

  btn.textContent = origText;
  btn.disabled = false;

  if (res.ok) {
    toast(`网关${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}成功`);
  } else {
    toast(`操作失败: ${res.stderr || res.stdout || '未知错误'}`, 'error');
  }

  // Wait a moment then refresh
  setTimeout(refreshGatewayStatus, 1500);
}

document.getElementById('btn-gw-start').addEventListener('click', () => gatewayAction('start', 'btn-gw-start'));
document.getElementById('btn-gw-stop').addEventListener('click', () => gatewayAction('stop', 'btn-gw-stop'));
document.getElementById('btn-gw-restart').addEventListener('click', () => gatewayAction('restart', 'btn-gw-restart'));
document.getElementById('btn-gw-refresh').addEventListener('click', refreshGatewayStatus);

// ── Init ──
loadConfig();

// ── Workspace Editor ──

let wsState = {
  currentAgent: null,
  currentFile: null,
  files: [],
  originalContent: '',
  dirty: false,
  initialized: false,
};

function getAgentWorkspace(agentId) {
  const agents = config?.agents?.list || [];
  const agent = agents.find(a => a.id === agentId);
  if (agent?.workspace) return agent.workspace;
  // default workspace
  return config?.agents?.defaults?.workspace || null;
}

function initWorkspacePage() {
  if (!config) return;
  const select = document.getElementById('ws-agent-select');
  const agents = config.agents?.list || [];

  // only rebuild options if agent list changed
  if (!wsState.initialized) {
    select.innerHTML = '<option value="">选择 Agent...</option>';
    for (const agent of agents) {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = `${agent.name || agent.id}`;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      if (wsState.dirty && !confirm('当前文件有未保存的修改，确定切换？')) {
        select.value = wsState.currentAgent || '';
        return;
      }
      wsState.currentAgent = select.value || null;
      wsState.currentFile = null;
      wsState.dirty = false;
      if (wsState.currentAgent) {
        loadAgentFiles(wsState.currentAgent);
      } else {
        clearEditor();
      }
    });

    const editor = document.getElementById('ws-editor');
    editor.addEventListener('input', onEditorInput);
    editor.addEventListener('keydown', (e) => {
      // Tab inserts 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        onEditorInput();
      }
      // Ctrl+S saves
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (wsState.dirty) saveCurrentFile();
      }
    });
    document.getElementById('ws-btn-save').addEventListener('click', saveCurrentFile);

    wsState.initialized = true;
  }

  // restore selection if already picked
  if (wsState.currentAgent) {
    select.value = wsState.currentAgent;
  }
}

async function loadAgentFiles(agentId) {
  const wsPath = getAgentWorkspace(agentId);
  if (!wsPath) {
    document.getElementById('ws-file-tabs').innerHTML = '<span style="color:#f85149;font-size:12px">该 Agent 未配置 workspace 路径</span>';
    clearEditor();
    return;
  }

  const res = await window.api.workspace.listFiles(wsPath);
  if (!res.ok) {
    document.getElementById('ws-file-tabs').innerHTML = `<span style="color:#f85149;font-size:12px">${res.error}</span>`;
    clearEditor();
    return;
  }

  wsState.files = res.files;
  renderFileTabs();

  // auto-select first identity-like file
  const priority = ['IDENTITY.md', 'SOUL.md'];
  const autoFile = priority.find(f => wsState.files.includes(f)) || wsState.files[0];
  if (autoFile) {
    selectFile(autoFile);
  } else {
    clearEditor();
  }
}

function renderFileTabs() {
  const container = document.getElementById('ws-file-tabs');
  container.innerHTML = '';
  for (const file of wsState.files) {
    const tab = document.createElement('div');
    tab.className = 'ws-file-tab' + (file === wsState.currentFile ? ' active' : '');
    tab.textContent = file;
    tab.addEventListener('click', () => {
      if (file === wsState.currentFile) return;
      if (wsState.dirty && !confirm('当前文件有未保存的修改，确定切换？')) return;
      selectFile(file);
    });
    container.appendChild(tab);
  }
}

async function selectFile(fileName) {
  const wsPath = getAgentWorkspace(wsState.currentAgent);
  const filePath = wsPath + '\\' + fileName;
  const res = await window.api.workspace.readFile(filePath);
  if (!res.ok) {
    toast('读取失败: ' + res.error, 'error');
    return;
  }

  wsState.currentFile = fileName;
  wsState.originalContent = res.content;
  wsState.dirty = false;

  document.getElementById('ws-editor').value = res.content;
  updatePreview(res.content);
  updateSaveBtn();
  renderFileTabs();
}

function onEditorInput() {
  const content = document.getElementById('ws-editor').value;
  wsState.dirty = content !== wsState.originalContent;
  updatePreview(content);
  updateSaveBtn();
}

function updatePreview(mdText) {
  const preview = document.getElementById('ws-preview');
  if (!mdText && !wsState.currentFile) {
    preview.innerHTML = '<div class="ws-preview-placeholder">选择一个 Agent 和文件开始编辑</div>';
    return;
  }
  preview.innerHTML = marked.parse(mdText || '');
}

function updateSaveBtn() {
  const btn = document.getElementById('ws-btn-save');
  btn.disabled = !wsState.dirty;
  btn.className = wsState.dirty ? 'btn btn-dirty' : 'btn btn-dormant';
}

async function saveCurrentFile() {
  if (!wsState.currentAgent || !wsState.currentFile) return;
  const wsPath = getAgentWorkspace(wsState.currentAgent);
  const filePath = wsPath + '\\' + wsState.currentFile;
  const content = document.getElementById('ws-editor').value;

  const res = await window.api.workspace.writeFile(filePath, content);
  if (res.ok) {
    wsState.originalContent = content;
    wsState.dirty = false;
    updateSaveBtn();
    toast(`${wsState.currentFile} 已保存`);
  } else {
    toast('保存失败: ' + res.error, 'error');
  }
}

function clearEditor() {
  wsState.currentFile = null;
  wsState.originalContent = '';
  wsState.dirty = false;
  document.getElementById('ws-editor').value = '';
  document.getElementById('ws-preview').innerHTML = '<div class="ws-preview-placeholder">选择一个 Agent 和文件开始编辑</div>';
  updateSaveBtn();
}
