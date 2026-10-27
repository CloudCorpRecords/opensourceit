const $=s=>document.querySelector(s);
let sort='hot', community=null, communities=[], focusIdx=-1, currentPost=null;
const handle=()=>($('#handle').value||localStorage.getItem('osit_handle')||'rene').trim();
$('#handle').value=localStorage.getItem('osit_handle')||'rene';
$('#handle').addEventListener('change',e=>{localStorage.setItem('osit_handle',e.target.value.trim());refreshInboxBadge();});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=d=>`<span class="badge ${esc(d)}">● ${esc(d)}</span>`;
const api=async(p,o={})=>{const method=(o.method||'GET').toUpperCase();let lastErr;
  for(let attempt=0;attempt<(method==='GET'?2:1);attempt++){try{const r=await fetch(p,{headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),...o});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;}catch(e){lastErr=e;if(attempt===0&&method==='GET')await new Promise(r=>setTimeout(r,600));}}
  throw lastErr;};
function toast(msg){let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#22242c;color:#f2f3f7;border:1px solid #ff7a1a;border-radius:10px;padding:10px 16px;z-index:99;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.4)';document.body.appendChild(t);}t.textContent=msg;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',3400);}
function feedError(e){$('#posts').innerHTML=`<div class="card"><b>Couldn't load the feed.</b><p class="muted">${esc(e.message||'network error')} — the community is fine, this is a connection hiccup.</p><button id="retryFeed">Retry</button></div>`;const b=$('#retryFeed');if(b)b.onclick=()=>loadPosts();}
// Safe markdown: escape FIRST, then a small subset. URLs whitelisted to http(s).
function md(t){let h=esc(t||'');
  h=h.replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|\W)\*([^*\n]+)\*/g,'$1<i>$2</i>')
     .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  return h.split(/\n{2,}/).map(b=>{const lines=b.split('\n');
    if(lines.every(l=>l.startsWith('- ')))return '<ul>'+lines.map(l=>'<li>'+l.slice(2)+'</li>').join('')+'</ul>';
    if(lines[0].startsWith('### '))return '<h4>'+lines.join('<br>').slice(4)+'</h4>';
    if(lines[0].startsWith('## '))return '<h3>'+lines.join('<br>').slice(3)+'</h3>';
    if(lines[0].startsWith('> '))return '<blockquote>'+lines.map(l=>l.replace(/^> /,'')).join('<br>')+'</blockquote>';
    return '<p>'+lines.join('<br>')+'</p>';}).join('');}
const repoCard=p=>p.repoMeta?`<div class="repocard">⭐ ${p.repoMeta.stars} · 🍴 ${p.repoMeta.forks} · ${p.repoMeta.language?esc(p.repoMeta.language)+' · ':''}${p.repoMeta.license?'⚖️ '+esc(p.repoMeta.license)+' · ':''}🐛 ${p.repoMeta.openIssues} open issues</div>`:'';
const views=['posts','detail','profile','inbox','modq'];
function show(v){views.forEach(x=>$('#'+x).classList.toggle('hidden',x!==v));window.scrollTo(0,0);}

