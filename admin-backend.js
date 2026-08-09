import {supabase,getSessionProfile,roleLabel} from './supabase-client.js';

const $=s=>document.querySelector(s);
const frame=$('#adminPanel'),loading=$('#loading'),toastEl=$('#toast');
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const initials=n=>String(n||'').trim().split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase()||'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthStart=k=>`${k.slice(0,7)}-01`;
const monthEnd=k=>{const[y,m]=k.slice(0,7).split('-').map(Number);return `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`};
const monthLabel=k=>new Date(`${k.slice(0,7)}-01T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).toUpperCase();
const roleText=r=>r==='supervisor'?'Supervisora':r==='gerente_comercial'?'Gerente comercial':roleLabel(r);
const br=n=>Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:3});
const csvCell=v=>`"${String(v??'').replaceAll('"','""')}"`;

let profile=null,session=null,selected='',dataCache=null,refreshTimer=null,toastTimer=null;
const DEFAULT_RULES={dias_semana_uteis:[1,2,3,4,5,6],fator_meta2:1.12,fator_meta3:1.30,crescimento_sugestao:1.06,arredondamento_meta:1000};

function toast(message,error=false){clearTimeout(toastTimer);toastEl.textContent=message;toastEl.className=`toast show${error?' error':''}`;toastTimer=setTimeout(()=>toastEl.className='toast',4200)}
function setBusy(button,on,label){if(!button)return;button.disabled=on;if(on){button.dataset.label=button.textContent;button.textContent=label||'Salvando…'}else button.textContent=button.dataset.label||button.textContent}
function closeDialog(id){const d=$(`#${id}`);if(d?.open)d.close();const msg=d?.querySelector('.message');if(msg)msg.textContent=''}
document.addEventListener('click',e=>{const id=e.target.closest('[data-close]')?.dataset.close;if(id)closeDialog(id)});
document.addEventListener('cancel',e=>{if(e.target.matches('dialog'))closeDialog(e.target.id)},true);

async function resolveMonth(){
 const saved=localStorage.getItem('metasdd.admin.competencia')||localStorage.getItem('metasdd.competencia');
 if(/^\d{4}-\d{2}$/.test(saved||''))return saved;
 const now=new Date().toLocaleDateString('en-CA').slice(0,7);
 const{data,error}=await supabase.from('metas').select('competencia').lte('competencia',`${now}-01`).order('competencia',{ascending:false}).limit(1);
 if(error)throw error;return data?.[0]?.competencia?.slice(0,7)||now
}

function timeAgo(value){
 if(!value)return 'nunca';const ms=Date.now()-new Date(value).getTime(),minutes=Math.max(0,Math.round(ms/60000));
 if(minutes<2)return 'agora';if(minutes<60)return `há ${minutes} min`;const hours=Math.round(minutes/60);if(hours<24)return `há ${hours} h`;const days=Math.round(hours/24);if(days===1)return 'ontem';return `há ${days} dias`
}

function buildTree(stores,users,links,managerLinks){
 const userMap=new Map(users.map(u=>[u.id,u])),managerBySupervisor=new Map(managerLinks.map(x=>[x.supervisor_id,x.gerente_id]));
 const colors={Franquias:{cor:'#0A5F5C',bg:'#E4F1F0'},Multimarcas:{cor:'#8A4B92',bg:'#F3EAF6'}};
 return ['Franquias','Multimarcas'].map(ramo=>{
   const branchStores=stores.filter(s=>s.ramo===ramo),supervisorGroups=[];
   for(const sid of [...new Set(branchStores.map(s=>s.supervisorId).filter(Boolean))]){
     const sup=userMap.get(sid),mine=branchStores.filter(s=>s.supervisorId===sid),manager=userMap.get(managerBySupervisor.get(sid));
     supervisorGroups.push({managerId:manager?.id||'',managerName:manager?.nome||'Sem gerente definido',supervisor:{nome:sup?.nome||'Supervisor',ini:initials(sup?.nome),lojas:mine.map(l=>({nome:l.nome,ramoCor:colors[ramo].cor,ramoBg:colors[ramo].bg}))}})
   }
   const byManager=new Map();for(const item of supervisorGroups){if(!byManager.has(item.managerId))byManager.set(item.managerId,{nome:item.managerName,ini:initials(item.managerName),supervisores:[]});byManager.get(item.managerId).supervisores.push(item.supervisor)}
   const gerentes=[...byManager.values()].map(g=>({...g,resumo:`${g.supervisores.length} supervisora${g.supervisores.length===1?'':'s'} · ${g.supervisores.reduce((n,s)=>n+s.lojas.length,0)} lojas`}));
   return{ramo,ramoCor:colors[ramo].cor,ramoBg:colors[ramo].bg,resumoRamo:`${branchStores.length} lojas · ${money(branchStores.reduce((n,l)=>n+l.real,0))}`,gerentes}
 }).filter(r=>r.gerentes.length||stores.some(s=>s.ramo===r.ramo))
}

function auditView(row,names){
 const table=String(row.tabela||'sistema'),tag=table==='metas'?'Meta':table==='resultados'?'Venda':table==='profiles'?'Acesso':table.includes('loja')?'Loja':'Sistema';
 const palette=tag==='Venda'?{cor:'#C98A2E',bg:'#FFF8E9'}:tag==='Sistema'?{cor:'#1D2430',bg:'#F4F6F8'}:{cor:'#05918C',bg:'#E4F1F0'};
 const action={insert:'cadastrado',update:'atualizado',delete:'removido'}[row.acao]||row.acao;
 return{tag,titulo:`${tag} ${action}`,detalhe:`Registro ${row.registro_id||'—'} · alteração gravada automaticamente.`,quem:names.get(row.usuario_id)||'Sistema',quando:timeAgo(row.em),ip:'Auditoria protegida',cor:palette.cor,tagBg:palette.bg,temValores:false}
}

async function fetchData(){
 const key=monthStart(selected),start=`${selected.slice(0,4)}-01-01`,end=`${selected.slice(0,4)}-12-31`;
 const [storesR,usersR,slR,gsR,goalsR,resultsR,competencesR,rulesR,auditR,yearR,sellersR,sellerRankR]=await Promise.all([
  supabase.from('lojas').select('id,codigo,nome,ativa,ramo,localizacao').order('nome'),
  supabase.from('profiles').select('id,nome,email,login,role,ativo,created_at,updated_at').order('nome'),
  supabase.from('supervisor_lojas').select('supervisor_id,loja_id'),
  supabase.from('gerente_supervisores').select('gerente_id,supervisor_id'),
  supabase.from('metas').select('loja_id,valor_meta').eq('competencia',key),
  supabase.from('resultados').select('loja_id,data,valor_realizado').gte('data',key).lte('data',monthEnd(selected)),
  supabase.from('competencias').select('competencia,dias_uteis,fator_meta2,fator_meta3,fechado,fechado_em').gte('competencia',start).lte('competencia',end).order('competencia'),
  supabase.from('configuracoes_meta').select('dias_semana_uteis,fator_meta2,fator_meta3,crescimento_sugestao,arredondamento_meta').eq('id',true).maybeSingle(),
  supabase.from('log_alteracoes').select('id,tabela,registro_id,acao,valor_anterior,valor_novo,usuario_id,em').order('em',{ascending:false}).limit(30),
  supabase.rpc('resumo_ano',{p_ano:Number(selected.slice(0,4))}),
  supabase.from('vendedoras').select('id,loja_id,nome,cpf,admissao,ativa').order('nome'),
  supabase.rpc('ranking_vendedoras',{p_competencia:key})
 ]);
 const error=[storesR,usersR,slR,gsR,goalsR,resultsR,competencesR,rulesR,auditR,yearR,sellersR,sellerRankR].find(r=>r.error)?.error;if(error)throw error;
 const users=usersR.data||[],links=slR.data||[],managerLinks=gsR.data||[],sellers=sellersR.data||[],goals=new Map((goalsR.data||[]).map(x=>[x.loja_id,Number(x.valor_meta)])),realMap=new Map(),diario={};
 for(const row of resultsR.data||[]){realMap.set(row.loja_id,(realMap.get(row.loja_id)||0)+Number(row.valor_realizado||0));(diario[row.loja_id]||(diario[row.loja_id]=[])).push({data:row.data,valor:Number(row.valor_realizado||0)})}
 const userMap=new Map(users.map(u=>[u.id,u])),supervisorForStore=new Map(links.map(x=>[x.loja_id,x.supervisor_id]));
 const stores=(storesR.data||[]).map(s=>{const sid=supervisorForStore.get(s.id),sup=userMap.get(sid);return{id:s.id,nome:s.nome.toUpperCase(),cod:s.codigo||'—',meta:goals.get(s.id)||0,real:realMap.get(s.id)||0,sup:sup?.nome||null,supervisorId:sid||'',ramo:s.ramo||'Franquias',localizacao:s.localizacao||'',ativa:s.ativa}});
 const activeStores=stores.filter(s=>s.ativa),supervisors=users.filter(u=>u.ativo&&u.role==='supervisor').map(u=>({id:u.id,nome:u.nome,escopo:`${links.filter(x=>x.supervisor_id===u.id).length} lojas`}));
 const linkedCount=id=>links.filter(x=>x.supervisor_id===id).length;
 const uiUsers=users.map(u=>({id:u.id,nome:u.nome,email:u.email,papel:roleText(u.role),role:u.role,login:u.login,escopo:u.role==='administrador'?'Sistema inteiro':u.role==='gerente_comercial'?'Todas as lojas':u.role==='supervisor'?`${linkedCount(u.id)} lojas`:'Aguardando liberação',acesso:timeAgo(u.updated_at||u.created_at),ativo:u.ativo}));
 const yearRows=yearR.data||[],months=yearRows.filter(x=>Number(x.meta)||Number(x.realizado)).map(x=>({nome:new Date(`${x.competencia}T12:00:00`).toLocaleDateString('pt-BR',{month:'short'}).replace('.','').toUpperCase(),meta:Number(x.meta||0),real:Number(x.realizado||0)}));
 const rules={...DEFAULT_RULES,...(rulesR.data||{})},competenceMap=new Map((competencesR.data||[]).map(c=>[c.competencia.slice(0,7),c]));
 const competences=(competencesR.data||[]).map(c=>({mes:new Date(`${c.competencia}T12:00:00`).toLocaleDateString('pt-BR',{month:'long'}).replace(/^./,x=>x.toUpperCase()),dias:String(c.dias_uteis),f2:br(c.fator_meta2),f3:br(c.fator_meta3),situacao:c.fechado?'Fechada':c.competencia.slice(0,7)===selected?'Aberta':'A definir',bg:c.fechado?'#F4F6F8':c.competencia.slice(0,7)===selected?'#E4F1F0':'#FFF8E9',cor:c.fechado?'#5B6675':c.competencia.slice(0,7)===selected?'#0A5F5C':'#8A6420'}));
 const selectedConfig=competenceMap.get(selected),today=new Date(),daysTotal=Number(selectedConfig?.dias_uteis||26);let daysWorked=daysTotal;
 if(selected===today.toLocaleDateString('en-CA').slice(0,7)){daysWorked=0;for(let d=1;d<=today.getDate();d++){const day=new Date(today.getFullYear(),today.getMonth(),d).getDay()||7;if(rules.dias_semana_uteis.includes(day))daysWorked++}}
 if(selected>today.toLocaleDateString('en-CA').slice(0,7))daysWorked=1;
 const orphan=activeStores.filter(s=>!s.supervisorId),names=new Map(users.map(u=>[u.id,u.nome])),audit=(auditR.data||[]).map(row=>auditView(row,names));
 const missingGoals=activeStores.filter(s=>!s.meta).length,pending=[];
 if(orphan.length)pending.push({n:String(orphan.length),titulo:'Lojas sem supervisor vinculado',texto:orphan.map(s=>`${s.nome} (${s.cod})`).join(', '),acao:'Vincular',cor:'#CD4664',bg:'#FDF1F3',bgHover:'#FBE7EB',pagina:'estrutura'});
 if(missingGoals)pending.push({n:String(missingGoals),titulo:'Lojas sem meta nesta competência',texto:'Cadastre as metas para completar o acompanhamento da rede.',acao:'Revisar',cor:'#C98A2E',bg:'#FFF8E9',bgHover:'#FFF3D8',pagina:'lojas'});
 const activeUsers=users.filter(u=>u.ativo).length,sellerStore=new Map(sellers.map(s=>[s.id,s.loja_id]));
 const sellerPerformance=(sellerRankR.data||[]).map(v=>({id:v.vendedora_id,lojaId:sellerStore.get(v.vendedora_id)||'',nome:v.nome,loja:v.loja_nome,meta:Number(v.meta||0),real:Number(v.realizado||0),atend:Number(v.ticket_medio)?Math.round(Number(v.realizado||0)/Number(v.ticket_medio)):0}));
 const storedPhoto=localStorage.getItem(`metasdd.profile-photo.${profile.id}`);
 dataCache={profile,foto:storedPhoto||null,competencia:selected,competenciaLabel:monthLabel(selected),pagina:sessionStorage.getItem('metasdd.admin.pagina')||'inicio',diasMes:daysTotal,diasTrab:Math.max(daysWorked,1),lojas:activeStores,meses:months,usuarios:uiUsers,supervisores:supervisors,arvore:buildTree(activeStores,users,links,managerLinks),orfas:orphan.map(s=>({id:s.id,cod:s.cod,nome:s.nome})),lojasResumo:activeStores.map(s=>({id:s.id,nome:s.nome,cod:s.cod,cor:s.supervisorId?'#05918C':'#CD4664'})),competencias,auditoria,auditoriaResumo:audit.slice(0,4).map(a=>({texto:a.titulo,quem:a.quem,quando:a.quando,cor:a.cor})),correcoes:[],diario,vendedoras:sellerPerformance,historico:{},regras:{fator2:br(rules.fator_meta2),fator3:br(rules.fator_meta3)},rulesRaw:rules,links,managerLinks,rawUsers:users,rawStores:storesR.data||[],rawSellers:sellers,selectedConfig,saude:[{rot:'Usuários ativos',valor:String(activeUsers),sub:`${users.length-activeUsers} acesso(s) inativo(s)`,cor:'#05918C',corVal:'#1B2129',bg:'#fff',borda:'#EDEFF3'},{rot:'Lojas sem supervisor',valor:String(orphan.length),sub:orphan.length?'precisam de vínculo':'estrutura completa',cor:orphan.length?'#CD4664':'#05918C',corVal:orphan.length?'#CD4664':'#1B2129',bg:orphan.length?'#FDF1F3':'#fff',borda:orphan.length?'#F6D9E0':'#EDEFF3'},{rot:'Competência',valor:selectedConfig?.fechado?'Fechada':'Aberta',sub:monthLabel(selected),cor:selectedConfig?.fechado?'#5B6675':'#05918C',corVal:'#1B2129',bg:'#fff',borda:'#EDEFF3'},{rot:'Lojas sem meta',valor:String(missingGoals),sub:missingGoals?'aguardando definição':'metas completas',cor:missingGoals?'#C98A2E':'#05918C',corVal:'#1B2129',bg:'#fff',borda:'#EDEFF3'}],pendencias:pending,checklistFechamento:[{rot:`${activeStores.length-missingGoals} de ${activeStores.length} lojas têm meta`,marca:missingGoals?'':'✓',bg:missingGoals?'#fff':'#05918C',borda:missingGoals?'#CD4664':'#05918C',cor:missingGoals?'#CD4664':'#5B6675'},{rot:'Lançamentos do mês revisados',marca:'',bg:'#fff',borda:'#C98A2E',cor:'#8A6420'},{rot:'Nenhuma correção pendente',marca:'✓',bg:'#05918C',borda:'#05918C',cor:'#5B6675'}]};
 localStorage.setItem('metasdd.admin.v1',JSON.stringify(dataCache));return dataCache
}

async function reload(page){
 if(page)sessionStorage.setItem('metasdd.admin.pagina',page);loading.classList.remove('hide');frame.classList.remove('ready');await fetchData();frame.src=`./Painel%20Admin%20D%26D.dc.html?v=${Date.now()}`
}

function userByElement(el){const text=el?.textContent||'';return dataCache?.rawUsers.find(u=>text.includes(u.email))||dataCache?.rawUsers.find(u=>text.includes(u.nome))}
function storeByElement(el){const text=el?.textContent||'';return dataCache?.rawStores.find(s=>text.toUpperCase().includes(String(s.nome).toUpperCase()))}
function ancestorWithData(el,kind){let node=el;for(let i=0;i<7&&node;i++,node=node.parentElement){const found=kind==='user'?userByElement(node):storeByElement(node);if(found)return{node,item:found}}return null}

function openUser(user=null){
 $('#userForm').reset();$('#userId').value=user?.id||'';$('#userDialogTitle').textContent=user?'Gerenciar acesso':'Cadastrar usuário';$('#userDialogSubtitle').textContent=user?user.email:'Crie o acesso e defina a responsabilidade da pessoa.';$('#userName').value=user?.nome||'';$('#userEmail').value=user?.email||'';$('#userEmail').disabled=!!user;$('#userLogin').value=user?.login||'';$('#userRole').value=user?.role||'supervisor';$('#userActive').checked=user?!!user.ativo:true;$('#passwordField').style.display=user?'none':'block';$('#userPassword').required=!user;$('#activeField').style.display=user?'flex':'none';$('#userSubmit').textContent=user?'Salvar alterações':'Cadastrar usuário';const self=user?.id===profile.id;$('#userRole').disabled=self;$('#userActive').disabled=self;$('#userDialog').showModal();setTimeout(()=>$('#userName').focus(),60)
}

function openStore(store=null){
 $('#storeForm').reset();$('#storeId').value=store?.id||'';$('#storeDialogTitle').textContent=store?'Editar loja':'Cadastrar loja';$('#storeName').value=store?.nome||'';$('#storeCode').value=store?.codigo||'';$('#storeBranch').value=store?.ramo||'Franquias';$('#storeLocation').value=store?.localizacao||'';$('#storeActive').checked=store?!!store.ativa:true;$('#storeActiveField').style.display=store?'flex':'none';$('#storeSupervisor').innerHTML='<option value="">Sem supervisor por enquanto</option>'+dataCache.supervisores.map(s=>`<option value="${s.id}">${esc(s.nome)} · ${esc(s.escopo)}</option>`).join('');const link=dataCache.links.find(x=>x.loja_id===store?.id);$('#storeSupervisor').value=link?.supervisor_id||'';$('#storeSubmit').textContent=store?'Salvar loja':'Cadastrar e vincular';$('#storeDialog').showModal();setTimeout(()=>$('#storeName').focus(),60)
}

function openRules(){const r=dataCache.rulesRaw;$('#factor2').value=br(r.fator_meta2);$('#factor3').value=br(r.fator_meta3);$('#growth').value=br(r.crescimento_sugestao);$('#rounding').value=String(r.arredondamento_meta);const labels=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];$('#weekdays').innerHTML=labels.map((label,i)=>`<label class="weekday"><input type="checkbox" value="${i+1}" ${r.dias_semana_uteis.includes(i+1)?'checked':''}>${label}</label>`).join('');$('#rulesDialog').showModal()}
function openSeller(store=null){$('#sellerForm').reset();$('#sellerStore').innerHTML=dataCache.rawStores.filter(s=>s.ativa).map(s=>`<option value="${s.id}">${esc(s.codigo?s.codigo+' — ':'')}${esc(s.nome)}</option>`).join('');if(store?.id)$('#sellerStore').value=store.id;$('#sellerDialog').showModal();setTimeout(()=>$('#sellerName').focus(),60)}

