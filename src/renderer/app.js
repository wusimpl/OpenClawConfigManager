// ── State ──
let config = null;
let configPath = '';

// ── Helpers ──
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// ── Navigation ──
const allPages = ['config', 'providers', 'workspace', 'gateway', 'bindings', 'channels', 'agent-advanced', 'tools-config'];
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    allPages.forEach(p => {
      const el = document.getElementById('page-' + p);
      el.classList.toggle('hidden', p !== page);
    });
    if (page === 'gateway') refreshGatewayStatus();
    if (page === 'providers') renderProviders();
    if (page === 'workspace') initWorkspacePage();
    if (page === 'bindings') renderBindings();
    if (page === 'channels') renderChannels();
    if (page === 'agent-advanced') renderAgentAdvanced();
    if (page === 'tools-config') renderToolsConfig();
  });
});

// ── Toast ──
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = type === 'success' ? 'check-circle' : 'alert-circle';
  el.innerHTML = `<i data-lucide="${icon}" style="width:16px; height:16px; margin-right:8px; vertical-align:middle"></i><span>${esc(msg)}</span>`;
  document.body.appendChild(el);
  lucide.createIcons();
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 400);
  }, 3000);
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
  wsState.initialized = false;
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
    container.innerHTML = '<div class="card"><p style="color:var(--text-muted)">没有配置 agent</p></div>';
    return;
  }

  let html = '<div class="card"><h3>Agents</h3>';
  for (const agent of agents) {
    const currentModel = getAgentModel(agent) || defaultModel || '(未设置)';
    const isInherited = !getAgentModel(agent);

    html += `<div class="agent-row">
      <div>
        <div class="agent-name">${esc(agent.name || agent.id)}</div>
        <div class="agent-id">ID: ${esc(agent.id)}${agent.default ? ' <span style="color:var(--primary)">• 默认</span>' : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <select data-agent-id="${esc(agent.id)}" data-orig="${esc(isInherited ? '' : (getAgentModel(agent) || ''))}" class="agent-model-select">
          <option value=""${isInherited ? ' selected' : ''}>继承默认 (${esc(defaultModel || '无')})</option>`;

    for (const m of allModels) {
      const sel = (!isInherited && currentModel === m.value) ? ' selected' : '';
      html += `<option value="${esc(m.value)}"${sel}>${esc(m.label)}</option>`;
    }

    html += `</select>
        <button class="btn btn-secondary btn-save-agent" data-agent-id="${esc(agent.id)}" disabled>保存</button>
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
      btn.className = dirty ? 'btn btn-dirty btn-save-agent' : 'btn btn-secondary btn-save-agent';
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
  html += '<div style="display:flex;align-items:center;gap:12px;margin-top:8px;">';
  html += `<select id="default-model-select" data-orig="${esc(defaultModel || '')}">`;
  html += `<option value="">不设置</option>`;
  for (const m of allModels) {
    const sel = defaultModel === m.value ? ' selected' : '';
    html += `<option value="${esc(m.value)}"${sel}>${esc(m.label)}</option>`;
  }
  html += '</select>';
  html += '<button class="btn btn-secondary" id="btn-save-default" disabled>保存</button>';
  html += '</div></div>';
  container.innerHTML = html;

  document.getElementById('default-model-select').addEventListener('change', () => {
    const sel = document.getElementById('default-model-select');
    const btn = document.getElementById('btn-save-default');
    const dirty = sel.value !== sel.dataset.orig;
    btn.disabled = !dirty;
    btn.className = dirty ? 'btn btn-dirty' : 'btn btn-secondary';
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
    btn.className = 'btn btn-secondary btn-save-agent';
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
    btn.className = 'btn btn-secondary';
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
  lucide.createIcons();
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
    container.innerHTML = '<div class="card"><p style="color:var(--text-muted)">没有配置 provider</p></div>';
    return;
  }

  let html = '';
  for (const key of keys) {
    const p = providers[key];
    const models = p.models || [];
    const maskedKey = p.apiKey ? p.apiKey.slice(0, 6) + '...' + p.apiKey.slice(-4) : '(未设置)';
    html += `<div class="card" style="padding: 20px; border-left: 4px solid var(--primary)">
      <div style="display:flex; align-items:flex-start; justify-content:space-between">
        <div>
          <div style="font-weight:700; font-size:18px; color:var(--text)">${esc(key)}</div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:4px">${esc(p.baseUrl || '(无 URL)')}</div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:8px; display:flex; gap:16px">
            <span><b>API:</b> ${esc(p.api || '(未设置)')}</span>
            <span><b>Key:</b> ${esc(maskedKey)}</span>
          </div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-secondary btn-edit-provider" data-key="${esc(key)}" style="padding:4px 12px; font-size:12px">编辑</button>
          <button class="btn btn-danger btn-delete-provider" data-key="${esc(key)}" style="padding:4px 12px; font-size:12px">删除</button>
        </div>
      </div>
      <div style="margin-top:16px; display:flex; flex-wrap:wrap">`;
    if (models.length === 0) {
      html += '<span style="color:var(--text-muted);font-size:12px">无模型</span>';
    } else {
      for (const m of models) {
        html += `<span class="provider-model-tag">${esc(m.name || m.id)}</span>`;
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
  const title = isNew ? '添加 Provider' : `编辑 Provider: ${esc(key)}`;
  return `<h3 style="color:var(--text); text-transform:none; font-size:18px; margin-bottom:20px">${title}</h3>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px">Provider Key (唯一标识)</label>
      <input class="form-input" id="pf-key" style="width:100%" value="${esc(key || '')}" ${isNew ? '' : 'disabled'} placeholder="如: openai, kiro">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px">Base URL</label>
      <input class="form-input" id="pf-url" style="width:100%" value="${esc(p.baseUrl || '')}" placeholder="https://api.example.com">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px">API Key</label>
      <input class="form-input" id="pf-apikey" style="width:100%" value="${esc(p.apiKey || '')}" placeholder="sk-...">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px">API 类型</label>
      <select class="form-input" id="pf-api" style="width:100%">
        <option value="anthropic-messages"${p.api === 'anthropic-messages' ? ' selected' : ''}>anthropic-messages</option>
        <option value="openai-completions"${p.api === 'openai-completions' ? ' selected' : ''}>openai-completions</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block; font-size:12px; color:var(--text-muted); margin-bottom:6px">模型列表</label>
      <div class="fetch-bar" style="display:flex; gap:8px; margin-bottom:12px">
        <button class="btn btn-secondary btn-sm" id="pf-fetch" style="font-size:12px; padding:4px 10px"><i data-lucide="refresh-cw" style="width:12px;height:12px"></i> 获取模型</button>
        <button class="btn btn-secondary btn-sm" id="pf-add-model" style="font-size:12px; padding:4px 10px"><i data-lucide="plus" style="width:12px;height:12px"></i> 手动添加</button>
        <span class="fetch-status" id="pf-fetch-status" style="font-size:12px"></span>
      </div>
      <div id="pf-model-rows" style="max-height:160px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:8px"></div>
    </div>
    <div class="btn-group" style="display:flex; justify-content:flex-end; gap:10px; margin-top:24px">
      <button class="btn btn-secondary" id="pf-cancel">取消</button>
      <button class="btn btn-primary" id="pf-save">${isNew ? '添加' : '保存'}</button>
    </div>`;
}

function createModelRowEl(id, name) {
  const row = document.createElement('div');
  row.className = 'model-row';
  row.style = 'display:flex; gap:8px; margin-bottom:6px; align-items:center';
  row.innerHTML = `<input type="text" class="form-input mr-id" style="flex:1; padding:4px 8px; font-size:12px" value="${esc(id)}" placeholder="model-id">
    <input type="text" class="form-input mr-name" style="flex:1; padding:4px 8px; font-size:12px" value="${esc(name)}" placeholder="显示名称">
    <button class="btn btn-danger" style="padding:4px; line-height:1" title="删除"><i data-lucide="x" style="width:14px;height:14px"></i></button>`;
  row.querySelector('.btn-danger').addEventListener('click', () => row.remove());
  lucide.createIcons();
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
  const getExistingIds = () => {
    const ids = new Set();
    rowsContainer.querySelectorAll('.model-row .mr-id').forEach(inp => {
      if (inp.value.trim()) ids.add(inp.value.trim());
    });
    return ids;
  };

  const pickerEl = document.createElement('div');
  pickerEl.className = 'modal-overlay';
  pickerEl.style.zIndex = '950';

  let listHtml = '';
  const existingIds = getExistingIds();
  for (let i = 0; i < remoteModels.length; i++) {
    const m = remoteModels[i];
    const already = existingIds.has(m.id);
    listHtml += `<div class="picker-item" style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border); opacity:${already?0.5:1}">
      <div>
        <div style="font-size:13px; font-weight:600; color:var(--text)">${esc(m.name || m.id)}</div>
        <div style="font-size:11px; color:var(--text-muted)">${esc(m.id)}</div>
      </div>
      ${already
        ? '<span style="color:var(--success); font-size:12px">✓ 已存在</span>'
        : `<button class="btn btn-primary pi-add" data-idx="${i}" style="padding:2px 10px; font-size:11px">添加</button>`}
    </div>`;
  }

  pickerEl.innerHTML = `<div class="modal" style="max-width:400px">
    <h3 style="margin-bottom:16px; font-size:16px; text-transform:none">选择模型</h3>
    <div style="max-height:300px; overflow-y:auto; margin-bottom:20px">${listHtml}</div>
    <div style="text-align:right"><button class="btn btn-secondary" id="pk-close">关闭</button></div>
  </div>`;

  document.body.appendChild(pickerEl);

  pickerEl.querySelector('#pk-close').addEventListener('click', () => pickerEl.remove());
  pickerEl.querySelectorAll('.pi-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const m = remoteModels[idx];
      rowsContainer.appendChild(createModelRowEl(m.id, m.name || m.id));
      btn.disabled = true;
      btn.textContent = '✓';
    });
  });
}

function openProviderEditor(existingKey) {
  const provider = existingKey ? (config.models?.providers || {})[existingKey] : null;
  const overlay = showModal(buildProviderFormHtml(existingKey || '', provider));

  const rowsContainer = overlay.querySelector('#pf-model-rows');
  for (const m of (provider?.models || [])) {
    rowsContainer.appendChild(createModelRowEl(m.id, m.name || m.id));
  }

  overlay.querySelector('#pf-add-model').addEventListener('click', () => {
    rowsContainer.appendChild(createModelRowEl('', ''));
  });

  overlay.querySelector('#pf-fetch').addEventListener('click', async () => {
    const baseUrl = overlay.querySelector('#pf-url').value.trim();
    const apiKey = overlay.querySelector('#pf-apikey').value.trim();
    const api = overlay.querySelector('#pf-api').value;
    const statusEl = overlay.querySelector('#pf-fetch-status');
    if (!baseUrl) { toast('请填写 Base URL', 'error'); return; }
    statusEl.textContent = '获取中...';
    const fetchBtn = overlay.querySelector('#pf-fetch');
    fetchBtn.disabled = true;
    const res = await window.api.models.fetch({ baseUrl, apiKey, api });
    fetchBtn.disabled = false;
    if (res.ok && res.models.length > 0) {
      statusEl.textContent = `发现 ${res.models.length} 个模型`;
      showModelPicker(res.models, rowsContainer);
    } else {
      statusEl.textContent = '获取失败';
      toast(res.error || '未发现模型', 'error');
    }
  });

  overlay.querySelector('#pf-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#pf-save').addEventListener('click', async () => {
    const key = overlay.querySelector('#pf-key').value.trim();
    const baseUrl = overlay.querySelector('#pf-url').value.trim();
    const apiKey = overlay.querySelector('#pf-apikey').value.trim();
    const api = overlay.querySelector('#pf-api').value;
    const models = collectModelsFromEditor(overlay);
    if (!key) { toast('Key 不能为空', 'error'); return; }
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    config.models.providers[key] = { baseUrl, apiKey, api, models };
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) {
      toast('保存成功');
      renderProviders();
      renderAgents();
    }
  });
}

function deleteProvider(providerKey) {
  const affected = findAffectedByProvider(providerKey);
  let html = `<h3>删除 Provider: ${esc(providerKey)}</h3>
    <p style="font-size:13px; color:var(--text-muted); margin:12px 0">确定要删除吗？</p>`;

  if (affected.length > 0) {
    html += `<div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:8px; padding:12px; margin-bottom:20px">
      <div style="font-size:12px; color:var(--danger); font-weight:700; margin-bottom:8px">以下配置将被清除：</div>`;
    for (const a of affected) html += `<div style="font-size:11px; color:var(--danger)">• ${esc(a.label)}</div>`;
    html += `</div>`;
  }

  html += `<div class="btn-group" style="display:flex; justify-content:flex-end; gap:10px">
    <button class="btn btn-secondary" id="dc-cancel">取消</button>
    <button class="btn btn-danger" id="dc-confirm">确认删除</button>
  </div>`;

  const overlay = showModal(html);
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
  delete config.models.providers[providerKey];
  const res = await window.api.config.write(config);
  if (res.ok) {
    toast(`已删除 ${providerKey}`);
    renderProviders();
    renderAgents();
    renderDefaultModel();
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

  let healthData = null;
  try { healthData = JSON.parse(healthRes.stdout); } catch {}

  let running = false;
  let statusHtml = '';

  // 判断运行状态：优先从 service.runtime.status 判断，兼容旧格式
  if (statusData) {
    const runtimeStatus = statusData.service?.runtime?.status;
    if (runtimeStatus === 'running') {
      running = true;
    } else if (statusData.rpc?.ok) {
      // rpc 连通也说明网关在运行
      running = true;
    }
  }
  // 兜底：stdout 包含 running 文本
  if (!running && statusRes.stdout?.includes('running')) {
    running = true;
  }
  // 兜底：health 返回 ok
  if (!running && healthData?.ok) {
    running = true;
  }

  if (running) {
    statusHtml = `<span class="badge badge-green"><i data-lucide="check" style="width:12px;height:12px"></i> 运行中</span>`;

    // 从 status 中提取详细信息
    const details = [];
    const pid = statusData?.service?.runtime?.pid;
    if (pid) details.push({ label: 'PID', value: String(pid) });
    const port = statusData?.gateway?.port;
    if (port) details.push({ label: '端口', value: String(port) });
    const bind = statusData?.gateway?.bindHost;
    if (bind) details.push({ label: '绑定', value: bind });

    // 从 health 中提取 agent 和 channel 信息
    if (healthData?.ok) {
      const agentCount = healthData.agents?.length;
      if (agentCount) details.push({ label: 'Agents', value: String(agentCount) });
      const channelNames = healthData.channelOrder || Object.keys(healthData.channels || {});
      if (channelNames.length) details.push({ label: 'Channels', value: channelNames.join(', ') });
    }

    if (details.length > 0) {
      statusHtml += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:16px; font-size:13px">`;
      for (const d of details) {
        statusHtml += `<div><span style="color:var(--text-muted)">${esc(d.label)}:</span> ${esc(d.value)}</div>`;
      }
      statusHtml += `</div>`;
    }
  } else {
    statusHtml = `<span class="badge badge-red"><i data-lucide="x" style="width:12px;height:12px"></i> 已停止</span>`;
    // 如果有错误信息，显示出来帮助排查
    if (statusRes.stderr) {
      statusHtml += `<div style="margin-top:12px;font-size:12px;color:var(--danger)">${esc(statusRes.stderr)}</div>`;
    }
  }

  el.innerHTML = statusHtml;
  lucide.createIcons();

  document.getElementById('btn-gw-start').disabled = running;
  document.getElementById('btn-gw-stop').disabled = !running;
  document.getElementById('btn-gw-restart').disabled = !running;

  renderGatewayConfig();
}

