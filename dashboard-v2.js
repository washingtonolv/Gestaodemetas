import { supabase, getSessionProfile, roleLabel } from './supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || '--';
const monthLabel = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());

function parseBrazilianMoney(value) {
  let raw = String(value ?? '').trim().replace(/\s/g, '').replace(/R\$/gi, '');
  if (!raw) return NaN;
  raw = raw.replace(/[^0-9,.-]/g, '');
  if (raw.includes(',')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else {
    const dots = (raw.match(/\./g) || []).length;
    if (dots > 1 || (dots === 1 && !/^\d+\.\d{1,2}$/.test(raw))) raw = raw.replace(/\./g, '');
  }
  return Number(raw);
}

function formatBrazilianMoneyInput(value) {
  const parsed = parseBrazilianMoney(value);
  if (!Number.isFinite(parsed)) return String(value ?? '');
  return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setupMoneyField(selector) {
  const field = $(selector);
  if (!field) return;
  field.type = 'text';
  field.inputMode = 'decimal';
  field.autocomplete = 'off';
  field.addEventListener('blur', () => {
    if (field.value.trim()) field.value = formatBrazilianMoneyInput(field.value);
  });
}

let profile = null;
let stores = [];
let performance = [];
let latestCompetence = null;

function setFatal(message) {
  const box = $('#fatal');
  box.style.display = 'block';
  box.textContent = message;
}

function clearFatal() {
  const box = $('#fatal');
  box.style.display = 'none';
  box.textContent = '';
}

function hideLoading() {
  $('#loading').style.display = 'none';
}

function showMsg(selector, error, success) {
  const node = $(selector);
  if (!node) return;
  node.className = `msg ${error ? 'err' : 'ok'}`;
  node.textContent = error ? (error.message || String(error)) : success;
}

function navForRole(role) {
  const common = [
    ['painel', 'Painel do mês'],
    ['lojas', 'Lojas'],
    ['ranking', 'Ranking'],
    ['ano', 'Ano 2026']
  ];
  if (role === 'administrador') {
    return [
      ['painel', 'Painel do mês'],
      ['lancar', 'Lançar vendas'],
      ['metas', 'Definir metas'],
      ['lojas', 'Lojas'],
      ['ranking', 'Ranking'],
      ['ano', 'Ano 2026'],
      ['usuarios', 'Usuários'],
      ['estrutura', 'Estrutura comercial'],
      ['config', 'Configurações']
    ];
  }
  if (role === 'supervisor') {
    return [
      ['painel', 'Painel do mês'],
      ['lancar', 'Lançar vendas'],
      ['metas', 'Definir metas'],
      ['lojas', 'Lojas'],
      ['ranking', 'Ranking'],
      ['ano', 'Ano 2026']
    ];
  }
  return common;
}

function buildNavigation() {
  const items = navForRole(profile.role);
  $('#nav').innerHTML = items.map(([id, label], index) => `
    <button type="button" data-view="${id}" class="${index === 0 ? 'active' : ''}">
      <span class="dot"></span>${esc(label)}
    </button>`).join('');

  $$('#nav button').forEach((button) => {
    button.addEventListener('click', () => openView(button.dataset.view, button.textContent.trim()));
  });
}

async function openView(id, label) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === id));
  $$('#nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === id));
  $('#pageTitle').textContent = label;
  $('#crumb').textContent = label;

  if (id === 'usuarios') await loadUsers();
  if (id === 'estrutura') await loadStructure();
  if (id === 'ano') await loadYear();
}

async function loadSession() {
  const context = await getSessionProfile();
  if (!context.session || !context.profile?.ativo || context.profile.role === 'pendente') {
    window.location.replace('./login.html');
    return false;
  }
  profile = context.profile;
  $('#who').textContent = profile.nome || profile.email;
  $('#role').textContent = roleLabel(profile.role);
  $('#avatar').textContent = initials(profile.nome);
  $('#sessionInfo').innerHTML = `
    <div class="user-row">
      <div class="user-avatar">${initials(profile.nome)}</div>
      <div class="meta"><b>${esc(profile.nome)}</b><span>${esc(profile.email)}</span></div>
      <span class="badge">${esc(roleLabel(profile.role))}</span>
    </div>
    <div style="font-size:12px;color:#5A6664">Acesso ativo: <b>${profile.ativo ? 'Sim' : 'Não'}</b></div>`;
  return true;
}

