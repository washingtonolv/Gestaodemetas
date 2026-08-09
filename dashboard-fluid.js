import {supabase,getSessionProfile,roleLabel} from './supabase-client.js';

const frame=document.querySelector('#panel'),status=document.querySelector('#status');
const pad=n=>String(n).padStart(2,'0');
const selected=()=>localStorage.getItem('metasdd.competencia')||new Date().toLocaleDateString('en-CA').slice(0,7);
const start=()=>selected()+'-01';
const end=()=>{const a=selected().split('-').map(Number);return a[0]+'-'+pad(a[1])+'-'+pad(new Date(a[0],a[1],0).getDate())};
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const parseMoney=v=>{let s=String(v??'').trim().replace(/R\$/gi,'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');if(!s)return 0;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)||0};
const toast=(text,kind='ok',ms=3200)=>{if(!status)return;status.textContent=text;status.dataset.kind=kind;status.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>status.classList.remove('on'),ms)};
const exact=(doc,text)=>[...doc.querySelectorAll('div,span,h1,h2,h3')].find(e=>(e.textContent||'').trim()===text);
const monthShift=(key,delta)=>{const a=key.split('-').map(Number),d=new Date(a[0],a[1]-1+delta,1);return d.getFullYear()+'-'+pad(d.getMonth()+1)};
const endFor=key=>{const[y,m]=key.split('-').map(Number);return`${key}-${pad(new Date(y,m,0).getDate())}`},monthLabelFluid=key=>{const[y,m]=key.split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(y,m-1,1)).replace(/\s+de\s+/i,' ').toLocaleUpperCase('pt-BR')};
let profile=null,stores=[],sellers=[],users=[],daily=new Map(),goals=new Map(),results=[],activeFilter='Todas',scheduled=false,calendarKey=selected(),calendarCache=new Map(),selectedCalendarDate=null,calendarBusy=false;

async function loadContext(){
 const a=start(),b=end();
 const [s,v,m,r,p]=await Promise.all([
   supabase.from('lojas').select('id,codigo,nome,ativa').eq('ativa',true).order('nome'),
   supabase.from('vendedoras').select('id,loja_id,nome,ativa').eq('ativa',true).order('nome'),
   supabase.from('metas').select('loja_id,valor_meta').eq('competencia',a),
   supabase.from('resultados').select('loja_id,data,valor_realizado').gte('data',a).lte('data',b).order('data'),
   supabase.from('profiles').select('id,nome,email,role,ativo').eq('ativo',true).order('nome')
 ]);
 const error=s.error||v.error||m.error||r.error;if(error)throw error;
 stores=s.data||[];const names=new Map(stores.map(x=>[x.id,x.nome]));
 sellers=(v.data||[]).map(x=>({...x,loja:names.get(x.loja_id)||'Sem loja'}));
 goals=new Map((m.data||[]).map(x=>[x.loja_id,Number(x.valor_meta)||0]));
 users=!p.error&&(p.data||[]).length?p.data:[profile];results=r.data||[];daily=new Map();
 for(const x of results)daily.set(x.data,(daily.get(x.data)||0)+Number(x.valor_realizado||0));
 calendarKey=selected();selectedCalendarDate=null;calendarCache.clear();calendarCache.set(calendarKey,{daily:new Map(daily),goals:new Map(goals)});
}

