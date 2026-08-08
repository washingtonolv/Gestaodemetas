import { supabase, getSessionProfile, roleLabel } from './supabase-client.js';

const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const num=v=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
const pct=v=>`${(Number(v||0)*100).toFixed(1).replace('.',',')}%`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=n=>String(n||'').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'--';
const localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const monthStart=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
const monthEnd=key=>{const [y,m]=key.slice(0,7).split('-').map(Number);return `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`};
const monthLabel=key=>new Date(`${key.slice(0,7)}-01T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
const addMonths=(key,n)=>{const [y,m]=key.slice(0,7).split('-').map(Number),d=new Date(y,m-1+n,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`};
const timeout=(p,ms=12000)=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('A conexão demorou demais. Tente novamente.')),ms))]);
function parseBRL(v){let s=String(v??'').trim().replace(/\s/g,'').replace(/R\$/gi,'').replace(/[^0-9,.-]/g,'');if(!s)return NaN;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');else{const dots=(s.match(/\./g)||[]).length;if(dots>1||(dots===1&&!/^\d+\.\d{1,2}$/.test(s)))s=s.replace(/\./g,'')}return Number(s)}
function showMsg(sel,error,ok){const el=$(sel);if(!el)return;el.className=`msg ${error?'err':'ok'}`;el.textContent=error?(error.message||String(error)):ok}
function fatal(msg){const el=$('#fatal');el.style.display='block';el.textContent=msg}
function loading(on){$('#loading').style.display=on?'grid':'none'}

let profile=null, stores=[], goals=new Map(), results=new Map(), performance=[], competence=monthStart();

const navByRole={
 administrador:[['painel','Painel do mês'],['lancar','Lançar vendas'],['metas','Definir metas'],['lojas','Lojas'],['ranking','Ranking'],['ano','Ano 2026'],['usuarios','Usuários'],['estrutura','Estrutura comercial'],['config','Configurações']],
 supervisor:[['painel','Painel do mês'],['lancar','Lançar vendas'],['metas','Definir metas'],['lojas','Lojas'],['ranking','Ranking'],['ano','Ano 2026']],
 gerente_comercial:[['painel','Painel do mês'],['lojas','Lojas'],['ranking','Ranking'],['ano','Ano 2026']]
};
function buildNav(){
 const list=navByRole[profile.role]||navByRole.gerente_comercial;
 $('#nav').innerHTML=list.map(([id,label],i)=>`<button class="navbtn ${i===0?'active':''}" data-view="${id}"><span class="navdot"></span>${esc(label)}</button>`).join('');
 $$('.navbtn').forEach(b=>b.onclick=()=>openView(b.dataset.view,b.textContent.trim()));
 $$('[data-go]').forEach(b=>b.onclick=()=>openView(b.dataset.go,'Lançar vendas'));
}
async function openView(id,label){
 $$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.navbtn').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
 $('#pageTitle').textContent=label;$('#crumb').textContent=label;
 try{
   if(id==='lancar')await renderSales();
   if(id==='metas')await renderGoals();
   if(id==='ano')await renderYear();
   if(id==='usuarios')await loadUsers();
   if(id==='estrutura')await loadStructure();
 }catch(e){fatal(`Erro em ${label}: ${e.message||e}`)}
}
async function loadSession(){
 const ctx=await timeout(getSessionProfile());
 if(!ctx.session||!ctx.profile?.ativo||ctx.profile.role==='pendente'){location.replace('./login.html');return false}
 profile=ctx.profile;$('#avatar').textContent=initials(profile.nome);$('#who').textContent=profile.nome||profile.email;$('#role').textContent=roleLabel(profile.role);
 $('#sessionInfo').innerHTML=`<div class="userrow"><div class="useravatar">${initials(profile.nome)}</div><div class="usermeta"><b>${esc(profile.nome)}</b><span>${esc(profile.email)}</span></div><span class="badge">${esc(roleLabel(profile.role))}</span></div>`;
 return true
}
function fillMonthSelect(){
 const now=monthStart(), opts=[];for(let i=-5;i<=3;i++){const k=addMonths(now,i);opts.push(`<option value="${k}" ${k===competence?'selected':''}>${monthLabel(k)}</option>`)}
 $('#monthSelect').innerHTML=opts.join('');
}
async function loadBase(){
 const [sR,gR,rR]=await timeout(Promise.all([
   supabase.from('lojas').select('id,codigo,nome,ativa').eq('ativa',true).order('nome'),
   supabase.from('metas').select('loja_id,competencia,valor_meta').eq('competencia',competence),
   supabase.from('resultados').select('loja_id,data,valor_realizado').gte('data',competence).lte('data',monthEnd(competence))
 ]));
 const error=sR.error||gR.error||rR.error;if(error)throw error;
 stores=sR.data||[];goals=new Map((gR.data||[]).map(x=>[x.loja_id,Number(x.valor_meta)]));results=new Map();
 (rR.data||[]).forEach(x=>results.set(x.loja_id,(results.get(x.loja_id)||0)+Number(x.valor_realizado)));
 performance=stores.map(s=>({...s,meta:goals.get(s.id)||0,real:results.get(s.id)||0})).map(s=>({...s,pct:s.meta?s.real/s.meta:0})).sort((a,b)=>b.pct-a.pct);
 renderPanel();renderStores();renderRanking();fillMonthSelect()
}
function renderPanel(){
 const tm=performance.reduce((a,x)=>a+x.meta,0),tr=performance.reduce((a,x)=>a+x.real,0),p=tm?tr/tm:0,missing=performance.filter(x=>!x.meta).length;
 $('#kpiPct').textContent=pct(p);$('#kpiReal').textContent=money(tr);$('#kpiMeta').textContent=money(tm);$('#kpiLojas').textContent=String(stores.length);$('#competenciaBadge').textContent=monthLabel(competence);
 $('#paceText').textContent=missing?`${missing} loja${missing>1?'s':''} sem meta cadastrada`:'Todas as lojas com meta';
 $('#accessNotice').style.display=stores.length?'none':'block';$('#accessNotice').textContent='Seu usuário está ativo, mas ainda não possui lojas vinculadas.';
 $('#storePerf').innerHTML=performance.length?performance.map(x=>`<tr><td><b>${esc(x.nome)}</b><div style="font-size:10px;color:#8D9997">${esc(x.codigo||'')}</div></td><td class="mono">${money(x.meta)}</td><td class="mono">${money(x.real)}</td><td><div style="display:flex;align-items:center;gap:9px"><div class="progress" style="flex:1"><span style="width:${Math.min(x.pct*100,100)}%;background:${x.pct>=1?'#05918C':x.pct>=.8?'#E890A2':'#CD4664'}"></span></div><b class="mono">${pct(x.pct)}</b></div></td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nenhuma loja disponível.</td></tr>';
 const alerts=[...performance].sort((a,b)=>(a.meta?a.pct:-1)-(b.meta?b.pct:-1)).slice(0,4);
 $('#alerts').innerHTML=alerts.length?alerts.map(x=>`<div class="alert"><b>${esc(x.nome)} · ${x.meta?pct(x.pct):'sem meta'}</b><div>${x.meta?`${money(Math.max(x.meta-x.real,0))} para atingir a Meta 1.`:'Cadastre a meta desta loja para o mês.'}</div></div>`).join(''):'<div class="empty">Sem alertas.</div>'
}
function situation(x){if(!x.meta)return['Sem meta','crit'];if(x.pct>=1)return['No ritmo',''];if(x.pct>=.8)return['Atenção','warn'];return['Crítico','crit']}
function renderStores(){
 $('#storeCount').textContent=`${stores.length} lojas`;
 $('#storeCards').innerHTML=performance.length?performance.map(x=>{const [st,cl]=situation(x);return `<div class="storecard"><div class="storetop"><div><small>${esc(x.codigo||'—')}</small><h3>${esc(x.nome)}</h3></div><span class="status ${cl}">${st}</span></div><div class="storevalue">${money(x.real)} <span style="float:right;color:${x.pct>=1?'#05918C':'#CD4664'}">${x.meta?pct(x.pct):'—'}</span></div><div class="progress" style="margin-top:10px"><span style="width:${Math.min(x.pct*100,100)}%;background:${x.pct>=1?'#05918C':x.pct>=.8?'#E890A2':'#CD4664'}"></span></div><div class="storefoot"><span>Meta ${money(x.meta)}</span><span>Falta ${money(Math.max(x.meta-x.real,0))}</span></div></div>`}).join(''):'<div class="empty">Nenhuma loja.</div>'
}
function renderRanking(){
 $('#rankingBody').innerHTML=performance.length?performance.map((x,i)=>`<tr><td class="mono">${i+1}</td><td><b>${esc(x.nome)}</b></td><td><b style="color:${x.pct>=1?'#05918C':x.pct>=.8?'#E890A2':'#CD4664'}">${x.meta?pct(x.pct):'—'}</b></td><td class="mono">${money(x.real)}</td><td class="mono">${money(Math.max(x.meta-x.real,0))}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Sem dados.</td></tr>'
}
async function renderSales(){
 const date=$('#salesDate').value||localDate();$('#salesDate').value=date;
 const r=await timeout(supabase.from('resultados').select('loja_id,valor_realizado').eq('data',date));if(r.error)throw r.error;
 const day=new Map((r.data||[]).map(x=>[x.loja_id,Number(x.valor_realizado)]));
 const days=Math.max(1,new Date(Number(competence.slice(0,4)),Number(competence.slice(5,7)),0).getDate());
 $('#salesSubtitle').textContent=`${(r.data||[]).length} de ${stores.length} lojas já lançaram em ${new Date(date+'T12:00:00').toLocaleDateString('pt-BR')}`;
 $('#salesRows').innerHTML=stores.map(s=>{const val=day.get(s.id);return `<tr><td><b>${esc(s.nome)}</b><div style="font-size:10px;color:#8D9997">${esc(s.codigo||'')}</div></td><td class="mono money">${money((goals.get(s.id)||0)/days)}</td><td><input class="field money sale-input" inputmode="decimal" data-id="${s.id}" value="${val!=null?num(val):''}" placeholder="0,00"></td><td><span class="status ${val!=null?'':'crit'}">${val!=null?'Lançado':'Pendente'}</span></td></tr>`}).join('');
}
async function saveSales(){
 const date=$('#salesDate').value;if(!date)return showMsg('#salesMsg',new Error('Informe a data.'),'');
 const rows=$$('.sale-input').filter(i=>i.value.trim()).map(i=>({loja_id:i.dataset.id,data,valor_realizado:parseBRL(i.value),criado_por:profile.id}));
 if(rows.some(x=>!Number.isFinite(x.valor_realizado)||x.valor_realizado<0))return showMsg('#salesMsg',new Error('Existe um valor inválido. Use, por exemplo, 8.212,14.'),'');
 if(!rows.length)return showMsg('#salesMsg',new Error('Informe pelo menos um lançamento.'),'');
 const {error}=await timeout(supabase.from('resultados').upsert(rows,{onConflict:'loja_id,data'}));showMsg('#salesMsg',error,error?'':`${rows.length} lançamento(s) salvo(s).`);
 if(!error){await loadBase();await renderSales()}
}
async function renderGoals(){
 const key=`${$('#goalMonth').value||addMonths(competence,1).slice(0,7)}-01`;$('#goalMonth').value=key.slice(0,7);$('#goalTitle').textContent=`Metas de ${monthLabel(key)}`;
 const r=await timeout(supabase.from('metas').select('loja_id,valor_meta').eq('competencia',key));if(r.error)throw r.error;const map=new Map((r.data||[]).map(x=>[x.loja_id,Number(x.valor_meta)]));
 const f2=parseBRL($('#factor2').value)||1.12,f3=parseBRL($('#factor3').value)||1.30;
 $('#goalRows').innerHTML=stores.map(s=>{const base=map.has(s.id)?map.get(s.id):(goals.get(s.id)||0);return `<tr><td><b>${esc(s.nome)}</b><div style="font-size:10px;color:#8D9997">${esc(s.codigo||'')}</div></td><td><input class="field money goal-input" inputmode="decimal" data-id="${s.id}" value="${base?num(base):''}" placeholder="0,00"></td><td class="mono goal-m2">${money(base*f2)}</td><td class="mono goal-m3">${money(base*f3)}</td></tr>`}).join('');
 $$('.goal-input').forEach(i=>i.addEventListener('input',updateGoalCalcs))
}
function updateGoalCalcs(){
 const f2=parseBRL($('#factor2').value)||1.12,f3=parseBRL($('#factor3').value)||1.30;
 $$('.goal-input').forEach(i=>{const n=parseBRL(i.value)||0;const tr=i.closest('tr');tr.querySelector('.goal-m2').textContent=money(n*f2);tr.querySelector('.goal-m3').textContent=money(n*f3)})
}
async function publishGoals(){
 const key=`${$('#goalMonth').value}-01`;const rows=$$('.goal-input').filter(i=>i.value.trim()).map(i=>({loja_id:i.dataset.id,competencia:key,valor_meta:parseBRL(i.value),criado_por:profile.id}));
 if(rows.some(x=>!Number.isFinite(x.valor_meta)||x.valor_meta<0))return showMsg('#goalMsg',new Error('Existe uma meta inválida.'),'');
 if(!rows.length)return showMsg('#goalMsg',new Error('Informe pelo menos uma meta.'),'');
 const {error}=await timeout(supabase.from('metas').upsert(rows,{onConflict:'loja_id,competencia'}));showMsg('#goalMsg',error,error?'':`${rows.length} meta(s) publicada(s).`);
 if(!error&&key===competence)await loadBase()
}
async function renderYear(){
 const y=new Date().getFullYear(),start=`${y}-01-01`,end=`${y}-12-31`;
 const [g,r]=await timeout(Promise.all([supabase.from('metas').select('competencia,valor_meta').gte('competencia',start).lte('competencia',`${y}-12-01`),supabase.from('resultados').select('data,valor_realizado').gte('data',start).lte('data',end)]));if(g.error||r.error)throw(g.error||r.error);
 const map=new Map();for(let m=1;m<=12;m++)map.set(`${y}-${String(m).padStart(2,'0')}`,{meta:0,real:0});
 (g.data||[]).forEach(x=>{const k=x.competencia.slice(0,7);if(map.has(k))map.get(k).meta+=Number(x.valor_meta)});(r.data||[]).forEach(x=>{const k=x.data.slice(0,7);if(map.has(k))map.get(k).real+=Number(x.valor_realizado)});
 const used=[...map.entries()].filter(([,x])=>x.meta||x.real),tm=used.reduce((a,[,x])=>a+x.meta,0),tr=used.reduce((a,[,x])=>a+x.real,0),hits=used.filter(([,x])=>x.meta&&x.real>=x.meta).length;
 $('#yearMeta').textContent=money(tm);$('#yearReal').textContent=money(tr);$('#yearHit').textContent=`${hits} de ${used.length}`;$('#yearGap').textContent=money(Math.max(tm-tr,0));
 $('#yearCards').innerHTML=used.length?used.map(([k,x])=>`<div class="yearcard"><b>${monthLabel(k+'-01')}</b><strong style="color:${x.meta&&x.real>=x.meta?'#05918C':'#CD4664'}">${x.meta?pct(x.real/x.meta):'—'}</strong><div style="font-size:10.5px;color:#5A6664;margin-top:6px">${money(x.real)} / ${money(x.meta)}</div></div>`).join(''):'<div class="empty">Sem dados no ano.</div>'
}
async function loadUsers(){
 if(profile.role!=='administrador')return;const {data,error}=await timeout(supabase.from('profiles').select('id,nome,email,role,ativo').order('nome'));if(error)throw error;
 $('#usersList').innerHTML=(data||[]).map(u=>`<div class="userrow"><div class="useravatar">${initials(u.nome)}</div><div class="usermeta"><b>${esc(u.nome)}</b><span>${esc(u.email)}</span></div><span class="badge">${esc(roleLabel(u.role))}</span></div>`).join('')||'<div class="empty">Nenhum usuário.</div>'
}
async function loadStructure(){
 if(profile.role!=='administrador')return;
 const [u,s,gs,sl]=await timeout(Promise.all([supabase.from('profiles').select('id,nome,role,ativo').eq('ativo',true).order('nome'),supabase.from('lojas').select('id,codigo,nome').eq('ativa',true).order('nome'),supabase.from('gerente_supervisores').select('gerente_id,supervisor_id'),supabase.from('supervisor_lojas').select('supervisor_id,loja_id')]));const er=u.error||s.error||gs.error||sl.error;if(er)throw er;
 const users=u.data||[], ss=s.data||[], managers=users.filter(x=>x.role==='gerente_comercial'),supers=users.filter(x=>x.role==='supervisor'),options=a=>'<option value="">Selecione</option>'+a.map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join('');
 $('#managerSelect').innerHTML=options(managers);$('#supervisorSelect').innerHTML=options(supers);$('#supervisorStoreSelect').innerHTML=options(supers);$('#storeSelect').innerHTML='<option value="">Selecione a loja</option>'+ss.map(x=>`<option value="${x.id}">${esc(x.codigo?x.codigo+' — ':'')}${esc(x.nome)}</option>`).join('');
 const un=new Map(users.map(x=>[x.id,x.nome])),sn=new Map(ss.map(x=>[x.id,x.nome]));let h='';(gs.data||[]).forEach(x=>h+=`<div class="userrow"><div class="usermeta"><b>${esc(un.get(x.gerente_id)||'Gerente')}</b><span>Gerencia ${esc(un.get(x.supervisor_id)||'Supervisor')}</span></div></div>`);(sl.data||[]).forEach(x=>h+=`<div class="userrow"><div class="usermeta"><b>${esc(un.get(x.supervisor_id)||'Supervisor')}</b><span>${esc(sn.get(x.loja_id)||'Loja')}</span></div></div>`);$('#structureSummary').innerHTML=h||'<div class="empty">Ainda não há vínculos.</div>'
}

$('#logout').onclick=async()=>{await supabase.auth.signOut();location.replace('./login.html')};
$('#monthSelect').onchange=async e=>{competence=e.target.value;loading(true);try{await loadBase()}catch(err){fatal(err.message||err)}finally{loading(false)}};
$('#salesDate').onchange=()=>renderSales().catch(e=>fatal(e.message||e));
$('#saveSales').onclick=()=>saveSales().catch(e=>showMsg('#salesMsg',e,''));
$('#goalMonth').onchange=()=>renderGoals().catch(e=>fatal(e.message||e));
$('#publishGoals').onclick=()=>publishGoals().catch(e=>showMsg('#goalMsg',e,''));
$('#factor2').oninput=updateGoalCalcs;$('#factor3').oninput=updateGoalCalcs;

$('#userForm').onsubmit=async e=>{e.preventDefault();const payload={nome:$('#uNome').value.trim(),email:$('#uEmail').value.trim(),password:$('#uSenha').value,role:$('#uRole').value};const {data,error}=await supabase.functions.invoke('admin-create-user',{body:payload});const fail=error||data?.error;showMsg('#userMsg',fail?new Error(error?.message||data?.error):null,'Usuário cadastrado com sucesso.');if(!fail){e.target.reset();await loadUsers();await loadStructure()}};
$('#storeForm').onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from('lojas').insert({codigo:$('#storeCode').value.trim()||null,nome:$('#storeName').value.trim()});showMsg('#structureMsg',error,'Loja cadastrada.');if(!error){e.target.reset();await loadBase();await loadStructure()}};
$('#gsForm').onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from('gerente_supervisores').upsert({gerente_id:$('#managerSelect').value,supervisor_id:$('#supervisorSelect').value});showMsg('#structureMsg',error,'Vínculo salvo.');if(!error)await loadStructure()};
$('#slForm').onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from('supervisor_lojas').upsert({supervisor_id:$('#supervisorStoreSelect').value,loja_id:$('#storeSelect').value});showMsg('#structureMsg',error,'Vínculo salvo.');if(!error)await loadStructure()};

window.addEventListener('unhandledrejection',e=>{console.error(e.reason);fatal(`Erro inesperado: ${e.reason?.message||e.reason||'falha desconhecida'}`);loading(false)});
window.addEventListener('error',e=>{console.error(e.error);fatal(`Erro no painel: ${e.message||'falha desconhecida'}`);loading(false)});

try{
 if(await loadSession()){buildNav();competence=monthStart();$('#salesDate').value=localDate();$('#goalMonth').value=addMonths(competence,1).slice(0,7);await loadBase();if(profile.role==='administrador'){await loadUsers();await loadStructure()}}
}catch(e){console.error(e);fatal(`Não foi possível carregar o dashboard: ${e.message||e}`)}finally{loading(false)}