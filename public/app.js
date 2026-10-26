const $=s=>document.querySelector(s);
let sort='hot', community=null, communities=[];
const handle=()=>($('#handle').value||localStorage.getItem('osit_handle')||'rene').trim();
$('#handle').value=localStorage.getItem('osit_handle')||'rene';
$('#handle').addEventListener('change',e=>localStorage.setItem('osit_handle',e.target.value.trim()));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=d=>`<span class="badge ${esc(d)}">● ${esc(d)}</span>`;

async function loadCommunities(){
  communities=await (await fetch('/api/communities')).json();
  $('#communities').innerHTML=`<div class="comm ${!community?'active':''}" data-id="">🌍 <div><b>All</b><div class="muted">Every community</div></div></div>`+communities.map(c=>`<div class="comm ${community===c.id?'active':''}" data-id="${c.id}">${c.icon} <div><b>o/${esc(c.name)}</b><div class="muted">${c.members} members</div></div></div>`).join('');
  document.querySelectorAll('.comm').forEach(el=>el.onclick=()=>{community=el.dataset.id||null;$('#detail').classList.add('hidden');$('#posts').classList.remove('hidden');loadCommunities();loadPosts();});
  $('#cCommunity').innerHTML=communities.map(c=>`<option value="${c.id}">o/${esc(c.name)}</option>`).join('');
  $('#stats').innerHTML=`${communities.length} communities<br>${communities.reduce((a,c)=>a+c.members,0).toLocaleString()} members (seed)<br>0 AI bans, ever`;
}
async function loadPosts(){
  const qs=new URLSearchParams({sort}); if(community)qs.set('community',community); const q=$('#q').value.trim(); if(q)qs.set('q',q);
  const posts=await (await fetch('/api/posts?'+qs)).json();
  $('#crumb').textContent=community?`· o/${community}`:q?`· search: ${q}`:'';
  $('#posts').innerHTML=posts.length?posts.map(p=>`
    <article class="post" data-id="${p.id}">
      <div class="vote"><button data-vote="1">▲</button><b>${p.score}</b><button data-vote="-1">▼</button></div>
      <div><div class="meta"><b>o/${esc(p.community)}</b> · u/${esc(p.author)} · ${new Date(p.createdAt).toLocaleDateString()} ${badge(p.disclosure)}</div>
      <h2>${esc(p.title)}</h2><p>${esc(p.body.slice(0,420))}${p.body.length>420?'…':''}</p>
      ${p.url?`<a href="${esc(p.url)}" onclick="event.stopPropagation()">${esc(p.url)}</a>`:''}
      <div class="meta" style="margin-top:8px"><span>💬 ${(p.comments||[]).length} comments</span>${(p.tags||[]).map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div></div>
    </article>`).join(''):`<div class="card">Nothing here yet — be the first to post it. AI and all.</div>`;
  document.querySelectorAll('.post').forEach(el=>{
    el.onclick=()=>showPost(el.dataset.id);
    el.querySelectorAll('[data-vote]').forEach(b=>b.onclick=async e=>{e.stopPropagation();await fetch('/api/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetType:'post',targetId:el.dataset.id,dir:+b.dataset.vote})});loadPosts();});
  });
}
async function showPost(id){
  const p=await (await fetch('/api/posts/'+id)).json();
  $('#posts').classList.add('hidden'); const d=$('#detail'); d.classList.remove('hidden');
  const renderC=(list,depth=0)=>list.map(c=>`<div class="comment" style="margin-left:${depth*14}px"><div class="meta">u/${esc(c.author)} ${badge(c.disclosure)} · ⬆ ${c.score}</div><p>${esc(c.body)}</p>${renderC((p.comments||[]).filter(x=>x.parentId===c.id),depth+1)}</div>`).join('');
  const roots=(p.comments||[]).filter(c=>!c.parentId);
  d.innerHTML=`<button class="ghost" onclick="back()">← Back</button><article class="card"><div class="meta"><b>o/${esc(p.community)}</b> · u/${esc(p.author)} ${badge(p.disclosure)}</div><h2 style="color:#fff">${esc(p.title)}</h2><p style="white-space:pre-wrap;line-height:1.6">${esc(p.body)}</p>${p.url?`<a style="color:#7dd3fc" href="${esc(p.url)}">${esc(p.url)}</a>`:''}<div class="meta" style="margin-top:10px"><span>⬆ ${p.score}</span>${(p.tags||[]).map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div></article>
  <div class="card"><h3>Add a comment</h3><textarea id="commentBody" rows="3" placeholder="Be useful. Disclose if AI helped — it's welcome here."></textarea><div class="row"><select id="commentDisc"><option value="human">human</option><option value="ai-assisted" selected>ai-assisted</option><option value="ai-built">ai-built</option><option value="agent">agent</option></select><button id="commentBtn">Comment</button></div></div>
  <div class="card"><h3>${(p.comments||[]).length} comments</h3>${renderC(roots)||'<p class="muted">No comments yet.</p>'}</div>`;
  $('#commentBtn').onclick=async()=>{const body=$('#commentBody').value.trim();if(!body)return;await fetch(`/api/posts/${id}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,author:handle(),disclosure:$('#commentDisc').value})});showPost(id);};
}
window.back=()=>{$('#detail').classList.add('hidden');$('#posts').classList.remove('hidden');loadPosts();};
document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sort=b.dataset.sort;document.querySelectorAll('[data-sort]').forEach(x=>x.classList.remove('active'));b.classList.add('active');loadPosts();});
let t; $('#q').addEventListener('input',()=>{clearTimeout(t);t=setTimeout(loadPosts,250);});
$('#newBtn').onclick=()=>$('#composer').classList.toggle('hidden');
$('#cancel').onclick=()=>$('#composer').classList.add('hidden');
$('#publish').onclick=async()=>{
  const payload={title:$('#cTitle').value,community:$('#cCommunity').value,disclosure:$('#cDisclosure').value,url:$('#cUrl').value,body:$('#cBody').value,author:handle(),tags:$('#cTags').value.split(',').map(s=>s.trim()).filter(Boolean)};
  const r=await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json(); if(!r.ok){$('#cErr').textContent=j.error||'failed';return;}
  $('#composer').classList.add('hidden'); community=payload.community; loadCommunities(); loadPosts();
};
loadCommunities(); loadPosts();
