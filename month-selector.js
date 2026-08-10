import { supabase } from './supabase-client.js';

const frame = document.querySelector('#panel');
const PT_MONTHS = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
const pad = n => String(n).padStart(2,'0');
const monthLabel = key => { const [y,m] = key.split('-').map(Number); return `${PT_MONTHS[m-1]} ${y}`; };
const currentKey = () => localStorage.getItem('metasdd.competencia') || `${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`;
let periods = [];

async function loadPeriods(){
  const [goalsR, resultsR] = await Promise.all([
    supabase.from('metas').select('competencia'),
    supabase.from('resultados').select('data')
  ]);
  if (goalsR.error) throw goalsR.error;
  if (resultsR.error) throw resultsR.error;
  const map = new Map();
  for (const r of goalsR.data || []) {
    const key = String(r.competencia).slice(0,7);
    const x = map.get(key) || { key, metas:0, resultados:0 };
    x.metas++; map.set(key,x);
  }
  for (const r of resultsR.data || []) {
    const key = String(r.data).slice(0,7);
    const x = map.get(key) || { key, metas:0, resultados:0 };
    x.resultados++; map.set(key,x);
  }
  const now = `${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`;
  if (!map.has(now)) map.set(now,{key:now,metas:0,resultados:0});
  periods = [...map.values()].sort((a,b)=>b.key.localeCompare(a.key));
}

function findMonthButton(doc){
  const current = monthLabel(currentKey());
  const label = [...doc.querySelectorAll('div,span')].find(el => {
    const t = (el.textContent || '').trim();
    return (t === current || /^[A-ZÁÉÍÓÚÃÕÇ]+\s+\d{4}\s*▾?$/.test(t)) && el.children.length <= 1;
  });
  if(!label) return null;
  const pill = label.parentElement;
  return pill?.querySelector('img[src*="chevron-down"]') ? pill : label;
}

function closeMenu(doc,instant=false){
  const menu=doc.getElementById('dd-period-menu');
  const trigger=doc.querySelector('[data-period-ready="1"]');
  trigger?.setAttribute('aria-expanded','false');
  if(!menu)return;
  if(instant){menu.remove();return}
  menu.style.opacity='0';
  menu.style.transform='translateY(-6px) scale(.985)';
  setTimeout(()=>menu.remove(),170);
}

function statusText(p){
  if (p.metas && p.resultados) return 'Metas e vendas';
  if (p.metas) return 'Somente metas';
  if (p.resultados) return 'Somente vendas';
  return 'Sem lançamentos';
}

function openMenu(doc, anchor){
  closeMenu(doc,true);
  const menu = doc.createElement('div');
  menu.id = 'dd-period-menu';
  Object.assign(menu.style,{
    position:'fixed',zIndex:'999999',background:'#fff',border:'1px solid #E2ECEA',borderRadius:'16px',
    boxShadow:'0 18px 45px rgba(20,60,55,.18)',padding:'8px',minWidth:'220px',maxHeight:'320px',overflowY:'auto',
    fontFamily:'Inter,system-ui,sans-serif',opacity:'0',transform:'translateY(-6px) scale(.985)',
    transformOrigin:'top center',transition:'opacity .17s ease,transform .22s cubic-bezier(.22,1,.36,1)'
  });
  const r = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(12,r.left), Math.max(12,doc.defaultView.innerWidth-240));
  const top = Math.min(r.bottom+8, doc.defaultView.innerHeight-330);
  menu.style.left = `${left}px`; menu.style.top = `${Math.max(12,top)}px`;

  for(const p of periods){
    const row = doc.createElement('button');
    row.type='button';
    const active = p.key === currentKey();
    Object.assign(row.style,{
      width:'100%',border:'0',background:active?'#E7F4F2':'#fff',borderRadius:'11px',padding:'11px 12px',
      display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',cursor:'pointer',textAlign:'left',
      color:'#16211F',transition:'background-color .16s ease,transform .16s ease'
    });
    const leftBox = doc.createElement('span');
    leftBox.style.display='flex';leftBox.style.flexDirection='column';leftBox.style.gap='3px';
    const name = doc.createElement('strong'); name.textContent=monthLabel(p.key); name.style.font='700 12px/1.2 Inter,sans-serif';
    const sub = doc.createElement('small'); sub.textContent=statusText(p); sub.style.font='500 10px/1.2 Inter,sans-serif'; sub.style.color='#8D9997';
    leftBox.append(name,sub);
    const mark = doc.createElement('span'); mark.textContent=active?'✓':'›'; mark.style.color=active?'#05918C':'#A8B7B5'; mark.style.fontWeight='800';
    row.append(leftBox,mark);
    row.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      localStorage.setItem('metasdd.competencia',p.key);
      closeMenu(doc);
      window.dispatchEvent(new CustomEvent('metasdd:month-change',{detail:{key:p.key}}));
    });
    menu.appendChild(row);
  }
  doc.body.appendChild(menu);
  anchor.setAttribute('aria-expanded','true');
  doc.defaultView.requestAnimationFrame(()=>{menu.style.opacity='1';menu.style.transform='translateY(0) scale(1)'});
  setTimeout(()=>doc.addEventListener('click',()=>closeMenu(doc),{once:true}),0);
}

async function wire(){
  try{ await loadPeriods(); }catch(e){ console.error('Falha ao carregar períodos',e); }
  const doc = frame.contentDocument;
  if(!doc?.body) return;
  const attach = () => {
    const btn = findMonthButton(doc);
    if(!btn || btn.dataset.periodReady) return;
    btn.dataset.periodReady='1';
    btn.style.cursor='pointer';
    btn.style.transition='background-color .18s ease,box-shadow .18s ease,transform .18s ease';
    btn.title='Selecionar período';
    btn.setAttribute('role','button');
    btn.setAttribute('tabindex','0');
    btn.setAttribute('aria-haspopup','listbox');
    btn.setAttribute('aria-expanded','false');
    const activate=async e=>{
      e.preventDefault();e.stopImmediatePropagation();
      const open=doc.getElementById('dd-period-menu');
      if(open){closeMenu(doc);return}
      if(!periods.length) await loadPeriods();
      openMenu(doc,btn);
    };
    btn.addEventListener('click',activate,true);
    btn.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown')activate(e);
      else if(e.key==='Escape')closeMenu(doc);
    },true);
  };
  attach();
  const obs = new MutationObserver(attach);
  obs.observe(doc.body,{childList:true,subtree:true,characterData:true});
}

frame.addEventListener('load',()=>setTimeout(wire,120));
if(frame.contentDocument?.body) setTimeout(wire,200);
