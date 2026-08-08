import { supabase, getSessionProfile, roleLabel } from './supabase-client.js';

const frame = document.querySelector('#panel');
const loading = document.querySelector('#loading');
const status = document.querySelector('#status');
const originalSet = Storage.prototype.setItem;
const PT_MONTHS = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
const ROLE_ALLOWED = {
  administrador: ['Painel do mês','Lançar vendas','Definir metas','Lojas','Ranking','Ano 2026','Configurações'],
  supervisor: ['Painel do mês','Lançar vendas','Definir metas','Lojas','Ranking','Ano 2026','Configurações'],
  gerente_comercial: ['Painel do mês','Lojas','Ranking','Ano 2026']
};

let profile = null;
let stores = [];
let storeIds = {};
let goals = [];
let results = [];
let dailyTotals = new Map();
let selectedMonth = localStorage.getItem('metasdd.competencia') || '';
let currentPage = sessionStorage.getItem('metasdd.page') || 'Painel do mês';
let realtimeTimer = null;
let applyingRemote = false;
let syncQueue = Promise.resolve();

const pad = n => String(n).padStart(2,'0');
const isoLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const monthKey = d => String(d).slice(0,7);
const monthStart = key => `${key}-01`;
const monthEnd = key => { const [y,m] = key.split('-').map(Number); return `${y}-${pad(m)}-${pad(new Date(y,m,0).getDate())}`; };
const nextMonth = key => { const [y,m] = key.split('-').map(Number); const d = new Date(y,m,1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
const prevMonth = key => { const [y,m] = key.split('-').map(Number); const d = new Date(y,m-2,1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
const monthLabel = key => { const [y,m] = key.split('-').map(Number); return `${PT_MONTHS[m-1]} ${y}`; };
const initials = n => String(n||'').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase() || '--';
const money = n => Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const timeout = (p, ms, msg) => Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error(msg)),ms))]);

function showStatus(text, ms=2200, kind='ok') { if (!status) return; status.textContent = text; status.dataset.kind = kind; status.classList.add('on'); clearTimeout(showStatus._t); showStatus._t = setTimeout(()=>status.classList.remove('on'), ms); }
function fail(msg) { loading.classList.remove('hide'); loading.innerHTML = `<div class="error"><b>Não foi possível abrir o painel.</b><div style="margin-top:8px;font-weight:500">${String(msg)}</div><div style="margin-top:12px"><a href="./login.html">Voltar ao login</a></div></div>`; }
function parseBR(value) { let s = String(value ?? '').trim().replace(/\s/g,'').replace(/R\$/gi,''); if (!s) return NaN; s = s.replace(/[^0-9,.-]/g,''); if (s.includes(',')) s = s.replace(/\./g,'').replace(',','.'); else { const dots=(s.match(/\./g)||[]).length; if (dots>1 || (dots===1 && !/^\d+\.\d{1,2}$/.test(s))) s=s.replace(/\./g,''); } return Number(s); }
function normalizeCode(code) { return String(code ?? '').trim(); }
function findText(root, exact) { return [...root.querySelectorAll('div,span,h1,h2,h3')].find(el => (el.textContent||'').trim() === exact); }
function setTextOccurrences(doc, from, to) { const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode); for(const n of nodes) if(n.nodeValue && n.nodeValue.includes(from)) n.nodeValue=n.nodeValue.split(from).join(to); }

async function resolveDefaultMonth() { if (selectedMonth) return selectedMonth; const now = isoLocal().slice(0,7); const { data, error } = await supabase.from('metas').select('competencia').order('competencia',{ascending:false}).limit(1); if (error) throw error; const latest = data?.[0]?.competencia?.slice(0,7); selectedMonth = latest && latest > now ? now : (latest || now); localStorage.setItem('metasdd.competencia', selectedMonth); return selectedMonth; }

