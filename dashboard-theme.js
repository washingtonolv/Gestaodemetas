const frame=document.querySelector('#panel');
const THEME_KEY='metasdd.theme';
const currentTheme=()=>localStorage.getItem(THEME_KEY)==='dark'?'dark':'light';

function syncButtons(doc,theme){
 for(const button of doc?.querySelectorAll?.('[data-theme-toggle]')||[]){
  const dark=theme==='dark';
  button.setAttribute('aria-pressed',String(dark));
  button.title=dark?'Ativar modo claro':'Ativar modo escuro';
  button.setAttribute('aria-label',button.title);
 }
}

function applyTheme(theme,{save=false}={}){
 if(save)localStorage.setItem(THEME_KEY,theme);
 document.documentElement.dataset.theme=theme;
 const doc=frame.contentDocument;
 if(doc?.documentElement){doc.documentElement.dataset.theme=theme;syncButtons(doc,theme)}
}

function wireFrame(){
 const doc=frame.contentDocument;if(!doc?.body)return;
 applyTheme(currentTheme());
 if(doc.documentElement.dataset.themeWired==='true')return;
 doc.documentElement.dataset.themeWired='true';
 doc.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-theme-toggle]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  const next=currentTheme()==='dark'?'light':'dark';
  applyTheme(next,{save:true});
 },true);
 const observer=new MutationObserver(()=>syncButtons(doc,currentTheme()));
 observer.observe(doc.body,{childList:true,subtree:true});
}

applyTheme(currentTheme());
frame.addEventListener('load',()=>requestAnimationFrame(wireFrame));
window.addEventListener('storage',event=>{if(event.key===THEME_KEY)applyTheme(currentTheme())});