function closeFloating(doc){doc.querySelectorAll('.dd-fluid-floating').forEach(e=>e.remove())}
function installMotion(doc){
 if(doc.getElementById('dd-motion-style'))return;
 const style=doc.createElement('style');style.id='dd-motion-style';style.textContent=`
 html{scroll-behavior:smooth}
 [data-screen-label]{animation:dd-page-in .40s cubic-bezier(.22,1,.36,1) both;transform-origin:top center;will-change:opacity,transform,filter}
 nav div{transition:background-color .26s ease,color .26s ease,transform .2s ease,box-shadow .26s ease}
 nav div:active{transform:scale(.985)}
 [data-screen-label="Lançar vendas"] input{background:#fff!important;border-color:#D8E6E4!important;transition:border-color .16s ease,box-shadow .16s ease}
 [data-screen-label] input:focus{border-color:#05918C!important;box-shadow:0 0 0 3px rgba(5,145,140,.11)}
 [data-screen-label] input.dd-invalid{border-color:#CD4664!important;box-shadow:0 0 0 3px rgba(205,70,100,.11)!important}
 .dd-annual-bar{transform-origin:bottom;animation:dd-bar-grow .42s cubic-bezier(.2,.8,.2,1) both;transition:filter .16s ease,transform .16s ease}
 [data-dd-annual]:hover .dd-annual-bar,[data-dd-annual]:focus .dd-annual-bar{filter:saturate(1.2);transform:scaleX(1.12)}
 [data-dd-calendar-card]{transition:opacity .2s ease,transform .25s cubic-bezier(.22,1,.36,1)}
 [data-calendar-date]{transition:background-color .18s ease,color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .16s ease}
 [data-calendar-date]:active{transform:scale(.94)}
 [data-dd-day-marker] circle{animation:dd-marker-pulse .42s cubic-bezier(.22,1,.36,1) both;transform-origin:center;transform-box:fill-box}
 @keyframes dd-page-in{from{opacity:.18;transform:translateY(10px) scale(.996);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}
 @keyframes dd-bar-grow{from{transform:scaleY(.08);opacity:.35}to{transform:scaleY(1);opacity:1}}
 @keyframes dd-marker-pulse{from{transform:scale(.45);opacity:.3}to{transform:scale(1);opacity:1}}
 @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}[data-screen-label],.dd-annual-bar,[data-dd-day-marker] circle{animation:none!important}nav div,.dd-annual-bar,[data-dd-calendar-card],[data-calendar-date]{transition:none!important}}
 `;doc.head.appendChild(style);
}
function floating(doc,id,anchor,width=300){
 closeFloating(doc);
 const box=doc.createElement('section');box.id=id;box.className='dd-fluid-floating';box.setAttribute('role','dialog');
 const rect=anchor.getBoundingClientRect(),left=Math.min(Math.max(12,rect.left),Math.max(12,doc.defaultView.innerWidth-width-12)),top=Math.min(rect.bottom+9,doc.defaultView.innerHeight-390);
 box.style.cssText='position:fixed;z-index:999998;left:'+left+'px;top:'+Math.max(12,top)+'px;width:min('+width+'px,calc(100vw - 24px));max-height:360px;overflow:auto;box-sizing:border-box;padding:10px;background:#fff;border:1px solid #DFEAE8;border-radius:16px;box-shadow:0 20px 55px rgba(20,60,55,.2);font-family:Manrope,system-ui,sans-serif;color:#16211F';
 doc.body.appendChild(box);setTimeout(()=>doc.addEventListener('click',()=>closeFloating(doc),{once:true}),0);return box;
}
function resultRow(doc,title,sub,onClick){
 const b=doc.createElement('button');b.type='button';b.style.cssText='width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;border:0;background:#fff;border-radius:11px;padding:11px 12px;text-align:left;cursor:pointer';
 const a=doc.createElement('span');a.style.cssText='display:flex;flex-direction:column;gap:3px';
 const t=doc.createElement('strong');t.textContent=title;t.style.cssText='font:700 12px/1.2 Manrope,sans-serif';
 const s=doc.createElement('small');s.textContent=sub;s.style.cssText='font:500 10px/1.3 Manrope,sans-serif;color:#8D9997';
 const arrow=doc.createElement('span');arrow.textContent='›';arrow.style.cssText='color:#05918C;font-weight:800';
 a.append(t,s);b.append(a,arrow);b.onclick=e=>{e.preventDefault();e.stopPropagation();onClick()};return b;
}
function navTo(doc,label,target){
 const nav=[...doc.querySelectorAll('nav div')].find(e=>(e.textContent||'').trim()===label);if(nav)nav.click();
 setTimeout(()=>{const hit=exact(doc,target);if(hit){hit.scrollIntoView({block:'center',behavior:'smooth'});const old=hit.style.background;hit.style.background='#FFF1B8';setTimeout(()=>hit.style.background=old,1800)}},260);
}
function searchResults(doc,input){
 let box=doc.getElementById('dd-search-results');
 const q=input.value.trim().toLocaleLowerCase('pt-BR');
 if(!q){box?.remove();return}
 if(!box){box=floating(doc,'dd-search-results',input.parentElement,330)}
 else box.innerHTML='';
 const matches=[
   ...stores.filter(x=>(x.nome+' '+(x.codigo||'')).toLocaleLowerCase('pt-BR').includes(q)).slice(0,6).map(x=>({title:x.nome,sub:'Loja · código '+(x.codigo||'—'),page:'Lojas'})),
   ...sellers.filter(x=>(x.nome+' '+x.loja).toLocaleLowerCase('pt-BR').includes(q)).slice(0,6).map(x=>({title:x.nome,sub:'Vendedora · '+x.loja,page:'Ranking'}))
 ].slice(0,10);
 if(!matches.length){const empty=doc.createElement('div');empty.textContent='Nenhum resultado encontrado.';empty.style.cssText='padding:14px;font:600 11px/1.4 Manrope,sans-serif;color:#8D9997';box.appendChild(empty);return}
 matches.forEach(x=>box.appendChild(resultRow(doc,x.title,x.sub,()=>{closeFloating(doc);input.value='';navTo(doc,x.page,x.title)})));
}
function patchSearch(doc){
 const label=exact(doc,'Buscar loja, vendedora…')||exact(doc,'Buscar loja, vendedora...');
 if(!label||label.dataset.searchReady)return;
 const holder=label.parentElement;if(!holder)return;
 const input=doc.createElement('input');input.type='search';input.placeholder='Buscar loja, vendedora…';input.setAttribute('aria-label','Buscar loja ou vendedora');input.autocomplete='off';
 input.style.cssText='border:0;outline:0;background:transparent;min-width:0;width:100%;font:500 12.5px/1 Manrope,sans-serif;color:#16211F';
 label.replaceWith(input);input.dataset.searchReady='1';input.addEventListener('input',()=>searchResults(doc,input));input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.value='';closeFloating(doc)}});
}
function guideFor(screen){
 const guides={
  'Painel do mês':['Painel do mês','Escolha o período no topo. O gráfico e o calendário usam as vendas reais; use os filtros para localizar lojas que precisam de atenção.'],
  'Lançar vendas':['Lançar vendas','Digite as vendas do dia ou importe uma planilha do Microvix. Ao salvar, os valores são sincronizados para toda a equipe.'],
  'Definir metas':['Definir metas','Copie o mês atual, use a sugestão automática e ajuste a Meta 1 antes de publicar o próximo período.'],
  'Lojas':['Lojas','Cadastre lojas e acompanhe meta, realizado e ritmo. O cadastro é gravado no banco oficial.'],
  'Ranking':['Ranking','Cadastre vendedoras e acompanhe meta individual, ticket, faixa e comissão por período.'],
  'Configurações':['Configurações','Confira regras, exporte relatórios, gerencie acessos e feche competências com segurança.']
 };
 return guides[screen]||['Metas D&D','Use a navegação principal e o seletor de período para explorar os dados da rede.'];
}
function showHelp(doc,anchor){
 const current=doc.querySelector('[data-screen-label]')?.getAttribute('data-screen-label')||'';
 const g=guideFor(current),box=floating(doc,'dd-help-panel',anchor,340);
 box.innerHTML='<div style="padding:8px 10px 4px"><div style="font:800 15px/1.2 Manrope,sans-serif;color:#0A5F5C">'+g[0]+'</div><div style="margin-top:9px;font:500 11.5px/1.65 Manrope,sans-serif;color:#5A6664">'+g[1]+'</div><div style="margin-top:12px;padding:10px 11px;border-radius:11px;background:#E7F4F2;font:600 10.5px/1.45 Manrope,sans-serif;color:#0A5F5C">Dica: a busca no topo encontra lojas e vendedoras em qualquer tela.</div></div>';
}
function notifications(){
 const today=new Date().toLocaleDateString('en-CA'),isCurrent=today.slice(0,7)===selected(),todayStores=new Set(results.filter(x=>x.data===today&&Number(x.valor_realizado)>0).map(x=>x.loja_id));
 const missingGoal=stores.filter(x=>!goals.get(x.id)),pending=isCurrent?stores.filter(x=>!todayStores.has(x.id)):[];
 const total=[...daily.values()].reduce((a,b)=>a+b,0),items=[];
 if(missingGoal.length)items.push({title:missingGoal.length+' loja(s) sem meta',sub:'Complete as metas do período selecionado.'});
 if(pending.length)items.push({title:pending.length+' lançamento(s) pendente(s) hoje',sub:pending.slice(0,3).map(x=>x.nome).join(', ')+(pending.length>3?'…':'')});
 items.push({title:'Realizado no período: '+money(total),sub:results.length+' lançamento(s) sincronizado(s) no Supabase.'});
 return items;
}
function showNotifications(doc,anchor){
 const box=floating(doc,'dd-notification-panel',anchor,350),items=notifications();
 const title=doc.createElement('div');title.textContent='Notificações do período';title.style.cssText='padding:9px 11px;font:800 14px/1.2 Manrope,sans-serif;color:#0A5F5C';box.appendChild(title);
 items.forEach(x=>{const item=doc.createElement('div');item.style.cssText='margin:4px;padding:11px;border-radius:12px;background:#F4F8F7';item.innerHTML='<div style="font:700 11.5px/1.3 Manrope,sans-serif">'+x.title+'</div><div style="margin-top:4px;font:500 10px/1.45 Manrope,sans-serif;color:#8D9997">'+x.sub+'</div>';box.appendChild(item)});
}
function storeRows(doc){
 const rows=[],seen=new Set();
 for(const s of stores){for(const el of [...doc.querySelectorAll('div,span')].filter(e=>(e.textContent||'').trim()===s.nome)){const row=el.closest('div[style*="grid-template-columns"]');if(row&&!seen.has(row)){seen.add(row);rows.push(row)}}}
 return rows;
}
function applyStoreFilter(doc,name){
 activeFilter=name;const rows=storeRows(doc);rows.forEach(row=>{const ok=name==='Todas'||(row.textContent||'').includes(name);row.style.display=ok?'grid':'none'});
 for(const label of ['Todas','No ritmo','Atenção','Crítico']){const chip=exact(doc,label);if(!chip)continue;const on=label===name;chip.style.background=on?'#05918C':'#F4F8F7';chip.style.color=on?'#fff':'#5A6664';chip.style.fontWeight=on?'700':'600'}
 toast(name==='Todas'?'Exibindo todas as lojas':'Filtro aplicado: '+name);
}
function sellerRows(doc){
 const rows=[],seen=new Set();for(const s of sellers){const el=exact(doc,s.nome),row=el?.closest('div[style*="grid-template-columns"]');if(row&&!seen.has(row)){seen.add(row);rows.push({row,seller:s})}}return rows;
}
function resetRanking(doc){sellerRows(doc).forEach(x=>x.row.style.display='grid');toast('Ranking da rede')}
function chooseStore(doc,anchor){
 if(!sellers.length)return toast('Cadastre vendedoras para usar o ranking por loja.','warn',3800);
 const box=floating(doc,'dd-store-ranking',anchor,270);
 stores.forEach(s=>box.appendChild(resultRow(doc,s.nome,'Filtrar ranking',()=>{const rows=sellerRows(doc);rows.forEach(x=>x.row.style.display=x.seller.loja===s.nome?'grid':'none');closeFloating(doc);toast('Ranking: '+s.nome)})));
}
function calendarCard(doc){
 const title=exact(doc,'Calendário');
 return title?.parentElement?.parentElement||title?.closest('div[style*="border-radius:20px"]')||null;
}
function businessDays(key){
 const [y,m]=key.split('-').map(Number),days=new Date(y,m,0).getDate();let count=0;
 for(let d=1;d<=days;d++)if(new Date(y,m-1,d).getDay()!==0)count++;
 return count;
}
async function monthSnapshot(key){
 if(calendarCache.has(key))return calendarCache.get(key);
 const [g,r]=await Promise.all([
  supabase.from('metas').select('loja_id,valor_meta').eq('competencia',`${key}-01`),
  supabase.from('resultados').select('data,valor_realizado').gte('data',`${key}-01`).lte('data',endFor(key)).order('data')
 ]);
 const error=g.error||r.error;if(error)throw error;
 const snapshot={goals:new Map((g.data||[]).map(x=>[x.loja_id,Number(x.valor_meta)||0])),daily:new Map()};
 for(const x of r.data||[])snapshot.daily.set(x.data,(snapshot.daily.get(x.data)||0)+Number(x.valor_realizado||0));
 calendarCache.set(key,snapshot);return snapshot;
}
function renderCalendarChart(doc,key,snapshot,selectedDate=null){
 const title=exact(doc,'Vendas por dia'),card=title?.closest('div[style*="border-radius:20px"]')||title?.parentElement?.parentElement,svg=card?.querySelector('svg');if(!svg)return;
 const [y,m]=key.split('-').map(Number),days=new Date(y,m,0).getDate(),todayKey=new Date().toLocaleDateString('en-CA'),visibleDay=key===todayKey.slice(0,7)?Math.max(1,Number(todayKey.slice(8,10))):days;
 const values=[];for(let d=1;d<=days;d++)values.push(snapshot.daily.get(`${key}-${pad(d)}`)||0);const visibleValues=values.slice(0,visibleDay);
 const total=[...snapshot.goals.values()].reduce((sum,value)=>sum+Number(value||0),0),dailyGoal=total/Math.max(businessDays(key),1),max=Math.max(dailyGoal,...values,1);
 const xAt=index=>index/Math.max(days-1,1)*900,yAt=value=>200-value/max*170;let path='';
 visibleValues.forEach((value,index)=>{const x=xAt(index),y0=yAt(value);if(!index)path+=`M${x.toFixed(1)} ${y0.toFixed(1)}`;else{const previousX=xAt(index-1),previousY=yAt(visibleValues[index-1]),center=(previousX+x)/2;path+=` C${center.toFixed(1)} ${previousY.toFixed(1)} ${center.toFixed(1)} ${y0.toFixed(1)} ${x.toFixed(1)} ${y0.toFixed(1)}`}});
 const paths=svg.querySelectorAll('path');if(paths[0])paths[0].setAttribute('d',`${path} L900 200 L0 200 Z`);if(paths[1])paths[1].setAttribute('d',path);
 const goalLine=[...svg.querySelectorAll('line')].find(line=>!line.hasAttribute('data-dd-day-line'));if(goalLine){const y0=yAt(dailyGoal).toFixed(1);goalLine.setAttribute('y1',y0);goalLine.setAttribute('y2',y0)}
 const realized=[...card.querySelectorAll('span')].find(span=>span.dataset.ddChartReal==='1'||(span.textContent||'').trim().startsWith('realizado'));if(realized){realized.dataset.ddChartReal='1';const day=selectedDate?Number(selectedDate.slice(8,10)):null,value=day?values[day-1]||0:null,short=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(`${selectedDate||key+'-01'}T12:00:00`)).replace('.','');const text=day?`${short} · ${money(value)}`:`realizado · ${monthLabelFluid(key)}`;if(realized.textContent!==text)realized.textContent=text}
 const meta=[...card.querySelectorAll('span')].find(span=>(span.textContent||'').trim().startsWith('meta '));if(meta){const text=`meta ${money(dailyGoal)}`;if(meta.textContent!==text)meta.textContent=text}
 const axis=svg.nextElementSibling,axisLabels=axis?[...axis.children]:[],marks=[1,Math.max(1,Math.round(days*.25)),Math.max(1,Math.round(days*.5)),Math.max(1,Math.round(days*.75)),days];axisLabels.slice(0,5).forEach((el,index)=>{const text=String(marks[index]);if(el.textContent!==text)el.textContent=text});
 let marker=svg.querySelector('[data-dd-day-marker]');
 if(selectedDate){
  const day=Number(selectedDate.slice(8,10)),value=values[day-1]||0,x=xAt(Math.min(day-1,values.length-1)),y0=yAt(value),ns='http://www.w3.org/2000/svg';
  if(!marker){marker=doc.createElementNS(ns,'g');marker.setAttribute('data-dd-day-marker','1');const line=doc.createElementNS(ns,'line');line.setAttribute('data-dd-day-line','1');line.setAttribute('stroke','#0A5F5C');line.setAttribute('stroke-width','1.5');line.setAttribute('stroke-dasharray','4 5');line.setAttribute('vector-effect','non-scaling-stroke');const dot=doc.createElementNS(ns,'circle');dot.setAttribute('r','7');dot.setAttribute('fill','#fff');dot.setAttribute('stroke','#05918C');dot.setAttribute('stroke-width','4');dot.setAttribute('vector-effect','non-scaling-stroke');const desc=doc.createElementNS(ns,'title');marker.append(line,dot,desc);svg.appendChild(marker)}
  const line=marker.querySelector('line'),dot=marker.querySelector('circle'),desc=marker.querySelector('title');line.setAttribute('x1',x.toFixed(1));line.setAttribute('x2',x.toFixed(1));line.setAttribute('y1','18');line.setAttribute('y2','200');dot.setAttribute('cx',x.toFixed(1));dot.setAttribute('cy',y0.toFixed(1));desc.textContent=`${selectedDate.split('-').reverse().join('/')}: ${money(value)}`;
 }else marker?.remove();
 svg.setAttribute('role','img');svg.setAttribute('aria-label',selectedDate?`Vendas com destaque em ${selectedDate.split('-').reverse().join('/')}`:`Vendas por dia de ${monthLabelFluid(key)}`);
}
function renderCalendar(doc,key,snapshot){
 const card=calendarCard(doc);if(!card)return;card.dataset.ddCalendarCard='1';calendarKey=key;
 const [y,m]=key.split('-').map(Number),days=new Date(y,m,0).getDate(),offset=new Date(y,m-1,1).getDay(),today=new Date().toLocaleDateString('en-CA'),totalMeta=[...snapshot.goals.values()].reduce((sum,value)=>sum+Number(value||0),0),dailyGoal=totalMeta/Math.max(businessDays(key),1);
 const headerMonth=[...card.querySelectorAll('span')].find(el=>el.children.length===0&&(el.dataset.ddCalendarMonth==='1'||/^[A-ZÁÉÍÓÚÃÕÇ]+(?:\s+DE)?\s+\d{4}$/.test((el.textContent||'').trim())));const headerText=monthLabelFluid(key);if(headerMonth){headerMonth.dataset.ddCalendarMonth='1';if(headerMonth.textContent!==headerText)headerMonth.textContent=headerText}
 const grids=[...card.children].filter(el=>(el.style.display||'')==='grid'),grid=grids.find(el=>[...el.children].some(child=>(child.style.height||'')==='38px'))||grids.at(-1);if(!grid)return;
 const slots=[...grid.children];slots.forEach((slot,index)=>{
  const day=index-offset+1;
  slot.style.height='38px';slot.style.borderRadius='11px';slot.style.display='flex';slot.style.alignItems='center';slot.style.justifyContent='center';slot.style.font='700 12px/1 Manrope,sans-serif';slot.style.minWidth='0';
  if(day<1||day>days){if(slot.textContent)slot.textContent='';slot.style.opacity='0';slot.style.pointerEvents='none';slot.onclick=null;slot.onkeydown=null;slot.removeAttribute('role');slot.removeAttribute('tabindex');slot.removeAttribute('aria-label');slot.removeAttribute('data-calendar-date');return}
  const text=String(day);if((slot.textContent||'').trim()!==text)slot.textContent=text;
  const date=`${key}-${pad(day)}`,value=snapshot.daily.get(date)||0,sunday=new Date(y,m-1,day).getDay()===0,future=date>today,ratio=dailyGoal?value/dailyGoal:0,selectedDay=date===selectedCalendarDate;
  slot.style.opacity='1';slot.style.pointerEvents='auto';slot.style.cursor='pointer';slot.dataset.calendarDate=date;slot.dataset.calendarReady='1';slot.setAttribute('role','button');slot.setAttribute('tabindex','0');slot.setAttribute('aria-label',`${date.split('-').reverse().join('/')}: ${money(value)}`);
  if(sunday){slot.style.background='#F1F5F4';slot.style.color='#BFCBC9'}else if(!future&&value>0){slot.style.background=ratio>=1?'#05918C':ratio>=.85?'#9FD8D3':'#F5C3CE';slot.style.color=ratio>=1?'#fff':'#16211F'}else{slot.style.background='#fff';slot.style.color='#A8B7B5'}
  slot.style.border=date===today?'1.5px solid #CD4664':'1.5px solid transparent';slot.style.boxShadow=selectedDay?'0 0 0 3px rgba(5,145,140,.24),0 8px 18px rgba(20,60,55,.12)':'none';slot.title=`${money(value)} em ${date.split('-').reverse().join('/')}`;
  const choose=e=>{e?.preventDefault?.();e?.stopPropagation?.();selectedCalendarDate=date;renderCalendar(doc,key,snapshot);toast(`Dia ${day}: ${money(value)} · destacado no gráfico`,value?'ok':'warn',3600)};
  slot.onclick=choose;slot.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){choose(e)}};
 });
 const arrows=[...card.querySelectorAll('span')].filter(el=>['‹','›'].includes((el.textContent||'').trim()));arrows.forEach(arrow=>{const direction=arrow.textContent.trim()==='‹'?-1:1;arrow.dataset.monthArrow='1';arrow.style.cursor='pointer';arrow.style.transition='background-color .16s ease,transform .16s ease';arrow.setAttribute('role','button');arrow.setAttribute('tabindex','0');arrow.setAttribute('aria-label',direction<0?'Mês anterior no calendário':'Próximo mês no calendário');arrow.onclick=async e=>{e.preventDefault();e.stopPropagation();await switchCalendar(doc,monthShift(calendarKey,direction),direction)};arrow.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();arrow.click()}}});
 renderCalendarChart(doc,key,snapshot,selectedCalendarDate);
 const sub=[...card.querySelectorAll('div')].find(el=>(el.textContent||'').includes('meta por dia útil')||(el.dataset.ddCalendarSummary==='1'));if(sub){sub.dataset.ddCalendarSummary='1';const value=selectedCalendarDate?snapshot.daily.get(selectedCalendarDate)||0:null,text=selectedCalendarDate?`${selectedCalendarDate.split('-').reverse().join('/')} · ${money(value)} · destacado no gráfico`:`Vendas reais do período · meta por dia útil ${money(dailyGoal)}`;if(sub.textContent!==text)sub.textContent=text}
}
async function switchCalendar(doc,nextKey,direction){
 if(calendarBusy)return;calendarBusy=true;const card=calendarCard(doc),win=doc.defaultView,scrollY=win.scrollY;
 if(card){card.setAttribute('aria-busy','true');card.style.opacity='.72';card.style.transform=`translateX(${direction*5}px)`}
 try{const snapshot=await monthSnapshot(nextKey);selectedCalendarDate=null;renderCalendar(doc,nextKey,snapshot);if(Math.abs(win.scrollY-scrollY)>1){const old=doc.documentElement.style.scrollBehavior;doc.documentElement.style.scrollBehavior='auto';win.scrollTo(0,scrollY);doc.documentElement.style.scrollBehavior=old}win.requestAnimationFrame(()=>{if(card){card.style.opacity='1';card.style.transform='none'}})}
 catch(error){console.error(error);toast(error.message||String(error),'error',4500);if(card){card.style.opacity='1';card.style.transform='none'}}
 finally{calendarBusy=false;card?.removeAttribute('aria-busy')}
}
function patchCalendar(doc){
 const key=calendarKey||selected(),snapshot=calendarCache.get(key)||{daily,goals};
 renderCalendar(doc,key,snapshot);
}
async function saveStore(doc){
 if(profile?.role!=='administrador')throw new Error('Somente o Administrador pode cadastrar lojas.');
 const screen=doc.querySelector('[data-screen-label="Lojas"]'),inputs=[...(screen?.querySelectorAll('input')||[])].slice(0,5);if(inputs.length<3)throw new Error('Abra o formulário Nova loja e preencha os dados.');
 const nome=inputs[0].value.trim(),codigo=inputs[1].value.trim(),meta=parseMoney(inputs[2].value),real=parseMoney(inputs[3]?.value),ticket=parseMoney(inputs[4]?.value);
 if(!nome||!codigo)throw new Error('Informe nome e código Microvix.');
 const {data:loja,error}=await supabase.from('lojas').insert({nome:nome.toUpperCase(),codigo,ativa:true}).select('id').single();if(error)throw error;
 if(meta>0){const g=await supabase.from('metas').upsert({loja_id:loja.id,competencia:start(),valor_meta:meta,criado_por:profile.id},{onConflict:'loja_id,competencia'});if(g.error)throw g.error}
 if(real>0){const today=new Date().toLocaleDateString('en-CA'),date=today.slice(0,7)===selected()?today:end(),r=await supabase.from('resultados').upsert({loja_id:loja.id,data:date,valor_realizado:real,criado_por:profile.id},{onConflict:'loja_id,data'});if(r.error)throw r.error}
 toast('Loja cadastrada'+(ticket?' · ticket de referência '+money(ticket):'')+'. Atualizando…');window.dispatchEvent(new CustomEvent('metasdd:refresh',{detail:{page:'Lojas'}}));
}
function makeInteractive(doc){
 const labels=['Importar Microvix','Salvar lançamentos','Copiar de maio','Preencher com sugestão','Publicar metas de junho','Adicionar loja','Salvar loja','Adicionar vendedora','Salvar vendedora','Convidar','Exportar Excel','Exportar PDF','Rede','Por loja','Cobrar'];
 [...doc.querySelectorAll('div,span')].forEach(el=>{const t=(el.textContent||'').trim();if(labels.includes(t)||/^Copiar de /i.test(t)||/^Publicar metas de /i.test(t)||/^Fechar [A-ZÁÉÍÓÚÃÕÇ]+ \d{4}$/i.test(t)){el.style.cursor='pointer';el.setAttribute('role','button');el.tabIndex=0;if(/^\+?\s*Adicionar (loja|vendedora)$/i.test(t)){el.style.background='#05918C';el.style.color='#fff'}if(!el.dataset.keyReady){el.dataset.keyReady='1';el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click()}})}}});
 for(const input of doc.querySelectorAll('[data-screen-label] input'))if(!input.dataset.validationReady){input.dataset.validationReady='1';input.addEventListener('input',()=>{input.classList.remove('dd-invalid');input.removeAttribute('aria-invalid')})}
 for(const label of ['Todas','No ritmo','Atenção','Crítico']){const chip=exact(doc,label),group=(chip?.parentElement?.textContent||'');if(chip&&['Todas','No ritmo','Atenção','Crítico'].every(x=>group.includes(x))){chip.style.cursor='pointer';chip.setAttribute('role','button');chip.tabIndex=0}}
 const help=doc.querySelector('[title="Ajuda"]'),bell=doc.querySelector('[title="Notificações"]');for(const el of [help,bell])if(el){el.style.cursor='pointer';el.setAttribute('role','button');el.tabIndex=0}
}
function patchRankingEmpty(doc){
 if(sellers.length)return;const screen=doc.querySelector('[data-screen-label="Ranking"]');if(!screen)return;
 const title=[...screen.querySelectorAll('div,span')].find(e=>(e.textContent||'').trim()==='Destaque do mês');if(!title)return;
 const card=title.closest('div[style*="border-radius"]')||title.parentElement;
 const name=[...card.querySelectorAll('div,span')].find(e=>(e.textContent||'').trim()==='Aline Ferreira');
 const note=[...card.querySelectorAll('div,span')].find(e=>(e.textContent||'').includes('Rodrigo Silva · 106%'));
 if(name)name.textContent='Nenhuma vendedora cadastrada';if(note)note.textContent='Use “Adicionar vendedora” para iniciar o ranking real deste período.';
 const rankingTitle=[...screen.querySelectorAll('h2')].find(e=>(e.textContent||'').trim().startsWith('Ranking de vendedoras'));const rankingCard=rankingTitle?.parentElement?.parentElement;if(!rankingCard||rankingCard.querySelector('[data-dd-empty-ranking]'))return;
 const header=[...rankingCard.children].find(e=>(e.textContent||'').includes('Vendedora')&&(e.textContent||'').includes('% da meta'));if(!header)return;
 const empty=doc.createElement('div');empty.dataset.ddEmptyRanking='1';empty.style.cssText='margin-top:14px;padding:34px 22px;border:1px dashed #CFE0DD;border-radius:16px;background:#F8FBFA;text-align:center';
 const emptyTitle=doc.createElement('strong');emptyTitle.textContent='O ranking começa com a primeira vendedora';emptyTitle.style.cssText='display:block;font:800 15px/1.3 Manrope,sans-serif;color:#0A5F5C';
 const emptyText=doc.createElement('span');emptyText.textContent='Cadastre uma vendedora e associe a loja para acompanhar vendas, ticket e comissão.';emptyText.style.cssText='display:block;max-width:460px;margin:8px auto 16px;font:500 11.5px/1.55 Manrope,sans-serif;color:#667270';
 const action=doc.createElement('button');action.type='button';action.textContent='Adicionar primeira vendedora';action.style.cssText='border:0;border-radius:11px;padding:10px 16px;background:#05918C;color:#fff;font:700 11.5px/1 Manrope,sans-serif;cursor:pointer';action.onclick=e=>{e.preventDefault();e.stopPropagation();const add=[...screen.querySelectorAll('div,span')].find(x=>(x.textContent||'').trim().includes('Adicionar vendedora'));add?.click()};
 empty.append(emptyTitle,emptyText,action);header.insertAdjacentElement('afterend',empty);
}
function patchAccess(doc){
 const title=exact(doc,'Quem tem acesso'),card=title?.parentElement?.parentElement,list=card?.children?.[1];if(!list||list.dataset.realAccess)return;
 list.dataset.realAccess='1';list.innerHTML='';
 const initials=name=>String(name||'').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'--';
 users.forEach((u,i)=>{const row=doc.createElement('div');row.style.cssText='display:flex;align-items:center;gap:12px';const admin=u.role==='administrador';row.innerHTML='<span style="width:36px;height:36px;border-radius:50%;background:'+(admin?'#E7F4F2':'#FDF1F3')+';display:flex;align-items:center;justify-content:center;font:800 10px/1 Manrope,sans-serif;color:'+(admin?'#05918C':'#CD4664')+';flex:none">'+initials(u.nome)+'</span><span style="min-width:0;flex:1"><b style="display:block;font:700 12px/1.25 Manrope,sans-serif">'+(u.nome||u.email||'Usuário')+'</b><small style="display:block;margin-top:3px;font:500 10px/1.3 Manrope,sans-serif;color:#8D9997">'+(admin?'Toda a rede':'Lojas autorizadas')+'</small></span><span style="padding:6px 10px;border-radius:100px;background:#F4F8F7;font:600 10px/1 Manrope,sans-serif;color:#5A6664">'+roleLabel(u.role)+'</span>';list.appendChild(row)});
}
function patchCloseDescription(doc){
 const title=exact(doc,'Encerrar o mês'),card=title?.parentElement;if(!card)return;const desc=[...card.querySelectorAll('div')].find(e=>(e.textContent||'').trim().startsWith('Congela os números de'));if(!desc)return;
 const nextKey=monthShift(selected(),1),parts=nextKey.split('-').map(Number),cur=selected().split('-').map(Number),fmt=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}),name=fmt.format(new Date(parts[0],parts[1]-1,1)),current=fmt.format(new Date(cur[0],cur[1]-1,1));
 desc.textContent='Congela os números de '+current+' e libera '+name+' para lançamento. Não dá para desfazer.';
}
function patch(doc){installMotion(doc);patchSearch(doc);makeInteractive(doc);patchCalendar(doc);patchRankingEmpty(doc);patchAccess(doc);patchCloseDescription(doc);if(activeFilter!=='Todas')applyStoreFilter(doc,activeFilter)}
async function wire(){
 const ctx=await getSessionProfile();profile=ctx.profile;if(!profile)return;await loadContext();
 const doc=frame.contentDocument;if(!doc?.body)return;patch(doc);
 doc.addEventListener('click',async e=>{const el=e.target.closest('div,span,button'),t=(el?.textContent||'').trim();try{
   if(el?.closest('[title="Ajuda"]')){e.preventDefault();e.stopImmediatePropagation();showHelp(doc,el.closest('[title="Ajuda"]'));return}
   if(el?.closest('[title="Notificações"]')){e.preventDefault();e.stopImmediatePropagation();showNotifications(doc,el.closest('[title="Notificações"]'));return}
   if(t==='Cobrar'){e.preventDefault();e.stopImmediatePropagation();const row=el.parentElement,store=row?.children?.[1]?.textContent?.trim()||'loja',msg='Olá! O lançamento de vendas de '+store+' ainda está pendente em '+new Date().toLocaleDateString('pt-BR')+'. Pode atualizar o painel D&D, por favor?';try{await doc.defaultView.navigator.clipboard.writeText(msg);toast('Lembrete de '+store+' copiado.')}catch{toast('Lembrete preparado para '+store+'.','warn')}return}
   const filterGroup=(el?.parentElement?.textContent||'');if(['Todas','No ritmo','Atenção','Crítico'].includes(t)&&['Todas','No ritmo','Atenção','Crítico'].every(x=>filterGroup.includes(x))){e.preventDefault();e.stopImmediatePropagation();applyStoreFilter(doc,t);return}
   if(t==='Rede'){e.preventDefault();e.stopImmediatePropagation();resetRanking(doc);return}
   if(t==='Por loja'){e.preventDefault();e.stopImmediatePropagation();chooseStore(doc,el);return}
   if(t==='Salvar loja'){e.preventDefault();e.stopImmediatePropagation();await saveStore(doc);return}
   if(['Painel do mês','Lançar vendas','Definir metas','Lojas','Ranking','Ano 2026','Configurações'].includes(t))setTimeout(()=>patch(doc),180);
 }catch(err){console.error(err);toast(err.message||String(err),'error',4500)}},true);
 const obs=new MutationObserver(()=>{if(scheduled)return;scheduled=true;doc.defaultView.requestAnimationFrame(()=>{scheduled=false;patch(doc)})});obs.observe(doc.body,{childList:true,subtree:true});
}
frame.addEventListener('load',()=>setTimeout(()=>wire().catch(e=>{console.error(e);toast('Não foi possível ativar todos os controles.','error',4500)}),320));