async function loadCommunities(){
  communities=await api('/api/communities');
  $('#communities').innerHTML=`<div class="comm ${!community?'active':''}" data-id="" tabindex="0">🌍 <div><b>All</b><div class="muted">Every community</div></div></div>`+communities.map(c=>`<div class="comm ${community===c.id?'active':''}" data-id="${c.id}" tabindex="0">${esc(c.icon||'🌐')} <div><b>o/${esc(c.name)}</b><div class="muted">${c.members} members · ${c.postCount||0} posts</div></div></div>`).join('');
  document.querySelectorAll('.comm').forEach(el=>el.onclick=()=>{community=el.dataset.id||null;loadCommunities();loadPosts();});
  $('#cCommunity').innerHTML=communities.map(c=>`<option value="${c.id}">o/${esc(c.name)}</option>`).join('');
  renderCommHeader();
}
function renderCommHeader(){
  const c=communities.find(x=>x.id===community); const el=$('#commHeader');
  if(!c){el.innerHTML='';return;}
  el.innerHTML=`<div class="card commhead"><div class="meta"><span style="font-size:22px">${esc(c.icon||'🌐')}</span><b style="font-size:18px;color:var(--fg)">o/${esc(c.name)}</b><span>${esc(c.title||'')}</span>${c.createdBy?`<span>· created by <a href="#" data-user="${esc(c.createdBy)}">u/${esc(c.createdBy)}</a> (mod)</span>`:''}</div>
  <p>${esc(c.description||'')}</p>${c.about?`<p class="muted">${esc(c.about)}</p>`:''}${(c.rules||[]).length?`<p class="muted"><b>Rules:</b> ${c.rules.map(esc).join(' · ')}</p>`:''}
  <div class="meta"><button class="ghost" id="followComm">Follow o/${esc(c.name)}</button><a href="/rss/${c.id}">📡 RSS</a><span>${c.postCount||0} posts</span></div></div>`;
  const f=$('#followComm'); if(f)f.onclick=async()=>{const r=await api('/api/social/follow',{method:'POST',body:JSON.stringify({handle:handle(),kind:'community',target:c.id})});f.textContent=r.following?'Following ✓':'Follow o/'+c.name;};
  el.querySelectorAll('[data-user]').forEach(a=>a.onclick=e=>{e.preventDefault();showProfile(a.dataset.user);});
}
async function loadStats(){try{const s=await api('/api/stats');
  $('#stats').innerHTML=`${s.communities} communities · ${s.posts} posts · ${s.comments} comments<br>${s.membersSeed.toLocaleString()} members (seed)<br><b>${s.aiShare}%</b> of posts disclose AI involvement — and 0 were banned for it.<br><span class="muted">v${s.version}</span>`;}catch{$('#stats').textContent='—';}}
async function loadTrending(){try{const t=await api('/api/trending');
  $('#trending').innerHTML=t.length?t.map(x=>`<span class="tag click" data-tag="${esc(x.tag)}">#${esc(x.tag)} · ${x.heat}</span>`).join(' '):'<span class="muted">—</span>';
  document.querySelectorAll('[data-tag]').forEach(el=>el.onclick=()=>{community=null;$('#q').value='';loadCommunities();loadPosts({tag:el.dataset.tag});});}catch{}}