function textChain(target){const chain=[];let node=target;for(let i=0;i<5&&node;i++,node=node.parentElement){const t=(node.textContent||'').replace(/\s+/g,' ').trim();if(t&&!chain.includes(t))chain.push(t)}return chain}

async function handleFrameClick(event){
 const target=event.target,chain=textChain(target),exact=x=>chain.includes(x),starts=x=>chain.find(t=>t.startsWith(x));let handled=true;
 const pageMap={'Visão geral':'inicio','Lojas':'lojas','Desempenho':'desempenho','Usuários':'usuarios','Estrutura':'estrutura','Competências':'competencias','Auditoria':'auditoria','Preferências':'config'};
 for(const[label,id]of Object.entries(pageMap))if(chain.some(t=>t===label||t.startsWith(label+' '))){sessionStorage.setItem('metasdd.admin.pagina',id);break}
 try{
  if(exact('Abrir painel'))location.href='./dashboard.html';
  else if(exact('Cadastrar usuário')||exact('+ Cadastrar usuário'))openUser();
  else if(exact('Cadastrar loja')||exact('+ Cadastrar loja')||exact('Cadastrar e vincular'))openStore();
  else if(exact('+ Cadastrar')||exact('Cadastrar')){const found=ancestorWithData(target,'store');openSeller(found?.item||null)}
  else if(exact('Editar loja')){const found=ancestorWithData(target,'store');found?openStore(found.item):toast('Abra a loja desejada antes de editar.',true)}
  else if(exact('Editar')){const found=ancestorWithData(target,'user');found?openUser(found.item):handled=false}
  else if(exact('Ativar')||exact('Reativar')||exact('Desativar')){const found=ancestorWithData(target,'user');if(!found)throw new Error('Usuário não identificado.');await toggleUser(found.item)}
  else if(exact('Reenviar')){const found=ancestorWithData(target,'user');if(!found)throw new Error('Usuário não identificado.');await resendUser(found.item)}
  else if(exact('Sair do painel')){await supabase.auth.signOut({scope:'local'});location.replace('./login.html')}
  else if(exact('Editar meus dados'))openUser(dataCache.rawUsers.find(u=>u.id===profile.id));
  else if(exact('Fechar competência')||exact('Fechar mês'))await closeCompetence();
  else if(exact('Ajustar'))await reload('competencias');
  else if(exact('Reabrir mês…'))await reopenCompetence();
  else if(exact('Exportar registro'))downloadAudit();
  else if(exact('Exportar'))downloadStores();
  else if(exact('Excel'))downloadAll();
  else if(exact('PDF'))frame.contentWindow?.print();
  else if(exact('Lançar venda')){sessionStorage.setItem('metasdd.page','Lançar vendas');location.href='./dashboard.html'}
  else if(exact('Vincular')||exact('Vincular →')){const found=ancestorWithData(target,'store');openStore(found?.item||null)}
  else if(exact('Desvincular'))await unlinkManager(target);
  else if(exact('×')){const chip=target.parentElement,store=chip&&chip.children.length<=2?storeByElement(chip):null;if(store)openStore(store);else handled=false}
  else if(starts(monthLabel(selected))){$('#monthInput').value=selected;$('#monthDialog').showModal()}
  else if(chain.some(t=>t.includes('Regras gerais'))&&chain.some(t=>t.includes('Fator padrão da Meta 2')))openRules();
  else handled=false;
 }catch(error){console.error(error);toast(error.message||String(error),true)}
 if(handled){event.preventDefault();event.stopImmediatePropagation()}
}