async function fetchData() {
  await resolveDefaultMonth();
  const start = monthStart(selectedMonth), end = monthEnd(selectedMonth), next = monthStart(nextMonth(selectedMonth));
  const year = selectedMonth.slice(0,4);
  const [storesR, goalsR, resultsR, nextGoalsR, annualGoalsR, annualResultsR] = await timeout(Promise.all([
    supabase.from('lojas').select('id,codigo,nome,ativa').eq('ativa',true).order('nome'),
    supabase.from('metas').select('loja_id,valor_meta,competencia').eq('competencia',start),
    supabase.from('resultados').select('loja_id,valor_realizado,data,created_at,criado_por').gte('data',start).lte('data',end).order('data'),
    supabase.from('metas').select('loja_id,valor_meta,competencia').eq('competencia',next),
    supabase.from('metas').select('loja_id,valor_meta,competencia').gte('competencia',`${year}-01-01`).lte('competencia',`${year}-12-01`),
    supabase.from('resultados').select('loja_id,valor_realizado,data').gte('data',`${year}-01-01`).lte('data',`${year}-12-31`)
  ]), 15000, 'O Supabase demorou demais para responder.');
  const err = storesR.error || goalsR.error || resultsR.error || nextGoalsR.error || annualGoalsR.error || annualResultsR.error;
  if (err) throw err;
  stores = storesR.data || []; goals = goalsR.data || []; results = resultsR.data || [];
  storeIds = Object.fromEntries(stores.map(s => [normalizeCode(s.codigo || s.id), s.id]));
  const goalsMap = new Map(goals.map(r=>[r.loja_id,Number(r.valor_meta)]));
  const nextMap = new Map((nextGoalsR.data||[]).map(r=>[r.loja_id,Number(r.valor_meta)]));
  const today = isoLocal(); const isCurrent = selectedMonth === today.slice(0,7); const baseReal = new Map(), todayReal = new Map();
  dailyTotals = new Map();
  for(const r of results) { const v=Number(r.valor_realizado||0); dailyTotals.set(r.data,(dailyTotals.get(r.data)||0)+v); const target = isCurrent && r.data === today ? todayReal : baseReal; target.set(r.loja_id,(target.get(r.loja_id)||0)+v); }
  const dados = { lojas: stores.map(s=>({nome:s.nome,cod:normalizeCode(s.codigo || s.id),meta:goalsMap.get(s.id)||0,real:baseReal.get(s.id)||0,ticket:130,_id:s.id})), vendedoras: readLocalArray('metasdd.vendedoras'), gerentes: [], vendasHoje: {}, metasProx: {}, mesFechado:false };
  if(isCurrent) { for(const s of stores) { const v=todayReal.get(s.id)||0; if(v>0) dados.vendasHoje[normalizeCode(s.codigo||s.id)]={valor:v,em:Date.now()}; } }
  for(const s of stores) if(nextMap.has(s.id)) dados.metasProx[normalizeCode(s.codigo||s.id)]=nextMap.get(s.id);
  applyingRemote = true; originalSet.call(localStorage,'metasdd.v1',JSON.stringify(dados)); applyingRemote = false;
  window.__annual = buildAnnual(annualGoalsR.data||[],annualResultsR.data||[]);
  return dados;
}
function readLocalArray(key){try{const x=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(x)?x:[]}catch{return[]}}
function buildAnnual(gs,rs){ const map=new Map(); for(const g of gs){const k=monthKey(g.competencia),x=map.get(k)||{meta:0,real:0};x.meta+=Number(g.valor_meta||0);map.set(k,x)} for(const r of rs){const k=monthKey(r.data),x=map.get(k)||{meta:0,real:0};x.real+=Number(r.valor_realizado||0);map.set(k,x)} return [...map.entries()].sort().map(([key,v])=>({key,...v})); }

async function saveSalesFromUI(doc) {
  if(profile.role==='gerente_comercial') return;
  const screen=doc.querySelector('[data-screen-label="Lançar vendas"]'); if(!screen) return;
  const rows=[...screen.querySelectorAll('input')], payload=[];
  rows.forEach((input,i)=>{ const v=parseBR(input.value), s=stores[i]; if(s && Number.isFinite(v) && v>=0) payload.push({loja_id:s.id,data:selectedMonth===isoLocal().slice(0,7)?isoLocal():monthEnd(selectedMonth),valor_realizado:v,criado_por:profile.id}); });
  if(!payload.length){showStatus('Nenhum valor para salvar',2800,'warn');return}
  const {error}=await supabase.from('resultados').upsert(payload,{onConflict:'loja_id,data'}); if(error) throw error;
  showStatus('Lançamentos salvos no Supabase'); await refreshFrame('Lançar vendas');
}

