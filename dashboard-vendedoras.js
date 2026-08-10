Exit code: 0
Wall time: 1.6 seconds
Output:
import {supabase,getSessionProfile} from './supabase-client.js';
const frame=document.querySelector('#panel'),status=document.querySelector('#status');
const toast=(t,k='ok')=>{if(!status)return;status.textContent=t;status.dataset.kind=k;status.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>status.classList.remove('on'),3000)};
let profile=null,stores=[];
async function loadStores(){
 const {data,error}=await supabase.from('lojas').select('id,nome').eq('ativa',true).order('nome');if(error)throw error;stores=data||[];return stores;
}
async function populateStores(doc){
 const select=doc.querySelector('[data-seller-store]');if(!select)return;if(!stores.length)await loadStores();const current=select.value,placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent=stores.length?'Selecione uma loja':'Nenhuma loja disponível';select.replaceChildren(placeholder);for(const store of stores){const option=doc.createElement('option');option.value=store.id;option.textContent=store.nome;select.appendChild(option)}if(stores.some(store=>store.id===current))select.value=current;
}
async function saveSeller(doc){
 const screen=doc.querySelector('[data-screen-label="Ranking"]');if(!screen)return;
 const nomeI=screen.querySelector('[data-seller-name]'),lojaI=screen.querySelector('[data-seller-store]');if(!nomeI||!lojaI)throw new Error('Abra o formulário Nova vendedora.');
 const nome=nomeI.value.trim().replace(/\s+/g,' '),lojaId=lojaI.value;if(nome.split(' ').filter(Boolean).length<2){nomeI.focus();throw new Error('Informe o nome completo da vendedora.')}if(!lojaId){lojaI.focus();throw new Error('Selecione uma loja.')}if(!stores.length)await loadStores();const loja=stores.find(item=>item.id===lojaId);if(!loja)throw new Error('Essa loja não está disponível para o seu perfil.');
 const {error}=await supabase.from('vendedoras').insert({loja_id:loja.id,nome,ativa:true});if(error)throw error;
 toast('Vendedora cadastrada. Atualizando ranking…');window.dispatchEvent(new CustomEvent('metasdd:refresh',{detail:{page:'Ranking'}}));
}
async function wire(){const ctx=await getSessionProfile();profile=ctx.profile;if(!profile||profile.role==='gerente_comercial')return;const doc=frame.contentDocument;if(!doc?.body)return;await loadStores();populateStores(doc).catch(console.error);doc.addEventListener('click',async e=>{const el=e.target.closest('div,span'),t=(el?.textContent||'').trim();if(t==='Adicionar vendedora'){setTimeout(()=>populateStores(doc).catch(err=>{console.error(err);toast(err.message||String(err),'error')}),40);return}if(t!=='Salvar vendedora')return;e.preventDefault();e.stopImmediatePropagation();try{await saveSeller(doc)}catch(err){console.error(err);toast(err.message||String(err),'error')}},true)}
frame.addEventListener('load',()=>setTimeout(wire,220));
