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
let profile=null,stores=[],sellers=[],users=[],daily=new Map(),goals=new Map(),results=[],activeFilter='Todas',scheduled=false;

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
}

function closeFloating(doc){doc.querySelectorAll('.dd-fluid-floating').forEach(e=>e.remove())}
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
function patchCalendar(doc){
 const title=exact(doc,'Calendário'),card=title?.parentElement?.parentElement||title?.closest('div[style*="border-radius:20px"]');if(!card)return;
 const key=selected(),a=key.split('-').map(Number),days=new Date(a[0],a[1],0).getDate(),totalMeta=[...goals.values()].reduce((x,y)=>x+y,0);
 let business=0;for(let d=1;d<=days;d++)if(new Date(a[0],a[1]-1,d).getDay()!==0)business++;
 const target=business?totalMeta/business:0,today=new Date().toLocaleDateString('en-CA');
 const cells=[...card.querySelectorAll('div')].filter(e=>/^\d{1,2}$/.test((e.textContent||'').trim())&&(e.style.height==='38px'||(e.getAttribute('style')||'').includes('height:38px')));
 cells.forEach(cell=>{const d=Number(cell.textContent.trim()),date=key+'-'+pad(d),v=daily.get(date)||0,sunday=new Date(a[0],a[1]-1,d).getDay()===0,future=date>today;cell.style.cursor='pointer';cell.title=money(v)+' em '+date.split('-').reverse().join('/');cell.dataset.calendarReady='1';if(sunday){cell.style.background='#F1F5F4';cell.style.color='#BFCBC9'}else if(!future&&v>0){const ratio=target?v/target:0;cell.style.background=ratio>=1?'#05918C':ratio>=.85?'#9FD8D3':'#F5C3CE';cell.style.color=ratio>=1?'#fff':'#16211F'}else{cell.style.background='#fff';cell.style.color='#A8B7B5'}cell.style.border=date===today?'1.5px solid #CD4664':'1.5px solid transparent';cell.onclick=e=>{e.stopPropagation();toast('Dia '+d+': '+money(v)+(target?' · meta '+money(target):''),v?'ok':'warn',3600)}});
 const arrows=[...card.querySelectorAll('span')].filter(e=>['‹','›'].includes((e.textContent||'').trim()));arrows.forEach(ar=>{if(ar.dataset.monthArrow)return;ar.dataset.monthArrow='1';ar.style.cursor='pointer';ar.setAttribute('role','button');ar.tabIndex=0;ar.onclick=e=>{e.preventDefault();e.stopPropagation();localStorage.setItem('metasdd.competencia',monthShift(key,ar.textContent.trim()==='‹'?-1:1));location.reload()}});
 const sub=[...card.querySelectorAll('div')].find(e=>(e.textContent||'').includes('meta por dia útil'));if(sub)sub.textContent='Vendas reais do período · meta por dia útil '+money(target);
}
async function saveStore(doc){
 if(profile?.role!=='administrador')throw new Error('Somente o Administrador pode cadastrar lojas.');
 const screen=doc.querySelector('[data-screen-label="Lojas"]'),inputs=[...(screen?.querySelectorAll('input')||[])].slice(0,5);if(inputs.length<3)throw new Error('Abra o formulário Nova loja e preencha os dados.');
 const nome=inputs[0].value.trim(),codigo=inputs[1].value.trim(),meta=parseMoney(inputs[2].value),real=parseMoney(inputs[3]?.value),ticket=parseMoney(inputs[4]?.value);
 if(!nome||!codigo)throw new Error('Informe nome e código Microvix.');
 const {data:loja,error}=await supabase.from('lojas').insert({nome:nome.toUpperCase(),codigo,ativa:true}).select('id').single();if(error)throw error;
 if(meta>0){const g=await supabase.from('metas').upsert({loja_id:loja.id,competencia:start(),valor_meta:meta,criado_por:profile.id},{onConflict:'loja_id,competencia'});if(g.error)throw g.error}
 if(real>0){const today=new Date().toLocaleDateString('en-CA'),date=today.slice(0,7)===selected()?today:end(),r=await supabase.from('resultados').upsert({loja_id:loja.id,data:date,valor_realizado:real,criado_por:profile.id},{onConflict:'loja_id,data'});if(r.error)throw r.error}
 toast('Loja cadastrada'+(ticket?' · ticket de referência '+money(ticket):'')+'. Atualizando…');setTimeout(()=>location.reload(),650);
}
function makeInteractive(doc){
 const labels=['Importar Microvix','Salvar lançamentos','Copiar de maio','Preencher com sugestão','Publicar metas de junho','Adicionar loja','Salvar loja','Adicionar vendedora','Salvar vendedora','Convidar','Exportar Excel','Exportar PDF','Rede','Por loja'];
 [...doc.querySelectorAll('div,span')].forEach(el=>{const t=(el.textContent||'').trim();if(labels.includes(t)||/^Copiar de /i.test(t)||/^Publicar metas de /i.test(t)||/^Fechar [A-ZÁÉÍÓÚÃÕÇ]+ \d{4}$/i.test(t)){el.style.cursor='pointer';el.setAttribute('role','button');el.tabIndex=0;if(!el.dataset.keyReady){el.dataset.keyReady='1';el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click()}})}}});
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
function patch(doc){patchSearch(doc);makeInteractive(doc);patchCalendar(doc);patchRankingEmpty(doc);patchAccess(doc);patchCloseDescription(doc);if(activeFilter!=='Todas')applyStoreFilter(doc,activeFilter)}
async function wire(){
 const ctx=await getSessionProfile();profile=ctx.profile;if(!profile)return;await loadContext();
 const doc=frame.contentDocument;if(!doc?.body)return;patch(doc);
 doc.addEventListener('click',async e=>{const el=e.target.closest('div,span,button'),t=(el?.textContent||'').trim();try{
   if(el?.closest('[title="Ajuda"]')){e.preventDefault();e.stopImmediatePropagation();showHelp(doc,el.closest('[title="Ajuda"]'));return}
   if(el?.closest('[title="Notificações"]')){e.preventDefault();e.stopImmediatePropagation();showNotifications(doc,el.closest('[title="Notificações"]'));return}
   const filterGroup=(el?.parentElement?.textContent||'');if(['Todas','No ritmo','Atenção','Crítico'].includes(t)&&['Todas','No ritmo','Atenção','Crítico'].every(x=>filterGroup.includes(x))){e.preventDefault();e.stopImmediatePropagation();applyStoreFilter(doc,t);return}
   if(t==='Rede'){e.preventDefault();e.stopImmediatePropagation();resetRanking(doc);return}
   if(t==='Por loja'){e.preventDefault();e.stopImmediatePropagation();chooseStore(doc,el);return}
   if(t==='Salvar loja'){e.preventDefault();e.stopImmediatePropagation();await saveStore(doc);return}
   if(['Painel do mês','Lançar vendas','Definir metas','Lojas','Ranking','Ano 2026','Configurações'].includes(t))setTimeout(()=>patch(doc),180);
 }catch(err){console.error(err);toast(err.message||String(err),'error',4500)}},true);
 const obs=new MutationObserver(()=>{if(scheduled)return;scheduled=true;doc.defaultView.requestAnimationFrame(()=>{scheduled=false;patch(doc)})});obs.observe(doc.body,{childList:true,subtree:true});
}
frame.addEventListener('load',()=>setTimeout(()=>wire().catch(e=>{console.error(e);toast('Não foi possível ativar todos os controles.','error',4500)}),320));