async function publishGoalsFromUI(doc) {
  if(profile.role==='gerente_comercial') return;
  const screen=doc.querySelector('[data-screen-label="Definir metas"]'); if(!screen) return;
  const inputs=[...screen.querySelectorAll('input')], next=monthStart(nextMonth(selectedMonth)), payload=[];
  inputs.slice(0,stores.length).forEach((input,i)=>{ const v=parseBR(input.value), s=stores[i]; if(s && Number.isFinite(v) && v>=0) payload.push({loja_id:s.id,competencia:next,valor_meta:v,criado_por:profile.id}); });
  if(!payload.length){showStatus('Nenhuma meta para publicar',2800,'warn');return}
  const {error}=await supabase.from('metas').upsert(payload,{onConflict:'loja_id,competencia'}); if(error) throw error;
  showStatus(`Metas de ${monthLabel(next.slice(0,7))} publicadas`); await refreshFrame('Definir metas');
}

async function fillGoalInputs(doc, mode) {
  const screen=doc.querySelector('[data-screen-label="Definir metas"]'); if(!screen)return;
  const inputs=[...screen.querySelectorAll('input')].slice(0,stores.length); let values=[];
  if(mode==='copy') { const gm=new Map(goals.map(g=>[g.loja_id,Number(g.valor_meta)])); values=stores.map(s=>gm.get(s.id)||0); }
  else { const p1=prevMonth(selectedMonth),p2=prevMonth(p1),p3=prevMonth(p2); const from=monthStart(p3),to=monthEnd(selectedMonth); const {data,error}=await supabase.from('resultados').select('loja_id,valor_realizado,data').gte('data',from).lte('data',to); if(error)throw error; const totals=new Map(); for(const r of data||[]){const k=`${r.loja_id}|${monthKey(r.data)}`,x=totals.get(k)||0;totals.set(k,x+Number(r.valor_realizado||0))} values=stores.map(s=>{ const vals=[p1,p2,p3].map(m=>totals.get(`${s.id}|${m}`)||0).filter(v=>v>0); const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0; return Math.round((avg*1.06)/1000)*1000; }); }
  inputs.forEach((input,i)=>{ input.value=String(Math.round(values[i]||0)); input.dispatchEvent(new Event('change',{bubbles:true})); });
  showStatus(mode==='copy'?'Metas copiadas':'Sugestões preenchidas');
}

async function addUnknownStores(raw) {
  if(profile.role!=='administrador') return;
  let d;try{d=JSON.parse(raw)}catch{return}
  const known=new Set(Object.keys(storeIds)), unknown=(d.lojas||[]).filter(l=>!known.has(normalizeCode(l.cod)));
  for(const l of unknown){ const {data,error}=await supabase.from('lojas').insert({codigo:normalizeCode(l.cod)||null,nome:String(l.nome||'').trim(),ativa:true}).select('id,codigo,nome').single(); if(error) throw error; storeIds[normalizeCode(data.codigo||data.id)]=data.id; if(Number(l.meta||0)>0){ const {error:ge}=await supabase.from('metas').upsert({loja_id:data.id,competencia:monthStart(selectedMonth),valor_meta:Number(l.meta),criado_por:profile.id},{onConflict:'loja_id,competencia'}); if(ge)throw ge; } }
}
async function syncLocalStorage(raw) { if(applyingRemote || !profile || profile.role==='gerente_comercial') return; await addUnknownStores(raw); let d;try{d=JSON.parse(raw)}catch{return} if(Array.isArray(d.vendedoras)) localStorage.setItem('metasdd.vendedoras',JSON.stringify(d.vendedoras)); }