function renderGatewayConfig() {
  const el = document.getElementById('gw-config-info');
  if (!config) { el.textContent = '配置未加载'; return; }
  const gw = config.gateway || {};
  el.innerHTML = `<div style="display:grid; grid-template-columns: 100px 1fr; gap:8px; font-size:13px">
    <span style="color:var(--text-muted)">监听端口</span><span>${esc(gw.port || 18789)}</span>
    <span style="color:var(--text-muted)">工作模式</span><span>${esc(gw.mode || '(未设置)')}</span>
    <span style="color:var(--text-muted)">网络绑定</span><span>${esc(gw.bind || 'loopback')}</span>
    <span style="color:var(--text-muted)">认证模式</span><span>${esc(gw.auth?.mode || 'none')}</span>
  </div>`;
}

async function gatewayAction(action, btnId) {
  const btn = document.getElementById(btnId);
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader" class="spin" style="width:14px;height:14px"></i> 执行中';
  lucide.createIcons();

  const wasRunning = !document.getElementById('btn-gw-start').disabled;
  const expectRunning = action === 'start' || action === 'restart';

  const res = await window.api.gateway[action]();
  btn.innerHTML = origHtml;
  btn.disabled = false;
  lucide.createIcons();

  if (res.ok) {
    toast(`操作成功`);
  } else {
    toast(`失败: ${res.stderr || '未知错误'}`, 'error');
  }

  // Poll until status changes or timeout (max 10s, interval 1.5s)
  let attempts = 0;
  const maxAttempts = 7;
  const poll = async () => {
    await refreshGatewayStatus();
    attempts++;
    const nowRunning = !document.getElementById('btn-gw-start').disabled;
    if (nowRunning === expectRunning || attempts >= maxAttempts) return;
    setTimeout(poll, 1500);
  };
  setTimeout(poll, 1000);
}