async function loadBase() {
  clearFatal();
  const { data: storeRows, error: storeError } = await supabase
    .from('lojas')
    .select('id,codigo,nome,ativa')
    .eq('ativa', true)
    .order('nome');
  if (storeError) throw storeError;
  stores = storeRows || [];

  const { data: competenceRows, error: competenceError } = await supabase
    .from('metas')
    .select('competencia')
    .order('competencia', { ascending: false })
    .limit(1);
  if (competenceError) throw competenceError;

  latestCompetence = competenceRows?.[0]?.competencia || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const start = latestCompetence;
  const startDate = new Date(`${start}T12:00:00`);
  const end = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [goalResponse, resultResponse] = await Promise.all([
    supabase.from('metas').select('loja_id,valor_meta').eq('competencia', start),
    supabase.from('resultados').select('loja_id,valor_realizado').gte('data', start).lte('data', end)
  ]);
  if (goalResponse.error) throw goalResponse.error;
  if (resultResponse.error) throw resultResponse.error;

  const goals = new Map((goalResponse.data || []).map((row) => [row.loja_id, Number(row.valor_meta)]));
  const realized = new Map();
  (resultResponse.data || []).forEach((row) => {
    realized.set(row.loja_id, (realized.get(row.loja_id) || 0) + Number(row.valor_realizado));
  });

  performance = stores
    .map((store) => ({
      ...store,
      meta: goals.get(store.id) || 0,
      real: realized.get(store.id) || 0
    }))
    .map((store) => ({ ...store, pct: store.meta ? store.real / store.meta : 0 }))
    .sort((a, b) => b.pct - a.pct);

  renderDashboard();
  renderStores();
  renderRanking();
  fillStoreSelects();
}

