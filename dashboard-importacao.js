Exit code: 0
Wall time: 1.6 seconds
Output:
import {supabase,getSessionProfile} from './supabase-client.js';

const frame=document.querySelector('#panel'),status=document.querySelector('#status');
const selected=()=>localStorage.getItem('metasdd.competencia')||`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
const toast=(t,k='ok')=>{status.textContent=t;status.dataset.kind=k;status.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>status.classList.remove('on'),4000)};
const parseMoney=v=>{let s=String(v??'').trim().replace(/R\$/gi,'').replace(/\s/g,'');if(!s)return NaN;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)};
function csv(line,del){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(c===del&&!q){out.push(cur.trim());cur=''}else cur+=c}out.push(cur.trim());return out}

let modal=null,state={profile:null,payload:[],busy:false,returnFocus:null};
function ensureModal(){
 if(modal)return modal;
 modal=document.createElement('div');modal.id='importOverlay';modal.className='import-overlay';modal.setAttribute('aria-hidden','true');
 modal.innerHTML=`<section class="import-modal" role="dialog" aria-modal="true" aria-labelledby="importTitle">
  <header class="import-head"><div><h2 id="importTitle">Importar vendas</h2><p>Cole os dados ou selecione um arquivo TXT/CSV. Colunas esperadas: código da loja, data, valor e atendimentos.</p></div><button class="import-close" type="button" aria-label="Fechar">×</button></header>
  <label class="import-label" for="importRaw">Dados da planilha</label>
  <textarea id="importRaw" class="import-textarea" spellcheck="false" placeholder="117&#9;2026-08-08&#9;8212,00&#9;63"></textarea>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;flex-wrap:wrap"><span style="font:500 10.5px/1.4 Inter,sans-serif;color:#8D9997">Aceita TXT e CSV com tabulação, ponto e vírgula ou vírgula.</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="importModelButton" class="import-secondary" type="button" style="border:0;border-radius:10px;padding:9px 13px;font-weight:700;cursor:pointer">Baixar modelo padrão</button><button id="importFileButton" class="import-secondary" type="button" style="border:0;border-radius:10px;padding:9px 13px;font-weight:700;cursor:pointer">Selecionar arquivo</button></div><input id="importFile" type="file" accept=".csv,.txt,text/csv,text/plain" hidden></div>
  <div id="importPreview" class="import-preview" aria-live="polite"></div>
  <footer class="import-actions"><button id="importCancel" class="import-secondary" type="button">Cancelar</button><button id="importAnalyze" class="import-secondary" type="button">Analisar dados</button><button id="importConfirm" class="import-primary" type="button" disabled>Confirmar importação</button></footer>
 </section>`;
 document.body.appendChild(modal);
 const raw=modal.querySelector('#importRaw'),file=modal.querySelector('#importFile');
 modal.querySelector('.import-close').onclick=closeModal;modal.querySelector('#importCancel').onclick=closeModal;
 modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});
  modal.querySelector('#importFileButton').onclick=()=>file.click();
  modal.querySelector('#importModelButton').onclick=()=>downloadModel().catch(error=>{console.error(error);toast(error.message||String(error),'error')});
 file.onchange=async()=>{const chosen=file.files?.[0];if(!chosen)return;raw.value=await chosen.text();invalidatePreview();raw.focus()};
 raw.addEventListener('input',invalidatePreview);
 raw.addEventListener('dragover',e=>{e.preventDefault();raw.style.borderColor='#05918C'});
 raw.addEventListener('dragleave',()=>raw.style.borderColor='');
 raw.addEventListener('drop',async e=>{e.preventDefault();raw.style.borderColor='';const chosen=e.dataTransfer?.files?.[0];if(chosen){raw.value=await chosen.text();invalidatePreview()}});
 modal.querySelector('#importAnalyze').onclick=analyzeImport;
 modal.querySelector('#importConfirm').onclick=commitImport;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('open'))closeModal()});
 return modal;
}
async function downloadModel(){
 const month=selected(),{data,error}=await supabase.from('lojas').select('codigo').eq('ativa',true).order('nome').limit(1);if(error)throw error;const code=String(data?.[0]?.codigo||'CODIGO_DA_LOJA'),content=`codigo_loja;data;valor;atendimentos\r\n${code};${month}-01;8212,00;63\r\n`,blob=new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`modelo-importacao-vendas-${month}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);toast('Modelo padrão baixado.');
}
function openModal(profile,trigger){
 const root=ensureModal();state={profile,payload:[],busy:false,returnFocus:trigger||null};
 root.querySelector('#importRaw').value='';root.querySelector('#importFile').value='';invalidatePreview();
 root.classList.add('open');root.setAttribute('aria-hidden','false');setTimeout(()=>root.querySelector('#importRaw').focus(),0);
}
function closeModal(){
 if(!modal||state.busy)return;modal.classList.remove('open');modal.setAttribute('aria-hidden','true');state.returnFocus?.focus?.();
}
function invalidatePreview(){
 if(!modal)return;state.payload=[];const preview=modal.querySelector('#importPreview');preview.className='import-preview';preview.replaceChildren();modal.querySelector('#importConfirm').disabled=true;
}
function setBusy(busy,label){
 state.busy=busy;for(const button of modal.querySelectorAll('button'))button.disabled=busy;
 modal.querySelector('#importConfirm').textContent=label||'Confirmar importação';
 if(!busy)modal.querySelector('#importAnalyze').disabled=false;
}
function parseRaw(raw){
 const lines=raw.trim().split(/\r?\n/).filter(Boolean);if(!lines.length)return[];
 const del=lines[0].includes('\t')?'\t':lines[0].includes(';')?';':',';
 const rows=lines.map(line=>csv(line,del));if(/c[oó]digo|loja/i.test(rows[0]?.join(' ')||''))rows.shift();return rows;
}
async function validateRaw(raw){
 const rows=parseRaw(raw),{data:stores,error}=await supabase.from('lojas').select('id,codigo,nome').eq('ativa',true);if(error)throw error;
 const codes=new Set((stores||[]).map(s=>String(s.codigo||''))),month=selected(),errors=[],payload=[];
 rows.forEach((r,i)=>{const[codigo,data,valor,atendimentos]=r,c=String(codigo||'').trim(),v=parseMoney(valor),a=atendimentos==null||atendimentos===''?null:Number(String(atendimentos).replace(/\D/g,''));if(!codes.has(c))errors.push(`Linha ${i+1}: loja ${c||'sem código'} não encontrada`);else if(!/^\d{4}-\d{2}-\d{2}$/.test(data||'')||!String(data).startsWith(month+'-'))errors.push(`Linha ${i+1}: data inválida ou fora de ${month}`);else if(!Number.isFinite(v)||v<0)errors.push(`Linha ${i+1}: valor inválido`);else if(a!=null&&(!Number.isFinite(a)||a<0))errors.push(`Linha ${i+1}: atendimentos inválidos`);else payload.push({codigo:c,data,valor:v,atendimentos:a})});
 return{errors,payload};
}
function renderValidation({errors,payload}){
 const preview=modal.querySelector('#importPreview');preview.replaceChildren();preview.className='import-preview open'+(errors.length?' error':'');
 const title=document.createElement('strong');title.textContent=errors.length?`${errors.length} problema(s) encontrado(s)`:`${payload.length} linha(s) pronta(s) para importar`;preview.appendChild(title);
 if(errors.length){const list=document.createElement('ul');list.style.margin='0';list.style.paddingLeft='18px';for(const error of errors.slice(0,12)){const li=document.createElement('li');li.textContent=error;list.appendChild(li)}if(errors.length>12){const li=document.createElement('li');li.textContent=`… e mais ${errors.length-12}`;list.appendChild(li)}preview.appendChild(list);return}
 const table=document.createElement('table');table.className='import-table';table.innerHTML='<thead><tr><th>Loja</th><th>Data</th><th>Valor</th><th>Atend.</th></tr></thead>';const body=document.createElement('tbody');
 for(const row of payload.slice(0,8)){const tr=document.createElement('tr');for(const value of [row.codigo,row.data,row.valor.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),row.atendimentos??'—']){const td=document.createElement('td');td.textContent=String(value);tr.appendChild(td)}body.appendChild(tr)}table.appendChild(body);preview.appendChild(table);
 if(payload.length>8){const note=document.createElement('div');note.style.marginTop='9px';note.textContent=`Mais ${payload.length-8} linha(s) serão importadas.`;preview.appendChild(note)}
}
async function analyzeImport(){
 const raw=modal.querySelector('#importRaw').value;if(!raw.trim()){toast('Cole os dados ou selecione um arquivo.','warn');modal.querySelector('#importRaw').focus();return}
 setBusy(true,'Analisando…');try{const result=await validateRaw(raw);state.payload=result.payload;renderValidation(result);modal.querySelector('#importConfirm').disabled=!!result.errors.length||!result.payload.length}catch(err){console.error(err);toast(err.message||String(err),'error')}finally{state.busy=false;modal.querySelector('.import-close').disabled=false;modal.querySelector('#importCancel').disabled=false;modal.querySelector('#importAnalyze').disabled=false;modal.querySelector('#importConfirm').textContent='Confirmar importação'}
}
async function commitImport(){
 if(!state.payload.length||state.busy)return;setBusy(true,'Importando…');
 try{const month=selected(),{data:st,error:se}=await supabase.from('importacao_staging').insert({competencia:`${month}-01`,origem:'planilha',payload:state.payload,criado_por:state.profile.id}).select('id').single();if(se)throw se;const{data:res,error:pe}=await supabase.rpc('processar_importacao',{p_id:st.id});if(pe)throw pe;if(Number(res?.rejeitadas||0)>0)throw new Error(`${res.rejeitadas} linha(s) foram rejeitadas no processamento.`);toast(`${res?.processadas||state.payload.length} linha(s) importadas.`);state.busy=false;closeModal();window.dispatchEvent(new CustomEvent('metasdd:refresh',{detail:{page:'Lançar vendas'}}))}catch(err){console.error(err);state.busy=false;setBusy(false);toast(err.message||String(err),'error')}
}
async function wire(){
 const{profile}=await getSessionProfile();if(!profile||profile.role==='gerente_comercial')return;const doc=frame.contentDocument;if(!doc?.body)return;
 doc.addEventListener('click',e=>{const el=e.target.closest('[data-import-open],div,span'),t=(el?.textContent||'').trim();if(!el?.matches('[data-import-open]')&&t!=='Importar'&&t!=='Importar planilha')return;e.preventDefault();e.stopImmediatePropagation();openModal(profile,el)},true);
}
frame.addEventListener('load',()=>setTimeout(()=>wire().catch(console.error),200));