document.getElementById('btn-gw-start').addEventListener('click', () => gatewayAction('start', 'btn-gw-start'));
document.getElementById('btn-gw-stop').addEventListener('click', () => gatewayAction('stop', 'btn-gw-stop'));
document.getElementById('btn-gw-restart').addEventListener('click', () => gatewayAction('restart', 'btn-gw-restart'));
document.getElementById('btn-gw-refresh').addEventListener('click', refreshGatewayStatus);

// ── Init ──
loadConfig();

// ── Reload on external config change ──
window.api.config.onChanged(() => {
  loadConfig();
  toast('配置文件已被外部修改，已自动刷新');
});

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
  if (agentId) {
    const agents = config?.agents?.list || [];
    const agent = agents.find(a => a.id === agentId);
    if (agent?.workspace) return agent.workspace;
  }
  return config?.agents?.defaults?.workspace || null;
}

function initWorkspacePage() {
  if (!config) return;
  const select = document.getElementById('ws-agent-select');
  if (!wsState.initialized) {
    const agents = config.agents?.list || [];
    const defaultWs = config.agents?.defaults?.workspace || null;

    if (agents.length === 0 && defaultWs) {
      // 没有 agent 列表，但有默认 workspace，隐藏选择器，直接加载
      select.style.display = 'none';
      wsState.currentAgent = null;
      loadWorkspaceFiles(defaultWs);
    } else {
      select.style.display = '';
      select.innerHTML = '<option value="">选择 Agent...</option>';
      for (const agent of agents) {
        const opt = document.createElement('option');
        opt.value = agent.id;
        opt.textContent = agent.name || agent.id;
        select.appendChild(opt);
      }
    }

    select.addEventListener('change', () => {
      if (wsState.dirty && !confirm('变更未保存，确定切换？')) {
        select.value = wsState.currentAgent || '';
        return;
      }
      wsState.currentAgent = select.value || null;
      wsState.currentFile = null;
      wsState.dirty = false;
      if (wsState.currentAgent) {
        const wsPath = getAgentWorkspace(wsState.currentAgent);
        if (wsPath) loadWorkspaceFiles(wsPath);
        else clearEditor();
      } else {
        clearEditor();
      }
    });

    const editor = document.getElementById('ws-editor');
    editor.addEventListener('input', onEditorInput);
    document.getElementById('ws-btn-save').addEventListener('click', saveCurrentFile);
    wsState.initialized = true;
  }
}

