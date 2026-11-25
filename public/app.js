const app=document.querySelector('#app'), status=document.querySelector('#status');
const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
const show=(...nodes)=>{status.textContent='';app.replaceChildren(...nodes)};
async function api(path,data){const res=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const obj=await res.json();if(!res.ok)throw Object.assign(new Error(obj.error),{status:res.status});return obj}
function action(label,fn){const b=el('button',label);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){status.textContent=e.message}finally{b.disabled=false}};return b}
function form(fields,submit,fn){const f=el('form',''),b=el('button',submit);f.append(...fields,b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await fn()}catch(err){status.textContent=err.message}finally{b.disabled=false}};return f}
function field(label,type='text'){const l=el('label',label),i=document.createElement(type==='textarea'?'textarea':'input');if(i.tagName==='INPUT')i.type=type;i.required=type!=='checkbox';l.append(i);return [l,i]}
function login(){const [u,user]=field('Username'),[p,pass]=field('Password','password');user.autocomplete='username';pass.autocomplete='current-password';show(el('h1','Admin sign-in'),el('p','Create a poll, share its link, and review the votes here.'),form([u,p],'Sign in',async()=>{await api('login',{username:user.value,password:pass.value});await dashboard()}))}
async function dashboard(){history.replaceState(null,'','/');let polls;try{polls=await api('admin/polls')}catch(e){if(e.status===401)return login();throw e}const [q,title]=field('Poll question'),[o,options]=field('Options · one per line','textarea'),[m,multi]=field('Allow multiple selections','checkbox');
  const [lo,min]=field('Minimum selections','number'),[hi,max]=field('Maximum selections','number');
  min.value=1;
  function syncLimits(){const n=options.value.split('\n').filter(v=>v.trim()).length;for(const i of [min,max]){i.disabled=!multi.checked;i.min=1;i.max=n}lo.hidden=hi.hidden=!multi.checked;max.placeholder=String(n);max.required=false}
  multi.onchange=options.oninput=syncLimits;syncLimits();
  title.maxLength=200;options.rows=5;const list=el('ul','');for(const poll of polls){const li=el('li',''),link=el('a',poll.title);link.href='/p/'+poll.id;li.append(link,' ',action('Results & link',()=>results(poll.id)));list.append(li)}show(el('h1','Create a poll'),form([q,o,m,lo,hi],'Create poll',async()=>{const {id}=await api('admin/polls',{title:title.value,options:options.value.split('\n').map(s=>s.trim()).filter(Boolean),multi:multi.checked,minChoices:multi.checked?Number(min.value):1,maxChoices:multi.checked?Number(max.value||max.placeholder):1});await results(id)}),el('h2','Your polls'),polls.length?list:el('p','No polls yet.'),action('Sign out',async()=>{await api('admin/logout',{});login()}))}
function invitations(id){
  const section=el('section',''),[recipients,input]=field('Voter names · one per line','textarea');
  input.rows=3;section.append(el('h2','Invite voters'),el('p','Generate one private link per person. Links stay in the invitation register below.'),form([recipients],'Generate private links',async()=>{
    const names=input.value.split('\n').map(name=>name.trim()).filter(Boolean);
    await api('admin/invitations/'+id,{names});await results(id);status.textContent='Private links are ready in the invitation register.';
  }));return section;
}
function voterRecords(id,voters){
  const section=el('section',''),list=el('ul',''),lines=[];
  section.append(el('h2','Invitation register'));
  for(const {name,choices,code} of voters){
    const url=new URL('/p/'+id,location.origin);url.hash=new URLSearchParams({invite:code}).toString();
    lines.push(name+': '+url.href);
    const row=el('li',''),link=el('a',name+'’s private link');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
    row.append(link,el('p',choices?'Voted · '+choices.join(', '):'Awaiting vote'),action('Copy private link',async()=>{await navigator.clipboard.writeText(url.href);status.textContent='Private link copied.'}));list.append(row);
  }
  if(voters.length)section.append(action('Copy all links',async()=>{await navigator.clipboard.writeText(lines.join('\n'));status.textContent='Private links copied.'}),list);
  else section.append(el('p','No invitations yet. Add voter names above to get started.'));
  return section;
}
async function results(id){const r=await api('admin/results/'+id);history.replaceState(null,'','/#results/'+id);const [l,input]=field('Shareable voting link');input.value=location.origin+'/p/'+id;input.readOnly=true;const list=el('ul','');for(const {label,count} of r.options){const li=el('li',`${label}: ${count}`),bar=el('progress','');bar.max=Math.max(1,r.total);bar.value=count;li.append(bar);list.append(li)}show(el('h1',r.title),l,action('Copy link',async()=>{input.select();await navigator.clipboard.writeText(input.value);status.textContent='Link copied.'}),invitations(id),el('h2',`${r.total} ballot${r.total===1?'':'s'}`),list,voterRecords(id,r.voters),action('Refresh results',()=>results(id)),action('Back to polls',dashboard))}
async function vote(id){const p=await api('polls/'+id),title=el('h1',p.title);if(p.voted)return show(title,el('p','Your vote has been recorded.'));const box=el('fieldset','');const rule=p.minChoices===p.maxChoices?`Select exactly ${p.maxChoices}`:`Select ${p.minChoices} to ${p.maxChoices}`;box.append(el('legend',rule+` of ${p.options.length} options`));const inputs=p.options.map(label=>{const l=el('label',''),i=el('input','');i.type=p.multi?'checkbox':'radio';i.name='choice';l.append(i,' '+label);box.append(l);return i});box.onchange=()=>{const full=inputs.filter(i=>i.checked).length>=p.maxChoices;if(p.multi)for(const i of inputs)i.disabled=full&&!i.checked};const [invite,code]=field('Invitation code from the poll admin');code.autocomplete='off';code.value=new URLSearchParams(location.hash.slice(1)).get('invite')||'';show(title,el('p','This is not an anonymous ballot. The admin can see your selections alongside the name assigned to your invitation. Do not forward your link.'),form([invite,box],'Submit vote',async()=>{const choices=inputs.flatMap((v,i)=>v.checked?[i]:[]);if(choices.length<p.minChoices||choices.length>p.maxChoices)throw new Error(rule+' before submitting.');await api('polls/'+id,{choices,code:code.value.trim()});show(title,el('p','Your vote has been recorded.'))}))}
const id=location.pathname.split('/')[2];(id?vote(id):/^#results\/[\w-]+$/.test(location.hash)?results(location.hash.split('/')[1]).catch(e=>{if(e.status===401)return login();throw e}):dashboard()).catch(e=>show(el('h1','Unable to open poll room'),el('p',e.message)));