function wireFrame(doc) {
  if(!doc?.body)return; personalize(doc); patchMainChart(doc); restorePage(doc);
  doc.addEventListener('click', async ev=>{
    const el=ev.target.closest('div,span'); if(!el)return; const text=(el.textContent||'').trim();
    const navLabels=['Painel do mês','Lançar vendas','Definir metas','Lojas','Ranking','Ano 2026','Configurações'];
    if(navLabels.includes(text)) {currentPage=text;sessionStorage.setItem('metasdd.page',text);setTimeout(()=>{personalize(doc);patchMainChart(doc)},80);return;}
    try{
      if(text==='Salvar lançamentos') {ev.preventDefault();ev.stopImmediatePropagation();await saveSalesFromUI(doc);}
      else if(/^Publicar metas de /i.test(text)) {ev.preventDefault();ev.stopImmediatePropagation();await publishGoalsFromUI(doc);}
      else if(/^Copiar de /i.test(text)) {ev.preventDefault();ev.stopImmediatePropagation();await fillGoalInputs(doc,'copy');}
      else if(text==='Preencher com sugestão') {ev.preventDefault();ev.stopImmediatePropagation();await fillGoalInputs(doc,'suggest');}
      else if(/^Restaurar dados de exemplo$/i.test(text)) {ev.preventDefault();ev.stopImmediatePropagation();showStatus('Desativado: os dados oficiais estão no Supabase',3500,'warn');}
      else if(text==='Convidar') {ev.preventDefault();ev.stopImmediatePropagation();if(profile.role==='administrador')location.href='./app-v3.html#usuarios';else showStatus('Somente o Administrador cadastra usuários',3000,'warn');}
      else if(text===monthLabel(selectedMonth) || /^[A-ZÇÃÉÍÓÚ]+\s+2026$/.test(text)) {ev.preventDefault();ev.stopImmediatePropagation();await cycleMonth();}
    }catch(e){console.error(e);showStatus(e.message||'Erro ao executar ação',4000,'error')}
  }, true);
}

function personalize(doc) {
  const role=roleLabel(profile.role),ini=initials(profile.nome),label=monthLabel(selectedMonth);
  setTextOccurrences(doc,'MAIO 2026',label); setTextOccurrences(doc,'Maio 2026',label.charAt(0)+label.slice(1).toLowerCase());
  const next=nextMonth(selectedMonth), curName=PT_MONTHS[Number(selectedMonth.slice(5,7))-1].toLowerCase(), nextName=PT_MONTHS[Number(next.slice(5,7))-1].toLowerCase();
  setTextOccurrences(doc,'Metas de junho 2026',`Metas de ${nextName} ${next.slice(0,4)}`); setTextOccurrences(doc,'Copiar de maio',`Copiar de ${curName}`); setTextOccurrences(doc,'vs maio',`vs ${curName}`); setTextOccurrences(doc,'Dias úteis de junho',`Dias úteis de ${nextName}`); setTextOccurrences(doc,'Publicar metas de junho',`Publicar metas de ${nextName}`); setTextOccurrences(doc,'Fechar MAIO 2026',`Fechar ${label}`);
  [...doc.querySelectorAll('div,span')].forEach(el=>{ const t=(el.textContent||'').trim(); if(t==='Layane Andrade')el.textContent=profile.nome; else if(t==='Supervisora')el.textContent=role; else if(t==='LA'&&el.children.length===0)el.textContent=ini; if(profile.role==='gerente_comercial' && ['Lançar vendas','Definir metas','Configurações'].includes(t)) el.style.display='none'; if(profile.role!=='administrador' && ['+ Adicionar loja','Adicionar loja','Convidar'].includes(t)) el.style.display='none'; });
}