async function loadWorkspaceFiles(wsPath) {
  if (!wsPath) {
    document.getElementById('ws-file-tabs').innerHTML = '<span style="color:var(--danger);font-size:12px">未配置 Workspace</span>';
    return;
  }
  const res = await window.api.workspace.listFiles(wsPath);
  if (!res.ok) {
    document.getElementById('ws-file-tabs').innerHTML = `<span style="color:var(--danger);font-size:12px">读取失败</span>`;
    return;
  }
  wsState.files = res.files;
  renderFileTabs();
  if (wsState.files.length) selectFile(wsState.files[0]);
}

function renderFileTabs() {
  const container = document.getElementById('ws-file-tabs');
  container.innerHTML = '';
  for (const file of wsState.files) {
    const tab = document.createElement('div');
    tab.className = 'ws-file-tab' + (file === wsState.currentFile ? ' active' : '');
    tab.textContent = file;
    tab.addEventListener('click', () => {
      if (file !== wsState.currentFile) selectFile(file);
    });
    container.appendChild(tab);
  }
}

async function selectFile(fileName) {
  const wsPath = getAgentWorkspace(wsState.currentAgent);
  const res = await window.api.workspace.readFile(wsPath, fileName);
  if (res.ok) {
    wsState.currentFile = fileName;
    wsState.originalContent = res.content;
    wsState.dirty = false;
    document.getElementById('ws-editor').value = res.content;
    updatePreview(res.content);
    updateSaveBtn();
    renderFileTabs();
  }
}

let _previewTimer = null;

function onEditorInput() {
  const content = document.getElementById('ws-editor').value;
  wsState.dirty = content !== wsState.originalContent;
  updateSaveBtn();
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => updatePreview(content), 200);
}

function updatePreview(mdText) {
  const preview = document.getElementById('ws-preview');
  preview.innerHTML = DOMPurify.sanitize(marked.parse(mdText || ''));
}

function updateSaveBtn() {
  const btn = document.getElementById('ws-btn-save');
  btn.disabled = !wsState.dirty;
  btn.className = wsState.dirty ? 'btn btn-dirty' : 'btn btn-secondary';
}

async function saveCurrentFile() {
  const wsPath = getAgentWorkspace(wsState.currentAgent);
  const content = document.getElementById('ws-editor').value;
  const res = await window.api.workspace.writeFile(wsPath, wsState.currentFile, content);
  if (res.ok) {
    wsState.originalContent = content;
    wsState.dirty = false;
    updateSaveBtn();
    toast('保存成功');
  }
}

function clearEditor() {
  wsState.currentFile = null;
  document.getElementById('ws-editor').value = '';
  document.getElementById('ws-preview').innerHTML = '';
  updateSaveBtn();
}

// ══════════════════════════════════════════════
// ── 1. Bindings (路由绑定) ──
// ══════════════════════════════════════════════