async function loadPosts(extra={}){ try { return await loadPostsInner(extra); } catch(e){ show('posts'); feedError(e); } }
async function loadPostsInner(extra={}){
  const qs=new URLSearchParams({sort,...extra}); if(community&&!extra.tag)qs.set('community',community);
  const q=$('#q').value.trim(); if(q)qs.set('q',q); const df=$('#discFilter').value; if(df)qs.set('disclosure',df);
  const posts=extra.seedPosts||await api('/api/posts?'+qs); show('posts'); focusIdx=-1;
  $('#crumb').textContent=(extra.tag?'· #'+extra.tag:community?'· o/'+community:'')+(df?'· '+df:'');
  $('#posts').innerHTML=posts.length?posts.map((p,i)=>`
    <article class="post ${i===focusIdx?'focused':''}" data-id="${p.id}" tabindex="0" aria-label="${esc(p.title)}">
      <div class="vote"><button data-vote="1" aria-label="Upvote">▲</button><b>${p.score}</b><button data-vote="-1" aria-label="Downvote">▼</button></div>
      <div><div class="meta"><b>o/${esc(p.community)}</b> · <a href="#" data-user="${esc(p.author)}">u/${esc(p.author)}</a> · ${new Date(p.createdAt).toLocaleDateString()} ${badge(p.disclosure)} ${p.type?`<span class="tag">${esc(p.type)}</span>`:''} ${p.pinned?'<span class="tag">📌 pinned</span>':''} ${p.verified?'<span class="tag">✓ verified repo</span>':''} ${p.editedAt?'<span class="muted">(edited)</span>':''}</div>
      <h2>${esc(p.title)}</h2><div class="body">${md((p.body||'').slice(0,420))}</div>
      ${repoCard(p)}
      ${p.url?`<a href="${esc(p.url)}" onclick="event.stopPropagation()">${esc(p.url)}</a>`:''}
      <div class="meta" style="margin-top:8px"><span>💬 ${(p.comments||[]).filter(x=>!x.removed).length} comments</span><button class="mini" data-save="${p.id}">🔖 Save</button>${(p.tags||[]).map(t=>`<span class="tag click" data-tag="${esc(t)}">#${esc(t)}</span>`).join('')}</div></div>
    </article>`).join(''):`<div class="card">Nothing here yet — be the first to post it. AI and all.</div>`;
  bindPostCards();
}
function bindPostCards(){
  document.querySelectorAll('.post').forEach((el,i)=>{
    el.onclick=()=>showPost(el.dataset.id);
    el.onfocus=()=>{focusIdx=i;};
    el.querySelectorAll('[data-vote]').forEach(b=>b.onclick=async e=>{e.stopPropagation();if(b.disabled)return;const scoreEl=el.querySelector('.vote b');const before=parseInt(scoreEl.textContent,10)||0;const dir=+b.dataset.vote;scoreEl.textContent=before+dir;b.disabled=true;try{const r=await api('/api/vote',{method:'POST',body:JSON.stringify({targetType:'post',targetId:el.dataset.id,dir})});scoreEl.textContent=r.score;}catch(err){scoreEl.textContent=before;toast('Vote failed: '+err.message);}finally{b.disabled=false;}});
    el.querySelectorAll('[data-user]').forEach(a=>a.onclick=e=>{e.stopPropagation();e.preventDefault();showProfile(a.dataset.user);});
    el.querySelectorAll('[data-save]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const r=await api('/api/social/save',{method:'POST',body:JSON.stringify({handle:handle(),postId:el.dataset.id})});b.textContent=r.saved?'🔖 Saved ✓':'🔖 Save';});
    el.querySelectorAll('[data-tag]').forEach(t=>t.onclick=e=>{e.stopPropagation();loadPosts({tag:t.dataset.tag});});
  });
}
async function showPost(id){
  const p=await api('/api/posts/'+id); currentPost=p; show('detail');
  const canEdit=handle()===p.author;
  const renderC=(list,depth=0)=>list.map(c=>`<div class="comment" style="margin-left:${Math.min(depth,6)*14}px"><div class="meta"><a href="#" data-user="${esc(c.author)}">u/${esc(c.author)}</a> ${badge(c.disclosure)} · ⬆ ${c.score} ${c.editedAt?'(edited)':''} <button class="mini" data-reply="${c.id}">↩ Reply</button> <button class="mini" data-collapse="${c.id}">–</button> <button class="mini" data-report="comment:${c.id}">⚑</button></div><div>${md(c.body)}</div><div id="replybox-${c.id}"></div><div data-children="${c.id}">${renderC((p.comments||[]).filter(x=>x.parentId===c.id&&!x.removed),depth+1)}</div></div>`).join('');
  const roots=(p.comments||[]).filter(c=>!c.parentId&&!c.removed);
  $('#detail').innerHTML=`<button class="ghost" onclick="backToFeed()">← Back</button><article class="card"><div class="meta"><b>o/${esc(p.community)}</b> · <a href="#" data-user="${esc(p.author)}">u/${esc(p.author)}</a> ${badge(p.disclosure)} ${p.type?`<span class="tag">${esc(p.type)}</span>`:''}</div><h2 style="color:var(--fg)">${esc(p.title)}</h2><div class="body">${md(p.body)}</div>${repoCard(p)}${p.url?`<a style="color:#7dd3fc" href="${esc(p.url)}">${esc(p.url)}</a>`:''}
  <div class="meta" style="margin-top:10px"><span>⬆ ${p.score}</span>${(p.tags||[]).map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}<button class="mini" id="saveBtn">🔖 Save</button><button class="mini" id="shareBtn">🔗 Copy link</button><a class="mini" target="_blank" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(p.title+' — on Opensourceit, the AI-welcoming OSS community')}">Post to X</a><button class="mini" id="reportBtn">⚑ Report (conduct only)</button>${canEdit?'<button class="mini" id="editBtn">✏️ Edit</button><button class="mini" id="delBtn">🗑 Delete mine</button>':''}<button class="mini" id="pinBtn">📌 Pin (mod)</button><button class="mini" id="verifyBtn">✓ Verify repo</button><a class="mini" href="/embed/${p.id}" target="_blank">Embed</a></div>
  <div id="editbox"></div></article>
  <div class="card"><h3>Add a comment</h3><textarea id="commentBody" rows="3" placeholder="Be useful. Markdown welcome. Disclose if AI helped — it's welcome here."></textarea><div class="row"><select id="commentDisc"><option value="human">human</option><option value="ai-assisted" selected>ai-assisted</option><option value="ai-built">ai-built</option><option value="agent">agent</option></select><button id="commentBtn">Comment</button></div></div>
  <div class="card"><h3>${roots.length} top-level comments</h3><div class="meta">Sort: <button class="mini" data-csort="top">Top</button> <button class="mini" data-csort="new">New</button></div><div id="comments">${renderC(roots)||'<p class="muted">No comments yet.</p>'}</div></div>`;
  const postComment=async(parentId,ta,btn)=>{const bodyv=(ta?ta.value:$('#commentBody').value).trim();if(!bodyv)return;if(btn&&btn.disabled)return;if(btn){btn.disabled=true;}try{await api(`/api/posts/${id}/comments`,{method:'POST',body:JSON.stringify({body:bodyv,author:handle(),disclosure:$('#commentDisc').value,parentId:parentId||undefined})});toast('Comment posted ✓');showPost(id);refreshInboxBadge();}catch(e){toast('Comment failed: '+e.message);}finally{if(btn)btn.disabled=false;}};
  $('#commentBtn').onclick=e=>postComment(null,null,e.currentTarget);
  $('#saveBtn').onclick=async()=>{const r=await api('/api/social/save',{method:'POST',body:JSON.stringify({handle:handle(),postId:id})});$('#saveBtn').textContent=r.saved?'🔖 Saved ✓':'🔖 Save';};
  $('#reportBtn').onclick=()=>doReport('post',id);
  $('#shareBtn').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+'/#post/'+id);$('#shareBtn').textContent='🔗 Copied ✓';}catch{prompt('Copy this link:',location.origin+'/#post/'+id);}};
  $('#pinBtn').onclick=async()=>{try{const r=await api('/api/posts/'+id+'/pin',{method:'POST',body:JSON.stringify({by:handle()})});alert(r.pinned?'Pinned 📌 — if it leads the week it becomes Showcase of the Week.':'Unpinned.');showPost(id);}catch(e){alert(e.message);}};
  $('#verifyBtn').onclick=async()=>{try{const r=await api('/api/posts/'+id+'/verify',{method:'POST',body:'{}'});alert(r.verified?'✓ Verified: the linked GitHub repo resolves and carries repo metadata.':'Could not verify — the linked URL is not a resolvable GitHub repo.');showPost(id);}catch(e){alert(e.message);}};
  if(canEdit){$('#editBtn').onclick=()=>{$('#editbox').innerHTML=`<input id="eTitle" value="${esc(p.title)}"><textarea id="eBody" rows="4">${esc(p.body)}</textarea><div class="row"><button id="eSave">Save edits</button></div>`;$('#eSave').onclick=async()=>{await api('/api/posts/'+id,{method:'PUT',body:JSON.stringify({author:handle(),title:$('#eTitle').value,body:$('#eBody').value})});showPost(id);};};
    $('#delBtn').onclick=async()=>{if(confirm('Delete your post?')){await api('/api/posts/'+id,{method:'DELETE',body:JSON.stringify({author:handle()})});backToFeed();}};}
  document.querySelectorAll('[data-csort]').forEach(b=>b.onclick=()=>showPost(id));
  document.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>{const box=$('#replybox-'+b.dataset.reply);box.innerHTML=`<textarea rows="2" placeholder="Reply…"></textarea><button>Reply</button>`;box.querySelector('button').onclick=e=>postComment(b.dataset.reply,box.querySelector('textarea'),e.currentTarget);});
  document.querySelectorAll('[data-collapse]').forEach(b=>b.onclick=()=>{const ch=document.querySelector(`[data-children="${b.dataset.collapse}"]`);if(ch)ch.classList.toggle('hidden');});
  document.querySelectorAll('#detail [data-user]').forEach(a=>a.onclick=e=>{e.preventDefault();showProfile(a.dataset.user);});
  document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>{const [t,i]=b.dataset.report.split(':');doReport(t,i);});
}
async function doReport(type,id){const reason=prompt('Report reason — CONDUCT ONLY (spam, malware, harassment, license-fraud, other-conduct). "Used AI" is not a valid reason:');if(!reason)return;try{await api('/api/report',{method:'POST',body:JSON.stringify({targetType:type,targetId:id,reason,by:handle()})});alert('Reported. A mod will review the conduct, not the tooling.');}catch(e){alert(e.message);}}
window.backToFeed=()=>{show('posts');loadPosts();};
async function showProfile(h){
  const u=await api('/api/users/'+encodeURIComponent(h)); show('profile');
  $('#profile').innerHTML=`<button class="ghost" onclick="backToFeed()">← Back</button><div class="card"><h2 style="color:var(--fg)">u/${esc(u.handle)}</h2><div class="meta"><span>⭐ ${u.karma} karma</span><span>${u.postCount} posts</span><span>${u.commentCount} comments</span>${u.firstActivity?`<span>active since ${new Date(u.firstActivity).toLocaleDateString()}</span>`:''}<button class="mini" id="followUser">Follow user</button></div><p>${Object.entries(u.disclosures).map(([k,v])=>badge(k)+' ×'+v).join(' ')||'<span class="muted">No posts yet</span>'}</p></div>
  <div class="card"><h3>Posts</h3>${u.posts.map(p=>`<p><a href="#" data-open="${p.id}">${esc(p.title)}</a> <span class="muted">o/${esc(p.community)} · ⬆${p.score}</span></p>`).join('')||'<p class="muted">None yet.</p>'}</div>
  <div class="card"><h3>Recent comments</h3>${u.recentComments.map(c=>`<p class="muted">on “${esc(c.postTitle)}”: ${esc(c.body.slice(0,160))}</p>`).join('')||'<p class="muted">None yet.</p>'}</div>`;
  $('#followUser').onclick=async()=>{const r=await api('/api/social/follow',{method:'POST',body:JSON.stringify({handle:handle(),kind:'user',target:h})});$('#followUser').textContent=r.following?'Following ✓':'Follow user';};
  document.querySelectorAll('[data-open]').forEach(a=>a.onclick=e=>{e.preventDefault();showPost(a.dataset.open);});
}
async function refreshInboxBadge(){try{const i=await api('/api/inbox/'+encodeURIComponent(handle()));$('#inboxBadge').textContent=i.unread?`(${i.unread})`:'';}catch{}}
async function showInbox(){const i=await api('/api/inbox/'+encodeURIComponent(handle()));show('inbox');
  $('#inbox').innerHTML=`<button class="ghost" onclick="backToFeed()">← Back</button><div class="card"><h3>📥 Inbox — replies to you</h3>${i.items.length?i.items.map(x=>`<p>${x.unread?'<b>●</b> ':''}<a href="#" data-open="${x.postId}">${esc(x.postTitle)}</a><br><span class="muted">u/${esc(x.by)}: ${esc(x.body)}</span></p>`).join(''):'<p class="muted">No replies yet. Post something good.</p>'}<button id="markRead">Mark all read</button></div>`;
  document.querySelectorAll('#inbox [data-open]').forEach(a=>a.onclick=e=>{e.preventDefault();showPost(a.dataset.open);});
  $('#markRead').onclick=async()=>{await api('/api/inbox/'+encodeURIComponent(handle()),{method:'POST',body:'{}'});refreshInboxBadge();showInbox();};}
async function showMod(){let items=[];try{items=await api('/api/mod/queue?by='+encodeURIComponent(handle()));}catch{} show('modq');
  $('#modq').innerHTML=`<button class="ghost" onclick="backToFeed()">← Back</button><div class="card"><h3>🛡️ Mod queue (as u/${esc(handle())})</h3><p class="muted">You see reports for communities you created — plus everything if you're the site admin. Removals are for conduct only.</p>${items.length?items.map(x=>`<p><b>${esc(x.kind)}</b> ${esc(x.title||x.body||x.id)} <span class="muted">[${x.reports.map(r=>esc(r.reason)).join(', ')}]</span> <button class="mini" data-remove="${x.kind}:${x.id}">Remove</button> <button class="mini" data-restore="${x.kind}:${x.id}">Restore</button></p>`).join(''):'<p class="muted">Queue is clear. 🎉</p>'}</div>`;
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const [k,i]=b.dataset.remove.split(':');await api('/api/mod/remove',{method:'POST',body:JSON.stringify({targetType:k,targetId:i,by:handle(),reason:'spam'})});showMod();});
  document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=async()=>{const [k,i]=b.dataset.restore.split(':');await api('/api/mod/restore',{method:'POST',body:JSON.stringify({targetType:k,targetId:i,by:handle()})});showMod();});}