function patchMainChart(doc) {
  const title=findText(doc,'Vendas por dia'); if(!title)return; const card=title.closest('div[style*="border-radius:20px"]') || title.parentElement?.parentElement; const svg=card?.querySelector('svg'); if(!svg)return;
  const [y,m]=selectedMonth.split('-').map(Number),days=new Date(y,m,0).getDate(),today=isoLocal(),maxDay=selectedMonth===today.slice(0,7)?Number(today.slice(8,10)):days;
  const values=[];for(let d=1;d<=maxDay;d++) values.push({day:d,v:dailyTotals.get(`${selectedMonth}-${pad(d)}`)||0});
  const totalMeta=goals.reduce((a,g)=>a+Number(g.valor_meta||0),0), metaDay=totalMeta/Math.max(days,1), maxV=Math.max(metaDay,...values.map(x=>x.v),1), px=i=>(i/Math.max(values.length-1,1))*900, py=v=>200-(v/maxV)*170;
  let path='';values.forEach((p,i)=>{const x=px(i),yy=py(p.v);if(!i)path+=`M${x.toFixed(1)} ${yy.toFixed(1)}`;else{const xa=px(i-1),ya=py(values[i-1].v),cx=(xa+x)/2;path+=` C${cx.toFixed(1)} ${ya.toFixed(1)} ${cx.toFixed(1)} ${yy.toFixed(1)} ${x.toFixed(1)} ${yy.toFixed(1)}`}});
  const paths=svg.querySelectorAll('path'); if(paths[0])paths[0].setAttribute('d',`${path} L900 200 L0 200 Z`); if(paths[1])paths[1].setAttribute('d',path); const line=svg.querySelector('line'); if(line){const yy=py(metaDay).toFixed(1);line.setAttribute('y1',yy);line.setAttribute('y2',yy)} const legend=[...card.querySelectorAll('span')].find(s=>(s.textContent||'').trim().startsWith('meta R$')); if(legend)legend.textContent=`meta ${money(metaDay)}`;
}
function restorePage(doc) { if(currentPage==='Painel do mês')return; const target=[...doc.querySelectorAll('div')].find(el=>(el.textContent||'').trim()===currentPage && el.parentElement?.tagName==='NAV'); if(target) setTimeout(()=>target.click(),30); }
async function refreshFrame(page=currentPage) { currentPage=page||currentPage;sessionStorage.setItem('metasdd.page',currentPage); await fetchData(); frame.src=`./Painel%20de%20Metas%20D%26D.dc.html?v=${Date.now()}`; }
async function cycleMonth(){ const year=selectedMonth.slice(0,4); const {data,error}=await supabase.from('metas').select('competencia').gte('competencia',`${year}-01-01`).lte('competencia',`${year}-12-01`).order('competencia'); if(error)throw error; const months=[...new Set((data||[]).map(x=>x.competencia.slice(0,7)))]; const now=isoLocal().slice(0,7); if(!months.includes(now))months.push(now); months.sort(); const i=months.indexOf(selectedMonth);selectedMonth=months[(i+1+months.length)%months.length]||now; localStorage.setItem('metasdd.competencia',selectedMonth); showStatus(`Abrindo ${monthLabel(selectedMonth)}`); await refreshFrame('Painel do mês'); }
function scheduleRealtimeRefresh(){ clearTimeout(realtimeTimer); realtimeTimer=setTimeout(async()=>{try{showStatus('Atualizando dados em tempo real…',1200);await refreshFrame(currentPage)}catch(e){console.error(e)}},700); }
function subscribeRealtime(){ return supabase.channel(`metas-dd-${profile.id}`).on('postgres_changes',{event:'*',schema:'public',table:'resultados'},scheduleRealtimeRefresh).on('postgres_changes',{event:'*',schema:'public',table:'metas'},scheduleRealtimeRefresh).on('postgres_changes',{event:'*',schema:'public',table:'lojas'},scheduleRealtimeRefresh).subscribe(status=>{if(status==='SUBSCRIBED')showStatus('Tempo real conectado',1400)}); }
window.addEventListener('storage',e=>{ if(e.key==='metasdd.v1'&&e.newValue&&!applyingRemote){syncQueue=syncQueue.then(()=>syncLocalStorage(e.newValue)).catch(err=>{console.error(err);showStatus('Falha ao sincronizar alteração',3200,'error')});} });

try { const ctx=await timeout(getSessionProfile(),12000,'Não foi possível validar sua sessão.'); if(!ctx.session||!ctx.profile?.ativo||ctx.profile.role==='pendente'){location.replace('./login.html');throw new Error('Sessão inválida');} profile=ctx.profile; await fetchData(); frame.addEventListener('load',()=>{ loading.classList.add('hide'); const doc=frame.contentDocument; wireFrame(doc); setTimeout(()=>{personalize(doc);patchMainChart(doc)},350); }); frame.src=`./Painel%20de%20Metas%20D%26D.dc.html?v=${Date.now()}`; subscribeRealtime(); } catch(e) { console.error(e);fail(e.message||String(e)); }