function renderDashboard() {
  const totalMeta = performance.reduce((sum, item) => sum + item.meta, 0);
  const totalReal = performance.reduce((sum, item) => sum + item.real, 0);
  const pct = totalMeta ? totalReal / totalMeta : 0;

  $('#kpiMeta').textContent = money(totalMeta);
  $('#kpiReal').textContent = money(totalReal);
  $('#kpiPct').textContent = `${(pct * 100).toFixed(1).replace('.', ',')}%`;
  $('#kpiLojas').textContent = String(stores.length);
  $('#competenciaBadge').textContent = monthLabel(latestCompetence);

  $('#storePerf').innerHTML = performance.length ? performance.map((item) => `
    <tr>
      <td><b>${esc(item.nome)}</b><div style="font-size:10px;color:#8D9997">${esc(item.codigo || '')}</div></td>
      <td class="mono">${money(item.meta)}</td>
      <td class="mono">${money(item.real)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:9px">
          <div class="progress" style="flex:1"><span style="width:${Math.min(item.pct * 100, 100)}%"></span></div>
          <b class="mono" style="font-size:11px">${(item.pct * 100).toFixed(1)}%</b>
        </div>
      </td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty">Nenhuma loja vinculada ao seu perfil.</td></tr>';

  const low = [...performance].sort((a, b) => a.pct - b.pct).slice(0, 3);
  $('#alerts').innerHTML = low.length ? low.map((item) => `
    <div style="padding:13px 14px;border-radius:14px;background:${item.pct < 0.7 ? '#FDF1F3' : '#F1F8F7'}">
      <b style="font-size:12px">${esc(item.nome)} · ${(item.pct * 100).toFixed(1)}%</b>
      <div style="font-size:11px;line-height:1.55;color:#5A6664;margin-top:5px">${money(Math.max(item.meta - item.real, 0))} para atingir a Meta 1.</div>
    </div>`).join('') : '<div class="empty">Sem alertas.</div>';

  if (!stores.length) {
    $('#accessNotice').style.display = 'block';
    $('#accessNotice').textContent = 'Seu usuário está ativo, mas ainda não possui lojas vinculadas.';
  } else {
    $('#accessNotice').style.display = 'none';
  }
}

function renderStores() {
  $('#storeCount').textContent = `${stores.length} lojas`;
  $('#storesBody').innerHTML = stores.length ? stores.map((store) => `
    <tr><td class="mono">${esc(store.codigo || '—')}</td><td><b>${esc(store.nome)}</b></td><td><span class="badge">Ativa</span></td></tr>`).join('') : '<tr><td colspan="3" class="empty">Nenhuma loja disponível.</td></tr>';
}

function renderRanking() {
  $('#rankingBody').innerHTML = performance.length ? performance.map((item, index) => `
    <tr>
      <td class="mono">${index + 1}</td>
      <td><b>${esc(item.nome)}</b></td>
      <td><b style="color:${item.pct >= 1 ? '#05918C' : item.pct >= .8 ? '#5A6664' : '#CD4664'}">${(item.pct * 100).toFixed(1)}%</b></td>
      <td class="mono">${money(item.real)}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty">Sem dados.</td></tr>';
}

function fillStoreSelects() {
  const options = '<option value="">Selecione a loja</option>' + stores.map((store) => `<option value="${store.id}">${esc(store.codigo ? `${store.codigo} — ` : '')}${esc(store.nome)}</option>`).join('');
  ['#salesStore', '#goalStore', '#storeSelect'].forEach((id) => {
    const element = $(id);
    if (element) element.innerHTML = options;
  });
  if ($('#goalMonth')) $('#goalMonth').value = latestCompetence.slice(0, 7);
  if ($('#salesDate')) $('#salesDate').value = new Date().toISOString().slice(0, 10);
}

async function loadUsers() {
  if (profile.role !== 'administrador') return;
  const { data, error } = await supabase.from('profiles').select('id,nome,email,role,ativo').order('nome');
  if (error) throw error;
  $('#usersList').innerHTML = (data || []).map((user) => `
    <div class="user-row">
      <div class="user-avatar">${initials(user.nome)}</div>
      <div class="meta"><b>${esc(user.nome)}</b><span>${esc(user.email)}</span></div>
      <span class="badge">${esc(roleLabel(user.role))}</span>
    </div>`).join('') || '<div class="empty">Nenhum usuário.</div>';
}

async function loadStructure() {
  if (profile.role !== 'administrador') return;
  const [usersResponse, storesResponse, managerLinksResponse, storeLinksResponse] = await Promise.all([
    supabase.from('profiles').select('id,nome,role,ativo').eq('ativo', true).order('nome'),
    supabase.from('lojas').select('id,codigo,nome').eq('ativa', true).order('nome'),
    supabase.from('gerente_supervisores').select('gerente_id,supervisor_id'),
    supabase.from('supervisor_lojas').select('supervisor_id,loja_id')
  ]);
  const error = usersResponse.error || storesResponse.error || managerLinksResponse.error || storeLinksResponse.error;
  if (error) throw error;

  const users = usersResponse.data || [];
  const allStores = storesResponse.data || [];
  const managers = users.filter((user) => user.role === 'gerente_comercial');
  const supervisors = users.filter((user) => user.role === 'supervisor');
  const options = (items) => '<option value="">Selecione</option>' + items.map((item) => `<option value="${item.id}">${esc(item.nome)}</option>`).join('');

  $('#managerSelect').innerHTML = options(managers);
  $('#supervisorSelect').innerHTML = options(supervisors);
  $('#supervisorStoreSelect').innerHTML = options(supervisors);
  $('#storeSelect').innerHTML = '<option value="">Selecione a loja</option>' + allStores.map((store) => `<option value="${store.id}">${esc(store.codigo ? `${store.codigo} — ` : '')}${esc(store.nome)}</option>`).join('');

  const userNames = new Map(users.map((user) => [user.id, user.nome]));
  const storeNames = new Map(allStores.map((store) => [store.id, store.nome]));
  let html = '';
  (managerLinksResponse.data || []).forEach((link) => {
    html += `<div class="user-row"><div class="meta"><b>${esc(userNames.get(link.gerente_id) || 'Gerente')}</b><span>Gerencia ${esc(userNames.get(link.supervisor_id) || 'Supervisor')}</span></div></div>`;
  });
  (storeLinksResponse.data || []).forEach((link) => {
    html += `<div class="user-row"><div class="meta"><b>${esc(userNames.get(link.supervisor_id) || 'Supervisor')}</b><span>${esc(storeNames.get(link.loja_id) || 'Loja')}</span></div></div>`;
  });
  $('#structureSummary').innerHTML = html || '<div class="empty">Ainda não há vínculos.</div>';
}

async function loadYear() {
  const [goalsResponse, resultsResponse] = await Promise.all([
    supabase.from('metas').select('competencia,valor_meta'),
    supabase.from('resultados').select('data,valor_realizado').gte('data', '2026-01-01').lte('data', '2026-12-31')
  ]);
  if (goalsResponse.error || resultsResponse.error) throw (goalsResponse.error || resultsResponse.error);

  const months = new Map();
  (goalsResponse.data || []).forEach((row) => {
    const key = row.competencia.slice(0, 7);
    const item = months.get(key) || { meta: 0, real: 0 };
    item.meta += Number(row.valor_meta);
    months.set(key, item);
  });
  (resultsResponse.data || []).forEach((row) => {
    const key = row.data.slice(0, 7);
    const item = months.get(key) || { meta: 0, real: 0 };
    item.real += Number(row.valor_realizado);
    months.set(key, item);
  });

  $('#yearGrid').innerHTML = Array.from(months.entries()).sort().map(([key, item]) => `
    <div class="month-card">
      <b>${monthLabel(`${key}-01`)}</b>
      <strong>${item.meta ? (item.real / item.meta * 100).toFixed(1) : '0.0'}%</strong>
      <div style="font-size:10.5px;color:#5A6664;margin-top:6px">${money(item.real)} / ${money(item.meta)}</div>
    </div>`).join('') || '<div class="empty">Sem dados em 2026.</div>';
}

setupMoneyField('#salesValue');
setupMoneyField('#goalValue');

$('#logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('./login.html');
});