function renderBindings() {
  if (!config) return;
  const list = config.bindings || [];
  const container = document.getElementById('bindings-list');
  const agents = config.agents?.list || [];

  if (list.length === 0) {
    container.innerHTML = '<div class="card"><p style="color:var(--text-muted)">暂无绑定规则</p></div>';
    return;
  }

  let html = '';
  list.forEach((b, i) => {
    const agentName = agents.find(a => a.id === b.agentId)?.name || b.agentId;
    const ch = b.match?.channel || '(任意)';
    const peerKind = b.match?.peer?.kind || '(任意)';
    const peerId = b.match?.peer?.id || '(任意)';
    html += `<div class="card" style="border-left:4px solid var(--primary)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700;font-size:16px;color:var(--text)">规则 #${i + 1}</div>
          <div style="display:grid;grid-template-columns:80px 1fr;gap:6px 12px;margin-top:12px;font-size:13px">
            <span style="color:var(--text-muted)">Agent</span><span style="color:var(--primary);font-weight:600">${esc(agentName)}</span>
            <span style="color:var(--text-muted)">Channel</span><span>${esc(ch)}</span>
            <span style="color:var(--text-muted)">Peer 类型</span><span>${esc(peerKind)}</span>
            <span style="color:var(--text-muted)">Peer ID</span><span style="font-family:monospace;font-size:12px">${esc(peerId)}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-edit-binding" data-idx="${i}" style="padding:4px 12px;font-size:12px">编辑</button>
          <button class="btn btn-danger btn-del-binding" data-idx="${i}" style="padding:4px 12px;font-size:12px">删除</button>
        </div>
      </div>
    </div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.btn-edit-binding').forEach(btn => {
    btn.addEventListener('click', () => openBindingEditor(parseInt(btn.dataset.idx)));
  });
  container.querySelectorAll('.btn-del-binding').forEach(btn => {
    btn.addEventListener('click', () => deleteBinding(parseInt(btn.dataset.idx)));
  });
}

function openBindingEditor(idx) {
  const isNew = idx === -1;
  const binding = isNew ? { agentId: '', match: { channel: '', peer: { kind: '', id: '' } } } : JSON.parse(JSON.stringify(config.bindings[idx]));
  const agents = config.agents?.list || [];
  const channels = Object.keys(config.channels || {});

  let agentOpts = '<option value="">选择 Agent...</option>';
  for (const a of agents) {
    const sel = binding.agentId === a.id ? ' selected' : '';
    agentOpts += `<option value="${esc(a.id)}"${sel}>${esc(a.name || a.id)}</option>`;
  }

  let chOpts = '<option value="">任意 Channel</option>';
  for (const ch of channels) {
    const sel = binding.match?.channel === ch ? ' selected' : '';
    chOpts += `<option value="${esc(ch)}"${sel}>${esc(ch)}</option>`;
  }

  const html = `<h3 style="color:var(--text);text-transform:none;font-size:18px;margin-bottom:20px">${isNew ? '添加绑定' : '编辑绑定'}</h3>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Agent</label>
      <select class="form-input" id="bf-agent" style="width:100%">${agentOpts}</select>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Channel</label>
      <select class="form-input" id="bf-channel" style="width:100%">${chOpts}</select>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Peer Kind (留空=匹配所有)</label>
      <select class="form-input" id="bf-peer-kind" style="width:100%">
        <option value=""${!binding.match?.peer?.kind ? ' selected' : ''}>任意</option>
        <option value="group"${binding.match?.peer?.kind === 'group' ? ' selected' : ''}>group</option>
        <option value="private"${binding.match?.peer?.kind === 'private' ? ' selected' : ''}>private</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Peer ID (留空=匹配所有)</label>
      <input class="form-input" id="bf-peer-id" style="width:100%" value="${esc(binding.match?.peer?.id || '')}" placeholder="如: oc_xxxx">
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:24px">
      <button class="btn btn-secondary" id="bf-cancel">取消</button>
      <button class="btn btn-primary" id="bf-save">${isNew ? '添加' : '保存'}</button>
    </div>`;

  const overlay = showModal(html);
  overlay.querySelector('#bf-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#bf-save').addEventListener('click', async () => {
    const agentId = overlay.querySelector('#bf-agent').value;
    if (!agentId) { toast('请选择 Agent', 'error'); return; }
    const match = {};
    const ch = overlay.querySelector('#bf-channel').value;
    if (ch) match.channel = ch;
    const kind = overlay.querySelector('#bf-peer-kind').value;
    const id = overlay.querySelector('#bf-peer-id').value.trim();
    if (kind || id) {
      match.peer = {};
      if (kind) match.peer.kind = kind;
      if (id) match.peer.id = id;
    }
    const newBinding = { agentId, match };
    if (!config.bindings) config.bindings = [];
    if (isNew) config.bindings.push(newBinding);
    else config.bindings[idx] = newBinding;
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) { toast('绑定已保存'); renderBindings(); }
    else toast('保存失败: ' + res.error, 'error');
  });
}

async function deleteBinding(idx) {
  const overlay = showModal(`<h3 style="color:var(--text);text-transform:none">删除绑定规则 #${idx + 1}？</h3>
    <p style="font-size:13px;color:var(--text-muted);margin:12px 0">此操作不可撤销。</p>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-secondary" id="bd-cancel">取消</button>
      <button class="btn btn-danger" id="bd-confirm">确认删除</button>
    </div>`);
  overlay.querySelector('#bd-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#bd-confirm').addEventListener('click', async () => {
    config.bindings.splice(idx, 1);
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) { toast('已删除'); renderBindings(); }
    else toast('删除失败', 'error');
  });
}

document.getElementById('btn-add-binding').addEventListener('click', () => openBindingEditor(-1));
document.getElementById('btn-add-channel').addEventListener('click', () => openAddChannelEditor());

// ══════════════════════════════════════════════
// ── 2. Channels (飞书等) ──
// ══════════════════════════════════════════════

// Channels that support hot reload per official docs
const HOT_RELOAD_CHANNELS = new Set(['whatsapp', 'telegram', 'discord', 'signal', 'imessage', 'web', 'slack', 'mattermost', 'googlechat']);

// Channels that do NOT require gateway restart (restart icon hidden)
const NO_GATEWAY_RESTART_ICON_CHANNELS = new Set([
  'bluebubbles',
  'discord',
  'feishu',
  'googlechat',
  'imessage',
  'irc',
  'line',
  'matrix',
  'mattermost',
  'msteams',
  'nextcloud-talk',
  'nostr',
  'signal',
  'slack',
  'synology-chat',
  'telegram',
  'tlon',
  'whatsapp',
  'zalo',
  'zalouser',
]);

function renderChannels() {
  if (!config) return;
  const container = document.getElementById('channels-editor');
  const channels = config.channels || {};
  const keys = Object.keys(channels);

  if (keys.length === 0) {
    container.innerHTML = '<div class="card"><p style="color:var(--text-muted)">暂无 Channel 配置</p></div>';
    return;
  }

  let html = '';
  for (const key of keys) {
    const needsRestart = !NO_GATEWAY_RESTART_ICON_CHANNELS.has(key);
    const ch = channels[key];
    const maskedSecret = ch.appSecret ? ch.appSecret.slice(0, 4) + '...' + ch.appSecret.slice(-4) : '(未设置)';
    const groups = ch.groups || {};
    const groupKeys = Object.keys(groups);

    html += `<div class="card" style="border-left:4px solid var(--warning)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="font-weight:700;font-size:18px;color:var(--text)">${esc(key)}${needsRestart ? ' <i data-lucide="power" style="width:14px;height:14px;color:var(--warning);vertical-align:middle" title="修改后需重启网关"></i>' : ''}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-edit-channel" data-key="${esc(key)}" style="padding:4px 12px;font-size:12px">编辑</button>
          <button class="btn btn-danger btn-del-channel" data-key="${esc(key)}" style="padding:4px 12px;font-size:12px">删除</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 12px;margin-top:16px;font-size:13px">
        <span style="color:var(--text-muted)">App ID</span><span style="font-family:monospace">${esc(ch.appId || '(未设置)')}</span>
        <span style="color:var(--text-muted)">App Secret</span><span style="font-family:monospace">${esc(maskedSecret)}</span>
        <span style="color:var(--text-muted)">启用</span><span>${ch.enabled !== false ? '<span style="color:var(--success)">是</span>' : '<span style="color:var(--danger)">否</span>'}</span>
        <span style="color:var(--text-muted)">需要 @</span><span>${ch.requireMention ? '是' : '否'}</span>
      </div>`;

    if (groupKeys.length > 0) {
      html += `<div style="margin-top:16px"><div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px">群组覆盖配置 (${groupKeys.length})</div>`;
      for (const gid of groupKeys) {
        const g = groups[gid];
        html += `<div style="background:#09090b;border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-family:monospace;color:var(--text-muted)">${esc(gid)}</span>
          <span>requireMention: <b>${g.requireMention !== undefined ? esc(String(g.requireMention)) : '继承'}</b></span>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
  lucide.createIcons();

  container.querySelectorAll('.btn-edit-channel').forEach(btn => {
    btn.addEventListener('click', () => openChannelEditor(btn.dataset.key));
  });
  container.querySelectorAll('.btn-del-channel').forEach(btn => {
    btn.addEventListener('click', () => deleteChannel(btn.dataset.key));
  });
}

function openChannelEditor(key) {
  const ch = JSON.parse(JSON.stringify(config.channels[key]));
  const groups = ch.groups || {};
  const groupKeys = Object.keys(groups);

  let groupRowsHtml = '';
  for (const gid of groupKeys) {
    groupRowsHtml += buildChannelGroupRow(gid, groups[gid]);
  }

  const html = `<h3 style="color:var(--text);text-transform:none;font-size:18px;margin-bottom:20px">编辑 Channel: ${esc(key)}</h3>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">App ID</label>
      <input class="form-input" id="cf-appid" style="width:100%" value="${esc(ch.appId || '')}">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">App Secret</label>
      <input class="form-input" id="cf-secret" style="width:100%" value="${esc(ch.appSecret || '')}">
    </div>
    <div class="form-group" style="margin-bottom:16px;display:flex;gap:24px">
      <label style="font-size:13px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="cf-enabled" ${ch.enabled !== false ? 'checked' : ''}> 启用
      </label>
      <label style="font-size:13px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="cf-mention" ${ch.requireMention ? 'checked' : ''}> 需要 @提及
      </label>
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-muted);margin-bottom:6px">
        <span>群组覆盖配置</span>
        <button class="btn btn-secondary" id="cf-add-group" style="padding:2px 10px;font-size:11px"><i data-lucide="plus" style="width:12px;height:12px"></i> 添加群组</button>
      </label>
      <div id="cf-group-rows">${groupRowsHtml}</div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:24px">
      <button class="btn btn-secondary" id="cf-cancel">取消</button>
      <button class="btn btn-primary" id="cf-save">保存</button>
    </div>`;

  const overlay = showModal(html);
  // widen modal for groups
  overlay.querySelector('.modal').style.maxWidth = '560px';
  lucide.createIcons();

  overlay.querySelector('#cf-add-group').addEventListener('click', () => {
    const container = overlay.querySelector('#cf-group-rows');
    container.insertAdjacentHTML('beforeend', buildChannelGroupRow('', { requireMention: false }));
    bindGroupRowDelete(container);
  });
  bindGroupRowDelete(overlay.querySelector('#cf-group-rows'));

  overlay.querySelector('#cf-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#cf-save').addEventListener('click', async () => {
    const updated = {
      appId: overlay.querySelector('#cf-appid').value.trim(),
      appSecret: overlay.querySelector('#cf-secret').value.trim(),
      enabled: overlay.querySelector('#cf-enabled').checked,
      requireMention: overlay.querySelector('#cf-mention').checked,
    };
    const groupRows = overlay.querySelectorAll('.cf-group-row');
    if (groupRows.length > 0) {
      updated.groups = {};
      groupRows.forEach(row => {
        const gid = row.querySelector('.cf-gid').value.trim();
        if (gid) {
          updated.groups[gid] = { requireMention: row.querySelector('.cf-grm').checked };
        }
      });
    }
    config.channels[key] = updated;
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) {
      const msg = HOT_RELOAD_CHANNELS.has(key) ? 'Channel 已保存' : 'Channel 已保存，需重启网关生效';
      toast(msg);
      renderChannels();
    }
    else toast('保存失败: ' + res.error, 'error');
  });
}

function buildChannelGroupRow(gid, g) {
  return `<div class="cf-group-row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;background:#09090b;border:1px solid var(--border);border-radius:8px;padding:8px 12px">
    <input class="form-input cf-gid" style="flex:1;padding:4px 8px;font-size:12px;font-family:monospace" value="${esc(gid)}" placeholder="群组 ID (oc_xxx)">
    <label style="font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap">
      <input type="checkbox" class="cf-grm" ${g.requireMention ? 'checked' : ''}> @提及
    </label>
    <button class="btn btn-danger cf-group-del" style="padding:2px 6px;font-size:11px">删除</button>
  </div>`;
}

function bindGroupRowDelete(container) {
  container.querySelectorAll('.cf-group-del').forEach(btn => {
    btn.onclick = () => btn.closest('.cf-group-row').remove();
  });
}

async function deleteChannel(key) {
  const overlay = showModal(`<h3 style="color:var(--text);text-transform:none">删除 Channel: ${esc(key)}？</h3>
    <p style="font-size:13px;color:var(--text-muted);margin:12px 0">此操作不可撤销。</p>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn btn-secondary" id="cd-cancel">取消</button>
      <button class="btn btn-danger" id="cd-confirm">确认删除</button>
    </div>`);
  overlay.querySelector('#cd-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#cd-confirm').addEventListener('click', async () => {
    delete config.channels[key];
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) {
      const msg = HOT_RELOAD_CHANNELS.has(key) ? '已删除 Channel' : '已删除 Channel，需重启网关生效';
      toast(msg);
      renderChannels();
    }
    else toast('删除失败: ' + res.error, 'error');
  });
}

function openAddChannelEditor() {
  const html = `<h3 style="color:var(--text);text-transform:none;font-size:18px;margin-bottom:20px">添加 Channel</h3>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Channel Key (唯一标识，如 feishu, telegram)</label>
      <input class="form-input" id="nc-key" style="width:100%" placeholder="feishu">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">App ID</label>
      <input class="form-input" id="nc-appid" style="width:100%" placeholder="cli_xxx">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">App Secret</label>
      <input class="form-input" id="nc-secret" style="width:100%" placeholder="secret">
    </div>
    <div class="form-group" style="margin-bottom:16px;display:flex;gap:24px">
      <label style="font-size:13px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="nc-enabled" checked> 启用
      </label>
      <label style="font-size:13px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="nc-mention"> 需要 @提及
      </label>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:24px">
      <button class="btn btn-secondary" id="nc-cancel">取消</button>
      <button class="btn btn-primary" id="nc-save">添加</button>
    </div>`;

  const overlay = showModal(html);
  overlay.querySelector('#nc-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#nc-save').addEventListener('click', async () => {
    const key = overlay.querySelector('#nc-key').value.trim();
    if (!key) { toast('Key 不能为空', 'error'); return; }
    if (config.channels && config.channels[key]) { toast('该 Channel 已存在', 'error'); return; }
    if (!config.channels) config.channels = {};
    config.channels[key] = {
      appId: overlay.querySelector('#nc-appid').value.trim(),
      appSecret: overlay.querySelector('#nc-secret').value.trim(),
      enabled: overlay.querySelector('#nc-enabled').checked,
      requireMention: overlay.querySelector('#nc-mention').checked,
    };
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) {
      const msg = HOT_RELOAD_CHANNELS.has(key) ? 'Channel 已添加' : 'Channel 已添加，需重启网关生效';
      toast(msg);
      renderChannels();
    }
    else toast('保存失败: ' + res.error, 'error');
  });
}

// ══════════════════════════════════════════════
// ── 3. Agent 高级配置 ──
// ══════════════════════════════════════════════

function renderAgentAdvanced() {
  if (!config) return;
  const container = document.getElementById('agent-advanced-editor');
  const defaults = config.agents?.defaults || {};
  const agents = config.agents?.list || [];

  let html = '';

  // --- defaults section ---
  html += `<div class="card" style="border-left:4px solid var(--success)">
    <h3>全局默认参数 (agents.defaults)</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="form-group">
        <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Compaction Mode</label>
        <select class="form-input" id="aa-compaction" style="width:100%">
          <option value="safeguard"${defaults.compaction?.mode === 'safeguard' ? ' selected' : ''}>safeguard</option>
          <option value="auto"${defaults.compaction?.mode === 'auto' ? ' selected' : ''}>auto</option>
          <option value="off"${defaults.compaction?.mode === 'off' ? ' selected' : ''}>off</option>
        </select>
      </div>
      <div class="form-group">
        <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Max Concurrent</label>
        <input class="form-input" id="aa-maxconcurrent" type="number" min="1" max="32" style="width:100%" value="${defaults.maxConcurrent || 4}">
      </div>
      <div class="form-group">
        <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Subagents Max Concurrent</label>
        <input class="form-input" id="aa-sub-maxconcurrent" type="number" min="1" max="32" style="width:100%" value="${defaults.subagents?.maxConcurrent || 8}">
      </div>
    </div>
    <div style="margin-top:16px;text-align:right">
      <button class="btn btn-secondary" id="aa-save-defaults">保存默认参数</button>
    </div>
  </div>`;

  // --- per-agent advanced ---
  for (const agent of agents) {
    const gc = agent.groupChat || {};
    const patterns = (gc.mentionPatterns || []).join(', ');
    html += `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <span style="font-weight:700;font-size:16px;color:var(--text)">${esc(agent.name || agent.id)}</span>
          <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${esc(agent.id)}</span>
        </div>
        <button class="btn btn-secondary btn-edit-agent-adv" data-id="${esc(agent.id)}" style="padding:4px 12px;font-size:12px">编辑</button>
      </div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:13px">
        <span style="color:var(--text-muted)">触发词</span><span>${patterns ? esc(patterns) : '<span style="color:var(--text-muted)">(无)</span>'}</span>
      </div>
    </div>`;
  }

  container.innerHTML = html;

  document.getElementById('aa-save-defaults').addEventListener('click', saveAgentDefaults);
  container.querySelectorAll('.btn-edit-agent-adv').forEach(btn => {
    btn.addEventListener('click', () => openAgentAdvEditor(btn.dataset.id));
  });
}

async function saveAgentDefaults() {
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  const d = config.agents.defaults;

  d.compaction = { mode: document.getElementById('aa-compaction').value };
  d.maxConcurrent = parseInt(document.getElementById('aa-maxconcurrent').value) || 4;
  if (!d.subagents) d.subagents = {};
  d.subagents.maxConcurrent = parseInt(document.getElementById('aa-sub-maxconcurrent').value) || 8;

  const res = await window.api.config.write(config);
  if (res.ok) {
    toast('默认参数已保存');
    const btn = document.getElementById('aa-save-defaults');
    btn.className = 'btn btn-secondary';
  } else toast('保存失败: ' + res.error, 'error');
}

function openAgentAdvEditor(agentId) {
  const agent = (config.agents?.list || []).find(a => a.id === agentId);
  if (!agent) return;
  const gc = agent.groupChat || {};
  const patterns = (gc.mentionPatterns || []).join('\n');

  const html = `<h3 style="color:var(--text);text-transform:none;font-size:18px;margin-bottom:20px">Agent 高级配置: ${esc(agent.name || agent.id)}</h3>
    <div class="form-group" style="margin-bottom:16px">
      <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">触发词 / Mention Patterns (每行一个，支持正则)</label>
      <textarea class="form-input" id="aae-patterns" style="width:100%;height:100px;font-family:monospace;font-size:13px;resize:vertical">${esc(patterns)}</textarea>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:24px">
      <button class="btn btn-secondary" id="aae-cancel">取消</button>
      <button class="btn btn-primary" id="aae-save">保存</button>
    </div>`;

  const overlay = showModal(html);
  overlay.querySelector('#aae-cancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#aae-save').addEventListener('click', async () => {
    const raw = overlay.querySelector('#aae-patterns').value;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      if (!agent.groupChat) agent.groupChat = {};
      agent.groupChat.mentionPatterns = lines;
    } else {
      delete agent.groupChat;
    }
    const res = await window.api.config.write(config);
    closeModal(overlay);
    if (res.ok) { toast('Agent 配置已保存'); renderAgentAdvanced(); }
    else toast('保存失败: ' + res.error, 'error');
  });
}

// ══════════════════════════════════════════════
// ── 4. Tools 配置 ──
// ══════════════════════════════════════════════

function renderToolsConfig() {
  if (!config) return;
  const container = document.getElementById('tools-config-editor');
  const tools = config.tools || {};
  const web = tools.web || {};
  const search = web.search || {};
  const fetch_ = web.fetch || {};

  const maskedKey = search.apiKey ? search.apiKey.slice(0, 6) + '...' + search.apiKey.slice(-4) : '';

  let html = `<div class="card" style="border-left:4px solid var(--primary)">
    <h3>Web Search</h3>
    <div style="display:flex;flex-direction:column;gap:16px">
      <label style="font-size:13px;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="tc-search-enabled" ${search.enabled ? 'checked' : ''}> 启用搜索
      </label>
      <div class="form-group">
        <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px">Search API Key</label>
        <input class="form-input" id="tc-search-key" style="width:100%" value="${esc(search.apiKey || '')}" placeholder="搜索 API Key">
      </div>
    </div>
  </div>
  <div class="card" style="border-left:4px solid var(--success)">
    <h3>Web Fetch</h3>
    <label style="font-size:13px;display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="tc-fetch-enabled" ${fetch_.enabled !== false ? 'checked' : ''}> 启用网页抓取
    </label>
  </div>
  <div style="text-align:right;margin-top:8px">
    <button class="btn btn-primary" id="tc-save">保存 Tools 配置</button>
  </div>`;

  container.innerHTML = html;

  document.getElementById('tc-save').addEventListener('click', async () => {
    if (!config.tools) config.tools = {};
    if (!config.tools.web) config.tools.web = {};
    config.tools.web.search = {
      enabled: document.getElementById('tc-search-enabled').checked,
      apiKey: document.getElementById('tc-search-key').value.trim(),
    };
    config.tools.web.fetch = {
      enabled: document.getElementById('tc-fetch-enabled').checked,
    };
    const res = await window.api.config.write(config);
    if (res.ok) toast('Tools 配置已保存，需重启网关生效');
    else toast('保存失败: ' + res.error, 'error');
  });
}