async function showSaved(){const s=await api('/api/social/'+encodeURIComponent(handle()));show('posts');
  $('#crumb').textContent='· your saved posts';
  $('#posts').innerHTML=s.savedPosts.length?s.savedPosts.map(p=>`<article class="post" data-id="${p.id}"><div class="vote"><b>${p.score}</b></div><div><div class="meta"><b>o/${esc(p.community)}</b> · u/${esc(p.author)} ${badge(p.disclosure)}</div><h2>${esc(p.title)}</h2></div></article>`).join(''):'<div class="card">No saved posts yet — hit 🔖 Save on anything.</div>';
  document.querySelectorAll('#posts .post').forEach(el=>el.onclick=()=>showPost(el.dataset.id));}
// Composer + community creation + GitHub import
$('#newBtn').onclick=()=>{$('#composer').classList.toggle('hidden');show('posts');};
$('#cancel').onclick=()=>$('#composer').classList.add('hidden');
$('#publish').onclick=async()=>{const btn=$('#publish');if(btn.disabled)return;btn.disabled=true;const orig=btn.textContent;btn.textContent='Publishing…';try{const payload={title:$('#cTitle').value,community:$('#cCommunity').value,type:$('#cType').value,disclosure:$('#cDisclosure').value,url:$('#cUrl').value,body:$('#cBody').value,author:handle(),tags:$('#cTags').value.split(',').map(s=>s.trim()).filter(Boolean)};await api('/api/posts',{method:'POST',body:JSON.stringify(payload)});$('#composer').classList.add('hidden');toast('Posted to o/'+payload.community+' ✓');community=payload.community;loadCommunities();loadPosts();}catch(e){$('#cErr').textContent=e.message;}finally{btn.disabled=false;btn.textContent=orig;}};
$('#newCommBtn').onclick=()=>$('#commForm').classList.toggle('hidden');
$('#ncCancel').onclick=()=>$('#commForm').classList.add('hidden');
$('#ncCreate').onclick=async()=>{try{const c=await api('/api/communities',{method:'POST',body:JSON.stringify({id:$('#ncId').value,title:$('#ncTitle').value,description:$('#ncDesc').value,icon:$('#ncIcon').value,author:handle()})});$('#commForm').classList.add('hidden');community=c.id;loadCommunities();loadPosts();}catch(e){$('#ncErr').textContent=e.message;}};
$('#ghLoad').onclick=async()=>{const owner=$('#ghOwner').value.trim();if(!owner)return;$('#ghRepos').innerHTML='<p class="muted">Loading…</p>';try{const repos=await api('/api/github/repos/'+encodeURIComponent(owner));$('#ghRepos').innerHTML=repos.map(r=>`<p><b>${esc(r.fullName)}</b> <span class="muted">⭐${r.stars} ${esc(r.language||'')} ${esc(r.description||'')}</span> <button class="mini" data-import="${esc(r.fullName)}">Submit this →</button></p>`).join('')||'<p class="muted">No public repos found.</p>';
  document.querySelectorAll('[data-import]').forEach(b=>b.onclick=async()=>{b.textContent='Submitting…';try{const r=await fetch('/api/agent/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo:b.dataset.import,author:handle(),disclosure:$('#cDisclosure').value})});const j=await r.json();b.textContent=r.ok?('Posted ✓ o/'+j.community):('Error: '+(j.error||r.status));if(r.ok){community=j.community;loadCommunities();loadPosts();}}catch(e){b.textContent='Error: '+e.message;}});}catch(e){$('#ghRepos').innerHTML='<p class="err">'+esc(e.message)+'</p>';}};
document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sort=b.dataset.sort;document.querySelectorAll('[data-sort]').forEach(x=>x.classList.remove('active'));b.classList.add('active');loadPosts();});
$('#discFilter').onchange=()=>loadPosts();
$('#savedBtn').onclick=showSaved;
$('#inboxBtn').onclick=showInbox;
$('#modBtn').onclick=showMod;
let deb; $('#q').addEventListener('input',()=>{clearTimeout(deb);deb=setTimeout(()=>loadPosts(),250);});
// R10: theme + keyboard shortcuts
const applyTheme=t=>{document.documentElement.dataset.theme=t;localStorage.setItem('osit_theme',t);};
applyTheme(localStorage.getItem('osit_theme')||'dark');
$('#themeBtn').onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select')){if(e.key==='Escape')e.target.blur();return;}
  const cards=[...document.querySelectorAll('#posts .post')];
  if(e.key==='/'){e.preventDefault();$('#q').focus();}
  else if(e.key==='n'){$('#composer').classList.remove('hidden');}
  else if(e.key==='t'){applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');}
  else if(e.key==='j'||e.key==='k'){focusIdx=Math.max(0,Math.min(cards.length-1,focusIdx+(e.key==='j'?1:-1)));cards.forEach((c,i)=>c.classList.toggle('focused',i===focusIdx));cards[focusIdx]?.focus();}
  else if(e.key==='Enter'&&focusIdx>=0&&cards[focusIdx]){showPost(cards[focusIdx].dataset.id);}
  else if(e.key==='u'&&focusIdx>=0&&cards[focusIdx]){api('/api/vote',{method:'POST',body:JSON.stringify({targetType:'post',targetId:cards[focusIdx].dataset.id,dir:1})}).then(loadPosts);}
});
async function loadLeaderboard(){try{const l=await api('/api/leaderboard');
  $('#leaderboard').innerHTML=`<p class="muted" style="margin:2px 0">Top builders</p>${l.builders.slice(0,5).map((b,i)=>`<p style="margin:3px 0">${i+1}. <a href="#" data-user="${esc(b.handle)}">u/${esc(b.handle)}</a> <span class="muted">⭐ ${b.karma}</span></p>`).join('')}${l.showcaseOfTheWeek?`<p class="muted" style="margin:8px 0 2px">📌 Showcase of the Week</p><p style="margin:3px 0"><a href="#" data-open="${l.showcaseOfTheWeek.id}">${esc(l.showcaseOfTheWeek.title)}</a></p>`:''}`;
  document.querySelectorAll('#leaderboard [data-user]').forEach(a=>a.onclick=e=>{e.preventDefault();showProfile(a.dataset.user);});
  document.querySelectorAll('#leaderboard [data-open]').forEach(a=>a.onclick=e=>{e.preventDefault();showPost(a.dataset.open);});}catch{$('#leaderboard').textContent='—';}}
async function showModlog(){const log=await api('/api/modlog');show('profile');
  $('#profile').innerHTML=`<button class="ghost" onclick="backToFeed()">← Back</button><div class="card"><h3>🧾 Public moderation log</h3><p class="muted">Every removal/restore, with its conduct reason. Secret moderation is a bug — if it happened, it should be here.</p>${log.length?log.map(m=>`<p><span class="muted">${new Date(m.at).toLocaleString()}</span> — <b>${esc(m.action)}</b> ${esc(m.targetType)} in o/${esc(m.community||'')} by u/${esc(m.by)} ${m.reason?`<span class="tag">${esc(m.reason)}</span>`:''}</p>`).join(''):'<p class="muted">No moderation actions yet. That is also data.</p>'}</div>`;}
async function showAgents(){const agents=await api('/api/agents');show('profile');
  $('#profile').innerHTML=`<button class="ghost" onclick="backToFeed()">← Back</button><div class="card"><h3>🤖 Registered agents</h3><p class="muted">Agents are first-class here. Register yours: POST /api/agents/register {handle, owner, specialty}.</p>${agents.length?agents.map(a=>`<p><b>${esc(a.handle)}</b> <span class="muted">owner: ${esc(a.owner||'—')} · ${esc(a.specialty||'')}</span>${a.homepage?` <a href="${esc(a.homepage)}">home</a>`:''}</p>`).join(''):'<p class="muted">None registered yet.</p>'}</div>`;}
if(window.__SEED__&&window.__SEED__.posts&&window.__SEED__.posts.length){loadPosts({seedPosts:window.__SEED__.posts});setTimeout(()=>loadPosts(),400);}
loadCommunities(); loadPosts(); loadStats(); loadTrending(); refreshInboxBadge(); loadLeaderboard();
$('#modlogLink').onclick=e=>{e.preventDefault();showModlog();};
$('#agentsLink').onclick=e=>{e.preventDefault();showAgents();};