$('#salesForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const valorRealizado = parseBrazilianMoney($('#salesValue').value);
  if (!Number.isFinite(valorRealizado) || valorRealizado < 0) {
    showMsg('#salesMsg', new Error('Informe um valor válido. Ex.: 8.212,14'), '');
    return;
  }
  const payload = {
    loja_id: $('#salesStore').value,
    data: $('#salesDate').value,
    valor_realizado: valorRealizado,
    criado_por: profile.id
  };
  const { error } = await supabase.from('resultados').upsert(payload, { onConflict: 'loja_id,data' });
  showMsg('#salesMsg', error, error ? '' : `Venda de ${money(valorRealizado)} salva com sucesso.`);
  if (!error) {
    $('#salesValue').value = formatBrazilianMoneyInput(valorRealizado);
    await loadBase();
  }
});

$('#goalForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const valorMeta = parseBrazilianMoney($('#goalValue').value);
  if (!Number.isFinite(valorMeta) || valorMeta < 0) {
    showMsg('#goalMsg', new Error('Informe uma meta válida. Ex.: 150.000,00'), '');
    return;
  }
  const payload = {
    loja_id: $('#goalStore').value,
    competencia: `${$('#goalMonth').value}-01`,
    valor_meta: valorMeta,
    criado_por: profile.id
  };
  const { error } = await supabase.from('metas').upsert(payload, { onConflict: 'loja_id,competencia' });
  showMsg('#goalMsg', error, error ? '' : `Meta de ${money(valorMeta)} salva com sucesso.`);
  if (!error) {
    $('#goalValue').value = formatBrazilianMoneyInput(valorMeta);
    await loadBase();
  }
});

$('#userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    nome: $('#uNome').value.trim(),
    email: $('#uEmail').value.trim(),
    password: $('#uSenha').value,
    role: $('#uRole').value
  };
  const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload });
  const failure = error || data?.error;
  showMsg('#userMsg', failure ? new Error(error?.message || data?.error || 'Falha ao cadastrar usuário') : null, 'Usuário cadastrado com sucesso.');
  if (!failure) {
    event.target.reset();
    await loadUsers();
    await loadStructure();
  }
});

$('#storeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const { error } = await supabase.from('lojas').insert({
    codigo: $('#storeCode').value.trim() || null,
    nome: $('#storeName').value.trim()
  });
  showMsg('#structureMsg', error, 'Loja cadastrada.');
  if (!error) {
    event.target.reset();
    await loadBase();
    await loadStructure();
  }
});

$('#gsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const { error } = await supabase.from('gerente_supervisores').upsert({
    gerente_id: $('#managerSelect').value,
    supervisor_id: $('#supervisorSelect').value
  });
  showMsg('#structureMsg', error, 'Vínculo Gerente → Supervisor salvo.');
  if (!error) await loadStructure();
});

$('#slForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const { error } = await supabase.from('supervisor_lojas').upsert({
    supervisor_id: $('#supervisorStoreSelect').value,
    loja_id: $('#storeSelect').value
  });
  showMsg('#structureMsg', error, 'Vínculo Supervisor → Loja salvo.');
  if (!error) await loadStructure();
});

window.addEventListener('unhandledrejection', (event) => {
  setFatal(`Erro inesperado: ${event.reason?.message || event.reason || 'falha desconhecida'}`);
  hideLoading();
});

window.addEventListener('error', (event) => {
  setFatal(`Erro no dashboard: ${event.message || 'falha desconhecida'}`);
  hideLoading();
});

try {
  const ok = await loadSession();
  if (ok) {
    buildNavigation();
    await loadBase();
    if (profile.role === 'administrador') {
      await loadUsers();
      await loadStructure();
    }
  }
} catch (error) {
  console.error(error);
  setFatal(`Não foi possível carregar o dashboard: ${error.message || error}`);
} finally {
  hideLoading();
}
