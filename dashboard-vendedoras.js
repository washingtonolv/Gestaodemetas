import {supabase,getSessionProfile} from './supabase-client.js';
const frame=document.querySelector('#panel'),status=document.querySelector('#status');
const parse=v=>{let s=String(v??'').trim().replace(/\s/g,'').replace(/R\$/gi,'').replace(/[^0-9,.-]/g,'');if(!s)return 0;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)||0};
const selected=()=>localStorage.getItem('metasdd.competencia')||`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
const toast=(t,k='ok')=>{if(!status)return;status.textContent=t;status.dataset.kind=k;status.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>status.classList.remove('on'),3000)};
let profile=null;
async function saveSeller(doc){
 const screen=doc.querySelector('[data-screen-label="Ranking"]');if(!screen)return;
 const inputs=[...screen.querySelectorAll('input')];if(inputs.length<5)throw new Error('Abra o formulário Nova vendedora e preencha os dados.');
 const [nomeI,lojaI,metaI,vendaI,ticketI,admI]=inputs.slice(-6),nome=nomeI?.value?.trim(),lojaNome=lojaI?.value?.trim();if(!nome||!lojaNome)throw new Error('Informe nome e loja.');
 const {data:lojas,error:le}=await supabase.from('lojas').select('id,nome').eq('ativa',true);if(le)throw le;const loja=(lojas||[]).find(x=>x.nome.toLocaleLowerCase('pt-BR')===lojaNome.toLocaleLowerCase('pt-BR'));if(!loja)throw new Error('Loja não encontrada. Digite o nome exatamente como cadastrado.');
 const cpf=prompt('CPF da vendedora (opcional):','')||null,admissao=admI?.value?.trim()||null,meta=parse(metaI?.value),venda=parse(vendaI?.value),ticket=parse(ticketI?.value);
 const {data:v,error:ve}=await supabase.from('vendedoras').insert({loja_id:loja.id,nome,cpf:cpf?.replace(/\D/g,'')||null,admissao:admissao||null,ativa:true}).select('id').single();if(ve)throw ve;
 if(meta>0){const{error}=await supabase.from('meta_vendedora').upsert({vendedora_id:v.id,competencia:`${selected()}-01`,valor_meta:meta},{onConflict:'vendedora_id,competencia'});if(error)throw error}
 if(venda>0){const d=new Date(),date=selected()===`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`?`${selected()}-${String(d.getDate()).padStart(2,'0')}`:`${selected()}-01`,atend=ticket>0?Math.round(venda/ticket):null;const{error}=await supabase.from('resultado_vendedora').upsert({vendedora_id:v.id,data:date,valor_realizado:venda,atendimentos:atend,criado_por:profile.id},{onConflict:'vendedora_id,data'});if(error)throw error}
 toast('Vendedora cadastrada. Atualizando ranking…');setTimeout(()=>location.reload(),700);
}
async function wire(){const ctx=await getSessionProfile();profile=ctx.profile;if(!profile||profile.role==='gerente_comercial')return;const doc=frame.contentDocument;if(!doc?.body)return;doc.addEventListener('click',async e=>{const el=e.target.closest('div,span'),t=(el?.textContent||'').trim();if(t!=='Salvar vendedora')return;e.preventDefault();e.stopImmediatePropagation();try{await saveSeller(doc)}catch(err){console.error(err);toast(err.message||String(err),'error')}},true)}
frame.addEventListener('load',()=>setTimeout(wire,220));