async function toggleUser(user){if(user.id===profile.id)throw new Error('Seu próprio acesso de administrador é protegido.');const next=!user.ativo;if(!confirm(`${next?'Ativar':'Desativar'} o acesso de ${user.nome}?`))return;const{data,error}=await supabase.functions.invoke('admin-update-user',{body:{user_id:user.id,nome:user.nome,login:user.login,role:user.role,ativo:next}});if(error||data?.error)throw new Error(data?.error||error?.message);toast(`Acesso de ${user.nome} ${next?'ativado':'desativado'}.`);await reload('usuarios')}
async function resendUser(user){const redirect_to=`${location.origin}${location.pathname.replace(/admin\.html.*$/,'reset-password.html')}`;const{data,error}=await supabase.functions.invoke('admin-reset-password',{body:{user_id:user.id,redirect_to}});if(error||data?.error)throw new Error(data?.error||error?.message);toast(`E-mail de acesso enviado para ${data.email||user.email}.`)}
async function unlinkManager(target){const found=ancestorWithData(target,'user');if(!found)throw new Error('Supervisor não identificado.');const link=dataCache.managerLinks.find(x=>x.supervisor_id===found.item.id);if(!link)return toast('Este supervisor não possui gerente vinculado.');if(!confirm(`Desvincular ${found.item.nome} do gerente atual?`))return;const{error}=await supabase.rpc('desvincular_gerente_supervisor',{p_gerente_id:link.gerente_id,p_supervisor_id:link.supervisor_id});if(error)throw error;toast('Vínculo gerencial removido.');await reload('estrutura')}

