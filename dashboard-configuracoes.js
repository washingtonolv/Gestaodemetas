import {supabase,getSessionProfile,roleLabel} from './supabase-client.js';

const frame=document.querySelector('#panel');
const pad=n=>String(n).padStart(2,'0');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthLabel=k=>new Date(`${k}-01T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
const dateLabel=k=>new Date(k+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const monthRange=k=>{const[y,m]=k.split('-').map(Number);return[`${k}-01`,`${k}-${pad(new Date(y,m,0).getDate())}`]};
const parseNumber=v=>Number(String(v??'').trim().replace(',','.'));
const DEFAULT_RULES={id:true,dias_semana_uteis:[1,2,3,4,5,6],fator_meta2:1.12,fator_meta3:1.30,crescimento_sugestao:1.06,arredondamento_meta:1000};
const WEEK=[{n:1,s:'Seg',l:'Segunda'},{n:2,s:'Ter',l:'Terça'},{n:3,s:'Qua',l:'Quarta'},{n:4,s:'Qui',l:'Quinta'},{n:5,s:'Sex',l:'Sexta'},{n:6,s:'Sáb',l:'Sábado'},{n:7,s:'Dom',l:'Domingo'}];
let profile=null,stores=[],rules={...DEFAULT_RULES},exceptions=[],selectedStore='',selectedDate='',month=localStorage.getItem('metasdd.competencia')||new Date().toLocaleDateString('en-CA').slice(0,7);
const canEditRules=()=>profile?.role==='administrador';
const canEditCalendar=()=>['administrador','supervisor'].includes(profile?.role);

function build(){
 if(document.querySelector('#ddConfigOverlay'))return;
 const style=document.createElement('style');
 style.textContent=`
 .ddcfg-overlay{position:fixed;inset:0;z-index:150;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(23,50,47,.46);backdrop-filter:blur(6px);font-family:Manrope,system-ui,sans-serif;color:#16211f}.ddcfg-overlay.open{display:flex}
 .ddcfg-modal{width:min(1120px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto;background:#f6faf9;border:1px solid rgba(255,255,255,.75);border-radius:26px;box-shadow:0 30px 90px rgba(18,55,51,.26)}
 .ddcfg-head{position:sticky;top:0;z-index:3;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px 24px;background:rgba(255,255,255,.96);border-bottom:1px solid #e5eeec;backdrop-filter:blur(12px)}.ddcfg-head h2{margin:0;font-size:20px}.ddcfg-head p{margin:7px 0 0;color:#72807e;font-size:11.5px;line-height:1.5}.ddcfg-close{width:38px;height:38px;border:0;border-radius:12px;background:#f1f6f5;cursor:pointer}.ddcfg-close img{width:18px}
 .ddcfg-body{padding:20px 22px 24px}.ddcfg-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.ddcfg-badge{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border-radius:999px;background:#e6f4f2;color:#08736f;font-size:10.5px;font-weight:800}.ddcfg-month{display:flex;align-items:center;gap:8px}.ddcfg-month input,.ddcfg-select,.ddcfg-input{box-sizing:border-box;border:1.5px solid #d7e5e3;border-radius:11px;background:#fff;color:#182321;padding:10px 12px;font:600 11px/1.2 inherit;outline:none}.ddcfg-month input:focus,.ddcfg-select:focus,.ddcfg-input:focus{border-color:#07958f;box-shadow:0 0 0 3px rgba(7,149,143,.1)}
 .ddcfg-grid{display:grid;grid-template-columns:minmax(290px,.78fr) minmax(430px,1.22fr);gap:16px}.ddcfg-card{background:#fff;border:1px solid #e7efed;border-radius:19px;padding:19px}.ddcfg-card h3{margin:0;font-size:14px}.ddcfg-card-sub{margin:5px 0 16px;color:#879390;font-size:10.5px;line-height:1.45}.ddcfg-field{display:grid;grid-template-columns:1fr 120px;align-items:center;gap:13px;padding:12px 0;border-bottom:1px solid #edf3f2}.ddcfg-field:last-of-type{border-bottom:0}.ddcfg-field b{display:block;font-size:11.5px}.ddcfg-field span{display:block;margin-top:3px;color:#8b9896;font-size:9.5px;line-height:1.35}.ddcfg-input{width:100%;text-align:right}.ddcfg-input:disabled{background:#f4f7f6;color:#75817f}
 .ddcfg-week{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin:12px 0 7px}.ddcfg-week input{position:absolute;opacity:0;pointer-events:none}.ddcfg-week label{display:grid;place-items:center;min-height:38px;border:1.5px solid #dbe7e5;border-radius:10px;background:#fafcfc;color:#7d8987;font-size:9.5px;font-weight:800;cursor:pointer}.ddcfg-week input:checked+label{border-color:#07958f;background:#e5f4f2;color:#08736f}.ddcfg-week input:disabled+label{cursor:default;opacity:.75}
 .ddcfg-action{width:100%;margin-top:15px;border:0;border-radius:11px;padding:11px 14px;background:#07958f;color:#fff;font:800 11px/1 inherit;cursor:pointer}.ddcfg-action:disabled{opacity:.45;cursor:not-allowed}.ddcfg-note{margin-top:11px;padding:10px 12px;border-radius:11px;background:#f1f6f5;color:#64716f;font-size:9.8px;line-height:1.5}.ddcfg-msg{min-height:15px;margin-top:8px;color:#08736f;font-size:10px}.ddcfg-msg.err{color:#b42318}
 .ddcfg-calendar-top{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}.ddcfg-select{width:100%}.ddcfg-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}.ddcfg-dow{text-align:center;padding:4px 0;color:#98a4a2;font-size:9px;font-weight:800}.ddcfg-blank{min-height:43px}.ddcfg-day{position:relative;min-height:43px;border:1px solid #e2ebe9;border-radius:10px;background:#f5f8f7;color:#9aa5a3;font:700 10.5px/1 inherit;cursor:pointer;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.ddcfg-day.open{background:#edf8f6;color:#08736f}.ddcfg-day.exception.closed{border-color:#f0b5c3;background:#fdf0f3;color:#bd3655}.ddcfg-day.exception.open{border-color:#7bc9c3;background:#dff3f0;color:#066d68}.ddcfg-day.selected{transform:translateY(-1px);border-color:#07958f;box-shadow:0 0 0 3px rgba(7,149,143,.12)}.ddcfg-day i{position:absolute;right:5px;top:5px;width:5px;height:5px;border-radius:50%;background:currentColor}
 .ddcfg-day-info{margin-top:13px;padding:13px;border-radius:13px;background:#f5f8f7}.ddcfg-day-info b{font-size:11.5px}.ddcfg-day-info p{margin:4px 0 10px;color:#7b8886;font-size:9.8px}.ddcfg-day-actions{display:grid;grid-template-columns:1fr auto;gap:8px}.ddcfg-day-actions button{border:0;border-radius:10px;padding:10px 13px;font-weight:800;font-size:10px;cursor:pointer}.ddcfg-day-primary{background:#07958f;color:#fff}.ddcfg-day-revert{background:#fcecef;color:#bd3655}
 .ddcfg-summary{grid-column:1/-1}.ddcfg-store-list{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.ddcfg-store{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e1ebe9;border-radius:12px;padding:12px;background:#fff;cursor:pointer;text-align:left}.ddcfg-store.active{border-color:#07958f;box-shadow:0 0 0 2px rgba(7,149,143,.09)}.ddcfg-store b{display:block;font-size:10.5px}.ddcfg-store span{display:block;margin-top:3px;color:#8b9896;font-size:9px}.ddcfg-store strong{font-size:18px;color:#08736f}.ddcfg-legend{display:flex;flex-wrap:wrap;gap:12px;margin:11px 0 0;color:#788583;font-size:9px}.ddcfg-legend span:before{content:'';display:inline-block;width:8px;height:8px;margin-right:5px;border-radius:3px;vertical-align:-1px;background:#edf8f6;border:1px solid #dce8e6}.ddcfg-legend .exc:before{background:#fdf0f3;border-color:#f0b5c3}.ddcfg-legend .openx:before{background:#dff3f0;border-color:#7bc9c3}
 @media(max-width:850px){.ddcfg-overlay{align-items:flex-end;padding:0}.ddcfg-modal{width:100%;max-height:94vh;border-radius:24px 24px 0 0}.ddcfg-grid{grid-template-columns:1fr}.ddcfg-summary{grid-column:auto}.ddcfg-store-list{grid-template-columns:repeat(2,1fr)}}@media(max-width:540px){.ddcfg-body{padding:15px}.ddcfg-head{padding:18px}.ddcfg-toolbar{align-items:flex-start;flex-direction:column}.ddcfg-month{width:100%}.ddcfg-month input{flex:1}.ddcfg-calendar-top{grid-template-columns:1fr}.ddcfg-store-list{grid-template-columns:1fr}.ddcfg-week{gap:3px}.ddcfg-week label{font-size:8px}.ddcfg-field{grid-template-columns:1fr 105px}}
 `;
 document.head.appendChild(style);
 document.body.insertAdjacentHTML('beforeend',`
 <div id="ddConfigOverlay" class="ddcfg-overlay" aria-hidden="true">
  <section class="ddcfg-modal" role="dialog" aria-modal="true" aria-labelledby="ddConfigTitle">
   <header class="ddcfg-head"><div><h2 id="ddConfigTitle">Calendário e regras de metas</h2><p>Defina a operação da rede e trate feriados ou aberturas diferentes em cada loja.</p></div><button class="ddcfg-close" id="ddConfigClose" type="button" aria-label="Fechar"><img src="https://cdn.jsdelivr.net/gh/untitleduico/icons@c42fbd02f365c4388ba32e9f43df0ef4851ba126/icons/x-close.svg" alt=""></button></header>
   <div class="ddcfg-body">
    <div class="ddcfg-toolbar"><span class="ddcfg-badge" id="ddConfigRole"></span><div class="ddcfg-month"><label for="ddConfigMonth" style="font-size:10px;font-weight:800;color:#74817f">Mês analisado</label><input id="ddConfigMonth" type="month"></div></div>
    <div class="ddcfg-grid">
     <section class="ddcfg-card">
      <h3>Regras da rede</h3><p class="ddcfg-card-sub">Aplicadas automaticamente aos cálculos de metas, projeções e sugestões.</p>
      <b style="font-size:11px">Dias de funcionamento padrão</b><div class="ddcfg-week" id="ddConfigWeek"></div>
      <div class="ddcfg-field"><div><b>Meta 2</b><span>Multiplicador sobre a Meta 1</span></div><input class="ddcfg-input" id="ddFactor2" inputmode="decimal"></div>
      <div class="ddcfg-field"><div><b>Meta 3</b><span>Multiplicador sobre a Meta 1</span></div><input class="ddcfg-input" id="ddFactor3" inputmode="decimal"></div>
      <div class="ddcfg-field"><div><b>Crescimento sugerido</b><span>Percentual sobre a média dos últimos 3 meses</span></div><input class="ddcfg-input" id="ddGrowth" inputmode="decimal"></div>
      <div class="ddcfg-field"><div><b>Arredondar metas para</b><span>Faixa usada na sugestão automática</span></div><input class="ddcfg-input" id="ddRounding" inputmode="numeric"></div>
      <button class="ddcfg-action" id="ddSaveRules" type="button">Salvar regras da rede</button><div class="ddcfg-msg" id="ddRulesMsg"></div>
      <div class="ddcfg-note" id="ddRulesNote"></div>
     </section>
     <section class="ddcfg-card">
      <h3>Calendário por loja</h3><p class="ddcfg-card-sub">Clique em uma data para registrar um feriado, fechamento local ou abertura excepcional.</p>
      <div class="ddcfg-calendar-top"><select class="ddcfg-select" id="ddStoreSelect"></select><div class="ddcfg-note" style="margin:0">Dias úteis calculados: <b id="ddStoreDays">—</b></div></div>
      <div class="ddcfg-cal" id="ddCalendar"></div><div id="ddDayInfo"></div>
      <div class="ddcfg-legend"><span>Funcionamento padrão</span><span class="exc">Fechamento/feriado</span><span class="openx">Abertura excepcional</span></div>
     </section>
     <section class="ddcfg-card ddcfg-summary"><h3>Resumo das lojas em <span id="ddSummaryMonth"></span></h3><p class="ddcfg-card-sub">O número exibido já considera todas as exceções cadastradas.</p><div class="ddcfg-store-list" id="ddStoreList"></div></section>
    </div>
   </div>
  </section>
 </div>`);
 document.querySelector('#ddConfigClose').onclick=close;
 document.querySelector('#ddConfigOverlay').addEventListener('click',e=>{if(e.target.id==='ddConfigOverlay')close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('#ddConfigOverlay')?.classList.contains('open'))close()});
 document.querySelector('#ddConfigMonth').onchange=async e=>{if(!/^\d{4}-\d{2}$/.test(e.target.value))return;month=e.target.value;selectedDate='';await loadExceptions();render()};
 document.querySelector('#ddStoreSelect').onchange=e=>{selectedStore=e.target.value;selectedDate='';renderCalendar();renderSummary()};
 document.querySelector('#ddSaveRules').onclick=saveRules;
}

function baseOpen(date){
 const d=new Date(date+'T12:00:00').getDay()||7;
 return (rules.dias_semana_uteis||DEFAULT_RULES.dias_semana_uteis).map(Number).includes(d);
}
function exceptionFor(storeId,date){return exceptions.find(x=>x.loja_id===storeId&&x.data===date)}
function isOpen(storeId,date){const x=exceptionFor(storeId,date);return x?x.tipo==='aberto':baseOpen(date)}
function dayCount(storeId){
 const[y,m]=month.split('-').map(Number),last=new Date(y,m,0).getDate();let total=0;
 for(let d=1;d<=last;d++)if(isOpen(storeId,`${month}-${pad(d)}`))total++;
 return total;
}
function exceptionCount(storeId){return exceptions.filter(x=>x.loja_id===storeId).length}

async function loadRules(){
 const r=await supabase.from('configuracoes_meta').select('id,dias_semana_uteis,fator_meta2,fator_meta3,crescimento_sugestao,arredondamento_meta,atualizado_em').eq('id',true).maybeSingle();
 if(r.error)throw r.error;rules={...DEFAULT_RULES,...(r.data||{})};
}
async function loadExceptions(){
 const[start,end]=monthRange(month);
 const r=await supabase.from('calendario_loja_excecoes').select('id,loja_id,data,tipo,descricao,origem,atualizado_em').gte('data',start).lte('data',end).order('data');
 if(r.error)throw r.error;exceptions=r.data||[];
}
async function loadAll(){
 const [s]=await Promise.all([supabase.from('lojas').select('id,codigo,nome').eq('ativa',true).order('nome'),loadRules(),loadExceptions()]);
 if(s.error)throw s.error;stores=s.data||[];if(!stores.some(x=>x.id===selectedStore))selectedStore=stores[0]?.id||'';
}

function renderRules(){
 const disabled=!canEditRules();
 document.querySelector('#ddConfigWeek').innerHTML=WEEK.map(d=>`<span><input id="ddw${d.n}" type="checkbox" value="${d.n}" ${rules.dias_semana_uteis.map(Number).includes(d.n)?'checked':''} ${disabled?'disabled':''}><label for="ddw${d.n}" title="${d.l}">${d.s}</label></span>`).join('');
 const values=[['#ddFactor2',Number(rules.fator_meta2).toFixed(2).replace('.',',')],['#ddFactor3',Number(rules.fator_meta3).toFixed(2).replace('.',',')],['#ddGrowth',((Number(rules.crescimento_sugestao)-1)*100).toFixed(1).replace('.',',')+'%'],['#ddRounding',Number(rules.arredondamento_meta).toLocaleString('pt-BR')]];
 values.forEach(([id,value])=>{const el=document.querySelector(id);el.value=value;el.disabled=disabled});
 document.querySelector('#ddSaveRules').disabled=disabled;
 document.querySelector('#ddRulesNote').textContent=disabled?'As regras da rede são somente leitura para o seu perfil. Administradores podem alterá-las.':'Alterações ficam registradas no histórico administrativo e passam a valer para toda a rede.';
}
function renderCalendar(){
 const select=document.querySelector('#ddStoreSelect');
 select.innerHTML=stores.map(s=>`<option value="${s.id}" ${s.id===selectedStore?'selected':''}>${esc(s.codigo||'')} · ${esc(s.nome)}</option>`).join('');
 const cal=document.querySelector('#ddCalendar'),[y,m]=month.split('-').map(Number),last=new Date(y,m,0).getDate(),offset=new Date(y,m-1,1).getDay();
 let html=['D','S','T','Q','Q','S','S'].map(x=>`<div class="ddcfg-dow">${x}</div>`).join('');
 for(let i=0;i<offset;i++)html+='<div class="ddcfg-blank"></div>';
 for(let d=1;d<=last;d++){
  const date=`${month}-${pad(d)}`,x=exceptionFor(selectedStore,date),open=isOpen(selectedStore,date);
  html+=`<button class="ddcfg-day ${open?'open':'closed'} ${x?'exception':''} ${selectedDate===date?'selected':''}" type="button" data-dd-date="${date}" title="${esc(x?.descricao||dateLabel(date))}">${d}${x?'<i></i>':''}</button>`;
 }
 cal.innerHTML=html;cal.querySelectorAll('[data-dd-date]').forEach(b=>b.onclick=()=>{selectedDate=b.dataset.ddDate;renderCalendar()});
 document.querySelector('#ddStoreDays').textContent=`${dayCount(selectedStore)} dias úteis`;
 renderDayInfo();
}
function renderDayInfo(){
 const box=document.querySelector('#ddDayInfo');if(!selectedDate){box.innerHTML='<div class="ddcfg-note">Selecione um dia do calendário para consultar ou alterar o funcionamento.</div>';return}
 const x=exceptionFor(selectedStore,selectedDate),open=isOpen(selectedStore,selectedDate),write=canEditCalendar();
 const state=open?'Loja aberta':'Loja fechada',reason=x?.descricao||(baseOpen(selectedDate)?'Funcionamento padrão da rede':'Folga padrão da rede');
 let actions='';
 if(write){
  actions=x?`<div class="ddcfg-day-actions"><input id="ddReason" class="ddcfg-input" style="text-align:left" value="${esc(reason)}" maxlength="180"><button id="ddRevertDay" class="ddcfg-day-revert" type="button">Reverter ao padrão</button></div>`
   :`<div class="ddcfg-day-actions"><input id="ddReason" class="ddcfg-input" style="text-align:left" placeholder="${baseOpen(selectedDate)?'Ex.: feriado municipal':'Ex.: evento especial'}" maxlength="180"><button id="ddSetDay" class="ddcfg-day-primary" type="button">${baseOpen(selectedDate)?'Fechar nesta data':'Abrir excepcionalmente'}</button></div>`;
 }
 box.innerHTML=`<div class="ddcfg-day-info"><b>${dateLabel(selectedDate)} · ${state}</b><p>${esc(reason)}${write?'':' · Somente leitura'}</p>${actions}</div>`;
 document.querySelector('#ddSetDay')?.addEventListener('click',saveDay);
 document.querySelector('#ddRevertDay')?.addEventListener('click',revertDay);
}
function renderSummary(){
 document.querySelector('#ddSummaryMonth').textContent=monthLabel(month);
 document.querySelector('#ddStoreList').innerHTML=stores.map(s=>`<button class="ddcfg-store ${s.id===selectedStore?'active':''}" type="button" data-dd-store="${s.id}"><div><b>${esc(s.nome)}</b><span>${esc(s.codigo||'Sem código')} · ${exceptionCount(s.id)} exceção(ões)</span></div><strong>${dayCount(s.id)}</strong></button>`).join('');
 document.querySelectorAll('[data-dd-store]').forEach(b=>b.onclick=()=>{selectedStore=b.dataset.ddStore;selectedDate='';renderCalendar();renderSummary()});
}
function render(){
 document.querySelector('#ddConfigRole').textContent=`${roleLabel(profile.role)} · ${canEditCalendar()?'pode editar os calendários':'somente leitura'}`;
 document.querySelector('#ddConfigMonth').value=month;renderRules();renderCalendar();renderSummary();
}
function msg(text,error=false){const el=document.querySelector('#ddRulesMsg');el.textContent=text;el.classList.toggle('err',error)}

async function saveRules(){
 try{
  const days=[...document.querySelectorAll('#ddConfigWeek input:checked')].map(x=>Number(x.value));
  const f2=parseNumber(document.querySelector('#ddFactor2').value),f3=parseNumber(document.querySelector('#ddFactor3').value),growth=1+parseNumber(document.querySelector('#ddGrowth').value.replace('%',''))/100,rounding=parseNumber(document.querySelector('#ddRounding').value.replace(/\./g,''));
  if(!days.length)throw new Error('Selecione pelo menos um dia de funcionamento.');
  if(!(f2>=1&&f3>=f2))throw new Error('A Meta 3 precisa ser igual ou maior que a Meta 2.');
  if(!(growth>=.5&&growth<=3))throw new Error('Revise o crescimento sugerido.');
  if(!(rounding>0))throw new Error('Informe um arredondamento válido.');
  msg('Salvando…');const r=await supabase.from('configuracoes_meta').update({dias_semana_uteis:days,fator_meta2:f2,fator_meta3:f3,crescimento_sugestao:growth,arredondamento_meta:rounding,atualizado_em:new Date().toISOString(),atualizado_por:profile.id}).eq('id',true).select().single();
  if(r.error)throw r.error;rules={...DEFAULT_RULES,...r.data};msg('Regras atualizadas para toda a rede.');render();window.dispatchEvent(new CustomEvent('metasdd:refresh',{detail:{page:'Configurações'}}));
 }catch(e){msg(e.message||String(e),true)}
}
async function saveDay(){
 try{
  const reason=(document.querySelector('#ddReason')?.value||'').trim()||(baseOpen(selectedDate)?'Feriado ou fechamento local':'Abertura excepcional');
  const row={loja_id:selectedStore,data:selectedDate,tipo:baseOpen(selectedDate)?'fechado':'aberto',descricao:reason,origem:'manual',criado_por:profile.id,atualizado_por:profile.id,atualizado_em:new Date().toISOString()};
  const r=await supabase.from('calendario_loja_excecoes').upsert(row,{onConflict:'loja_id,data'});if(r.error)throw r.error;
  await loadExceptions();renderCalendar();renderSummary();window.dispatchEvent(new CustomEvent('metasdd:refresh',{detail:{page:'Configurações'}}));
 }catch(e){msg(e.message||String(e),true)}
}
async function revertDay(){
 try{const r=await supabase.from('calendario_loja_excecoes').delete().eq('loja_id',selectedStore).eq('data',selectedDate);if(r.error)throw r.error;await loadExceptions();renderCalendar();renderSummary();window.dispatchEvent(new CustomEvent('metasdd:refresh',{detail:{page:'Configurações'}}))}catch(e){msg(e.message||String(e),true)}
}
async function open(){
 build();const overlay=document.querySelector('#ddConfigOverlay');overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');
 try{await loadAll();render()}catch(e){msg(e.message||'Não foi possível carregar as configurações.',true)}
}
function close(){const overlay=document.querySelector('#ddConfigOverlay');overlay?.classList.remove('open');overlay?.setAttribute('aria-hidden','true')}
function wire(doc){
 if(!doc?.body||doc.body.dataset.ddConfigWired)return;doc.body.dataset.ddConfigWired='true';
 doc.addEventListener('click',e=>{const target=e.target.closest('div,span,button');if((target?.textContent||'').trim()!=='Configurações')return;e.preventDefault();e.stopImmediatePropagation();open()},true);
}

try{
 build();const ctx=await getSessionProfile();if(!ctx.session||!ctx.profile?.ativo)throw new Error('Sessão inválida');profile=ctx.profile;
 frame.addEventListener('load',()=>wire(frame.contentDocument));wire(frame.contentDocument);
 window.addEventListener('metasdd:open-config',open);
 if(new URLSearchParams(location.search).get('open')==='config')open();
}catch(e){console.error('configurações',e)}