async function closeCompetence(){if(dataCache.selectedConfig?.fechado)return toast('Esta competência já está fechada.');if(!confirm(`Fechar ${monthLabel(selected)}? Metas e vendas desse período serão bloqueadas.`))return;const{error}=await supabase.rpc('fechar_competencia',{p_competencia:monthStart(selected)});if(error)throw error;toast(`${monthLabel(selected)} foi fechada.`);await reload('competencias')}
async function reopenCompetence(){if(!dataCache.selectedConfig?.fechado)return toast('Esta competência já está aberta.');const typed=prompt(`Para reabrir, digite ${monthLabel(selected)}:`);if(String(typed||'').trim().toUpperCase()!==monthLabel(selected))return toast('Confirmação cancelada.',true);const{error}=await supabase.from('competencias').update({fechado:false,fechado_em:null,fechado_por:null}).eq('competencia',monthStart(selected));if(error)throw error;toast(`${monthLabel(selected)} foi reaberta e a ação ficou na auditoria.`);await reload('competencias')}

function download(name,rows){const blob=new Blob([new Uint8Array([0xEF,0xBB,0xBF]),rows.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}
function downloadAudit(){const rows=[['Data','Tipo','Ação','Registro','Responsável'].map(csvCell).join(';'),...(dataCache.auditoria||[]).map(a=>[a.quando,a.tag,a.titulo,a.detalhe,a.quem].map(csvCell).join(';'))];download(`auditoria-${selected}.csv`,rows);toast('Registro de auditoria exportado.')}
function downloadStores(){const rows=[['LOJA','CÓDIGO','RAMO','SUPERVISOR','META','REALIZADO'].map(csvCell).join(';'),...dataCache.lojas.map(l=>[l.nome,l.cod,l.ramo,l.sup||'Sem supervisor',l.meta,l.real].map(csvCell).join(';'))];download(`lojas-${selected}.csv`,rows);toast('Lista de lojas exportada.')}
function downloadAll(){const rows=[['RELATÓRIO ADMINISTRATIVO',monthLabel(selected)].map(csvCell).join(';'),'',['LOJA','CÓDIGO','RAMO','SUPERVISOR','META','REALIZADO'].map(csvCell).join(';'),...dataCache.lojas.map(l=>[l.nome,l.cod,l.ramo,l.sup||'Sem supervisor',l.meta,l.real].map(csvCell).join(';')),'',['USUÁRIO','E-MAIL','PERFIL','ATIVO'].map(csvCell).join(';'),...dataCache.usuarios.map(u=>[u.nome,u.email,u.papel,u.ativo?'Sim':'Não'].map(csvCell).join(';'))];download(`administracao-dd-${selected}.csv`,rows);toast('Arquivo completo exportado.')}

$('#userForm').onsubmit=async event=>{
 event.preventDefault();const id=$('#userId').value,button=$('#userSubmit'),message=$('#userMessage');message.textContent='';setBusy(button,true,id?'Salvando…':'Cadastrando…');
 try{const payload={nome:$('#userName').value.trim(),login:$('#userLogin').value.trim().toLowerCase(),role:$('#userRole').value,ativo:id===profile.id?true:$('#userActive').checked};let response;if(id)response=await supabase.functions.invoke('admin-update-user',{body:{...payload,user_id:id}});else response=await supabase.functions.invoke('admin-create-user',{body:{...payload,email:$('#userEmail').value.trim().toLowerCase(),password:$('#userPassword').value}});if(response.error||response.data?.error)throw new Error(response.data?.error||response.error?.message);closeDialog('userDialog');toast(id?'Acesso atualizado e registrado.':'Usuário cadastrado com sucesso.');await reload('usuarios')}catch(error){message.textContent=error.message||String(error)}finally{setBusy(button,false)}
};

$('#storeForm').onsubmit=async event=>{
 event.preventDefault();const id=$('#storeId').value,button=$('#storeSubmit'),message=$('#storeMessage');message.textContent='';setBusy(button,true);
 try{const payload={nome:$('#storeName').value.trim(),codigo:$('#storeCode').value.trim()||null,ramo:$('#storeBranch').value,localizacao:$('#storeLocation').value.trim()||null,ativa:id?$('#storeActive').checked:true};let storeId=id;if(id){const{error}=await supabase.from('lojas').update(payload).eq('id',id);if(error)throw error}else{const{data,error}=await supabase.from('lojas').insert(payload).select('id').single();if(error)throw error;storeId=data.id}const current=dataCache.links.find(x=>x.loja_id===storeId),supervisorId=$('#storeSupervisor').value;if(current&&current.supervisor_id!==supervisorId){const{error}=await supabase.rpc('desvincular_supervisor_loja',{p_supervisor_id:current.supervisor_id,p_loja_id:storeId});if(error)throw error}if(supervisorId&&current?.supervisor_id!==supervisorId){const{error}=await supabase.from('supervisor_lojas').upsert({supervisor_id:supervisorId,loja_id:storeId},{onConflict:'supervisor_id,loja_id',ignoreDuplicates:true});if(error)throw error}closeDialog('storeDialog');toast(id?'Loja atualizada.':'Loja cadastrada e vinculada.');await reload('estrutura')}catch(error){message.textContent=error.message||String(error)}finally{setBusy(button,false)}
};

$('#monthForm').onsubmit=async event=>{event.preventDefault();selected=$('#monthInput').value;localStorage.setItem('metasdd.admin.competencia',selected);localStorage.setItem('metasdd.competencia',selected);closeDialog('monthDialog');await reload(sessionStorage.getItem('metasdd.admin.pagina')||'inicio')};

$('#sellerForm').onsubmit=async event=>{event.preventDefault();const button=$('#sellerSubmit'),message=$('#sellerMessage');message.textContent='';setBusy(button,true);try{const payload={loja_id:$('#sellerStore').value,nome:$('#sellerName').value.trim(),cpf:$('#sellerCpf').value.replace(/\D/g,'')||null,admissao:$('#sellerAdmission').value||null,ativa:true};const{error}=await supabase.from('vendedoras').insert(payload);if(error)throw error;closeDialog('sellerDialog');toast('Vendedora cadastrada na loja.');await reload('desempenho')}catch(error){message.textContent=error.message||String(error)}finally{setBusy(button,false)}};

$('#rulesForm').onsubmit=async event=>{
 event.preventDefault();const button=$('#rulesSubmit'),message=$('#rulesMessage');message.textContent='';setBusy(button,true);
 try{const parse=v=>Number(String(v).replace(',','.')),days=[...$('#weekdays').querySelectorAll('input:checked')].map(i=>Number(i.value));if(!days.length)throw new Error('Escolha pelo menos um dia útil.');const payload={id:true,dias_semana_uteis:days,fator_meta2:parse($('#factor2').value),fator_meta3:parse($('#factor3').value),crescimento_sugestao:parse($('#growth').value),arredondamento_meta:Number($('#rounding').value),atualizado_por:profile.id};const{error}=await supabase.from('configuracoes_meta').upsert(payload,{onConflict:'id'});if(error)throw error;closeDialog('rulesDialog');toast('Regras atualizadas para toda a rede.');await reload('config')}catch(error){message.textContent=error.message||String(error)}finally{setBusy(button,false)}
};

frame.addEventListener('load',()=>{
 loading.classList.add('hide');frame.classList.add('ready');const doc=frame.contentDocument;if(!doc)return;doc.addEventListener('click',handleFrameClick,true);doc.addEventListener('click',event=>{const nav=['Visão geral','Lojas','Desempenho','Usuários','Estrutura','Competências','Auditoria','Preferências'];const text=(event.target.closest('div')?.textContent||'').trim();const map={'Visão geral':'inicio','Lojas':'lojas','Desempenho':'desempenho','Usuários':'usuarios','Estrutura':'estrutura','Competências':'competencias','Auditoria':'auditoria','Preferências':'config'};if(nav.includes(text))sessionStorage.setItem('metasdd.admin.pagina',map[text])},true)
});

function realtime(){const schedule=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>reload(sessionStorage.getItem('metasdd.admin.pagina')||'inicio').catch(error=>toast(error.message||String(error),true)),800)};return supabase.channel(`admin-dd-${profile.id}`).on('postgres_changes',{event:'*',schema:'public',table:'lojas'},schedule).on('postgres_changes',{event:'*',schema:'public',table:'profiles'},schedule).on('postgres_changes',{event:'*',schema:'public',table:'metas'},schedule).on('postgres_changes',{event:'*',schema:'public',table:'resultados'},schedule).on('postgres_changes',{event:'*',schema:'public',table:'competencias'},schedule).on('postgres_changes',{event:'*',schema:'public',table:'supervisor_lojas'},schedule).on('postgres_changes',{event:'*',schema:'public',table:'configuracoes_meta'},schedule).subscribe()}

try{
 const ctx=await getSessionProfile();session=ctx.session;profile=ctx.profile;if(!session||!profile?.ativo){location.replace('./login.html');throw new Error('Sessão inválida.')}if(profile.role!=='administrador'){location.replace('./dashboard.html');throw new Error('O painel administrativo é exclusivo do Administrador.')}const requested=location.hash.slice(1);if(['inicio','lojas','desempenho','usuarios','estrutura','competencias','auditoria','config'].includes(requested))sessionStorage.setItem('metasdd.admin.pagina',requested);selected=await resolveMonth();localStorage.setItem('metasdd.admin.competencia',selected);await reload();realtime()
}catch(error){console.error(error);loading.textContent=error.message||'Não foi possível abrir a administração.';toast(error.message||String(error),true)}
