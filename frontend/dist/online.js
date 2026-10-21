import {createPawletterClient} from './pawletter-api.js';
import {createCaptureController} from './capture.js';
import {createObservationSender,errorMessage} from './online-flow.js';
const api=createPawletterClient('https://pawletter-api-446222711695.asia-east1.run.app');
const sender=createObservationSender(api),root=document.querySelector('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const topics={habits:'生活习惯',likes:'喜好与互动',diet:'饮食照护',health:'健康观察',other:'其他观察'};
const statusLabels={queued:'已保存 · 等待整理',processing:'Agent 正在整理',archived:'已归档',failed:'整理失败 · 可以重试',withdrawn:'已撤回'};
let user=null,pets=[],view='login',petId='',notes=[],records=[],messages=[],busy=false,error='',notice='',epoch=0,pollTimer,holding=false,finishing=false;
let draft={text:'',share:true,replacesId:null},chatText='';
let newDraft={name:'',species:'cat',description:'',published:false};
let captureResetting=false;
const station=()=>user?.role==='station';
const owned=()=>pets.filter(p=>p.stationId===user?.stationId);
const pet=()=>pets.find(p=>p.id===petId);
const ownPet=()=>station()&&pet()?.stationId===user.stationId;
const mic='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
const capture=createCaptureController({onChange(){
  for(const field of root.querySelectorAll('#voice-pet,#share-agent,#observation-text'))field.disabled=holding||finishing||busy||sender.pending||!!(field.id==='voice-pet'&&draft.replacesId);
  const b=root.querySelector('#hold-record');
  if(b){b.classList.toggle('recording',!!capture.media.voiceRecorder);b.querySelector('span').textContent=capture.media.voicePending?'请允许麦克风':capture.media.voiceRecorder?`松开归档 · ${capture.media.audioSeconds} 秒`:'按住说话';}
  if(!captureResetting&&holding&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)void finishHold();
},onError(message){error=message.replace(/，?或体验示例口述。/g,'。').replace(/或体验示例口述/g,'');showError();}});
const btn=(label,action,extra='',cls='button secondary')=>`<button type="button" class="${cls}" data-live="${action}" ${busy?'disabled':''} ${extra}>${label}</button>`;
const header=(title,subtitle='')=>`<header class="topbar">${user&&view!=='home'?btn('‹','home','aria-label="返回宠物列表"','icon-button'):''}<div class="topbar-title"><strong>${esc(title)}</strong>${subtitle?`<small>${esc(subtitle)}</small>`:''}</div>${user?btn('退出','logout','','text-button'):''}</header>`;
const card=content=>`<section class="online-card">${content}</section>`;
const empty=(title,body)=>card(`<h2>${title}</h2><p class="online-note">${body}</p>`);
function showError(){const box=root.querySelector('#live-error');if(box)box.textContent=error;}
function snapshot(){
  if(view==='voice'){draft.text=root.querySelector('#observation-text')?.value??draft.text;draft.share=root.querySelector('#share-agent')?.checked??draft.share;}
  if(view==='chat')chatText=root.querySelector('#chat-question')?.value??chatText;
  if(view==='new'){const f=root.querySelector('#pet-form');if(f){const d=new FormData(f);newDraft={name:String(d.get('name')),species:String(d.get('species')),description:String(d.get('description')),published:d.has('published')};}}
}
function render(){
  let content='',title='登录爪爪来信',sub='用已开通的账号，连接真实资料';
  if(!user){
    content=`<p class="eyebrow">A REAL CONNECTION</p><h1>让每次了解，<br>都留下真实的记忆。</h1>${card(`<form id="login-form" class="form-stack"><label>账号<input name="username" autocomplete="username" required maxlength="64" autocapitalize="none" spellcheck="false"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label><button class="button primary full" ${busy?'disabled':''}>${busy?'正在登录…':'登录'}</button></form>`)}<p class="online-note">账号由管理员开通，救助站权限随账号分配。当前开放宠物资料、语音补充与 Agent 问答；注册实名、申请和回访尚未接入。</p><a class="text-button" href="./">返回浏览</a>`;
  }else if(view==='home'){
    title=station()?'救助站工作台':'认识你的新伙伴';sub='资料与记录已连接云端';
    const list=station()?owned():pets;
    content=`<span class="live-tag">${station()?'救助站账号':'领养者账号'}</span>${station()?`<div class="online-actions">${btn('录入新伙伴','new','','button primary')}${btn('给宠物补充','voice',list.length?'':'disabled')}</div>`:''}<div class="section-heading"><h2>${station()?'站内宠物':'待认识的小伙伴'} · ${list.length}</h2>${btn('刷新','refresh','','text-button')}</div>${list.length?list.map(p=>`<button class="online-pet" data-live="pet" data-id="${esc(p.id)}" ${busy?'disabled':''}><span class="pet-symbol" aria-hidden="true">${p.profile.species==='dog'?'🐶':'🐱'}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.profile.description||'一起慢慢认识它')}</small></span><span aria-hidden="true">›</span></button>`).join(''):empty(station()?'还没有录入宠物':'暂时没有可查看的宠物',station()?'先建立档案，再用语音补充习惯、喜好与照护情况。':'救助站发布档案后，会出现在这里。')}`;
  }else if(view==='new'){
    title='认识一位新伙伴';sub='先建立档案，再说说你认识的它';
    content=`<form id="pet-form" class="form-stack"><label>名字<input name="name" maxlength="80" required value="${esc(newDraft.name)}"></label><label>它是<select name="species"><option value="cat" ${newDraft.species==='cat'?'selected':''}>猫咪</option><option value="dog" ${newDraft.species==='dog'?'selected':''}>狗狗</option></select></label><label>一句介绍（可留空）<textarea name="description" maxlength="4000" rows="3">${esc(newDraft.description)}</textarea></label><label class="check-label"><input type="checkbox" name="published" ${newDraft.published?'checked':''}><span>向领养者展示档案<small>勾选后，登录的领养者可以查看并与它的 Agent 聊天。</small></span></label><button class="button primary full" ${busy?'disabled':''}>${busy?'正在保存…':'建立档案，继续语音补充'}</button></form><p class="online-note">本次接入支持语音与文字。照片、视频和自动建档还在接入中。</p>`;
  }else if(view==='voice'){
    title=draft.replacesId?'更正这条记录':'给宠物补充';sub='说完，Agent 自动整理到它的资料库';
    content=`${draft.replacesId?'<p class="online-note">提交后旧记录立即退出 Agent 资料，新内容整理完成后生效。</p>':''}<label>这次说的是<select id="voice-pet" ${busy||sender.pending||draft.replacesId?'disabled':''}>${owned().map(p=>`<option value="${esc(p.id)}" ${p.id===petId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="online-note">可以说它的习惯、爱好、饮食或最近的变化。不用分类，也不用填表。</p><label class="check-label"><input id="share-agent" type="checkbox" ${draft.share?'checked':''} ${busy||sender.pending?'disabled':''}><span>允许宠物 Agent 引用整理结果<small>关闭后仅本站可见，原始录音始终不向领养者开放。</small></span></label><button type="button" id="hold-record" class="online-voice" ${busy||sender.pending?'disabled':''} aria-label="按住录音，松开提交">${mic}<span>按住说话</span></button><p class="online-note" style="text-align:center">最长 60 秒 · 松开自动保存与整理</p>${capture.media.audioUrl?`<audio controls src="${esc(capture.media.audioUrl)}"></audio>`:''}${sender.pending?`<p class="online-note">本次提交内容已锁定。重试会沿用同一条记录，避免重复归档。</p>${btn('重试本次提交','retry-submit','','button primary full')}`:`<details ${draft.text?'open':''}><summary>也可以用文字记录</summary><label>你的观察<textarea id="observation-text" rows="4" maxlength="12000" placeholder="例如：吐司平时喜欢逗猫棒，今天换粮后有点软便，还不确定原因。">${esc(draft.text)}</textarea></label>${btn('保存并自动整理','submit-text','','button secondary full spaced')}</details>`}${busy?'<p role="status" class="online-note">正在保存，请稍候…</p>':''}`;
  }else if(view==='pet'){
    title=pet()?.name||'宠物档案';sub='档案与长期资料';
    content=`${card(`<h2>${esc(pet()?.name)}</h2><p>${esc(pet()?.profile.description||'还没有基础介绍')}</p><div class="online-actions">${ownPet()?btn('说一条新观察','voice','','button primary'):''}${btn('和它聊聊','chat')}</div>`)}<div class="section-heading"><h2>它的资料库</h2>${btn('刷新','refresh','','text-button')}</div>${notes.length?notes.map(n=>card(`<span class="live-tag">${topics[n.topic]||'观察'} · ${{ongoing:'长期观察',observation:'单次观察',pending:'待核实'}[n.certainty]||'观察'}</span><p class="spaced">${esc(n.quote)}</p><p class="online-note">${esc(n.station)} · ${date(n.recorded_at)}</p>`)).join(''):empty('还没有整理好的资料',ownPet()?'说一条观察，Agent 会在这里留下记录。':'你可以先问问它，也可以等待救助站补充资料。')}${ownPet()?`<h2 class="spaced">录入记录与进度</h2><p class="online-note">页面关闭后仍会继续整理；失败时保留原始内容，稍后可重试。</p>${records.map(r=>card(`<div class="record-status"><strong>${statusLabels[r.status]||'处理中'}</strong><time>${date(r.created_at)}</time></div><p>${esc(r.transcript||r.original_text||(r.media_id?'语音已保存，等待转写。':'暂无文字'))}</p><p class="online-note">${r.share_with_agent?'整理结果允许 Agent 引用':'仅本站可见'}</p>${r.status==='archived'&&!r.transcript&&!r.original_text?'<p>这段记录没有提取出可归档资料。</p>':''}<div class="online-actions">${r.status==='failed'?btn('重新整理','retry',`data-id="${esc(r.id)}"`):''}${r.status!=='withdrawn'?btn('更正','correct',`data-id="${esc(r.id)}"`)+btn('撤回','withdraw',`data-id="${esc(r.id)}"`):''}</div>`)).join('')||'<p class="online-note">还没有录入记录。</p>'}`:''}`;
  }else if(view==='chat'){
    title=pet()?.name||'宠物 Agent';sub='AI 分身 · 根据救助站共享资料回答';
    content=`<p class="online-note">可以问习惯、喜好和照护记录。回答会附上资料来源；不知道的事会说明。</p>${messages.map(m=>`<div class="chat-bubble ${m.role==='user'?'mine':''}">${esc(m.text)}${(m.citations||[]).map(c=>`<div class="citation">${esc(c.quote)}<br><small>${esc(c.station)} · ${date(c.recorded_at)}</small></div>`).join('')}</div>`).join('')}${busy?'<p role="status" class="online-note">正在查阅资料…</p>':''}<form id="chat-form" class="chat-compose"><label class="sr-only" for="chat-question">问问它</label><textarea id="chat-question" name="question" maxlength="2000" required placeholder="你平时喜欢玩什么？">${esc(chatText)}</textarea><button class="button primary" ${busy?'disabled':''}>发送</button></form>`;
  }
  root.innerHTML=`<div class="phone-app online-app">${header(title,sub)}<main class="main"><div id="live-error" class="online-error" role="alert">${esc(error)}</div>${notice?`<p class="online-note" role="status">${esc(notice)}</p>`:''}${content}</main></div>`;
  bindHold();
}
function date(value){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function failure(e){error=errorMessage(e);if(e?.status===401&&e.message!=='INVALID_CREDENTIALS'){user=null;view='login';epoch++;clearTimeout(pollTimer);capture.emergencyStop();sender.discard();notes=[];records=[];messages=[];}showError();}
async function resetCapture(){captureResetting=true;holding=false;await capture.reset();captureResetting=false;}
async function go(next,id){
  clearTimeout(pollTimer);epoch++;snapshot();
  if(view==='voice'&&next!=='voice'){await resetCapture();sender.discard();}
  if(next==='voice'){petId=id||petId||owned()[0]?.id;if(!owned().some(p=>p.id===petId))petId=owned()[0]?.id;if(!petId)return;draft={text:'',share:true,replacesId:null};await resetCapture();}
  if(next==='new')newDraft={name:'',species:'cat',description:'',published:false};
  if(id)petId=id;if(next==='pet'){notes=[];records=[];}view=next;error='';notice='';messages=[];chatText='';render();
  if(next==='pet')await refreshDetail();
}
async function refreshDetail(silent=false){
  const ticket=epoch,id=petId;
  try{const [k,o]=await Promise.all([api.knowledge(id),ownPet()?api.observations(id):Promise.resolve({observations:[]})]);
    if(ticket!==epoch||view!=='pet'||id!==petId)return;
    notes=k.notes;records=o.observations;if(!silent)error='';render();
  }catch(e){if(ticket===epoch){failure(e);render();}}
  if(ticket===epoch&&view==='pet'&&user&&records.some(r=>['queued','processing'].includes(r.status))){clearTimeout(pollTimer);pollTimer=setTimeout(()=>refreshDetail(true),8000);}
}
async function submitObservation(audio=null){
  if(busy)return;snapshot();busy=true;error='';render();
  try{
    const result=await sender.send({petId,text:audio?'':draft.text,audio,shareWithAgent:draft.share,replacesId:draft.replacesId});
    await resetCapture();draft={text:'',share:true,replacesId:null};view='pet';petId=result.petId;epoch++;notice='原始记录已保存，Agent 正在整理。';busy=false;render();
    // Scheduler also handles this record if the browser is closed or the request disconnects.
    const ticket=epoch;void api.processObservation(result.id).catch(()=>{}).finally(()=>{if(ticket===epoch&&view==='pet')void refreshDetail(true);});
    await refreshDetail();
  }catch(e){failure(e);}finally{busy=false;render();}
}
function bindHold(){const el=root.querySelector('#hold-record');if(!el)return;
  el.oncontextmenu=e=>e.preventDefault();
  el.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();if(!busy&&!holding&&!finishing){snapshot();holding=true;el.setPointerCapture(e.pointerId);void resetPreviousAndRecord();}};
  el.onpointerup=e=>{e.preventDefault();void finishHold();};
  el.onpointercancel=()=>void cancelHold();
  el.onblur=()=>{if(holding)void cancelHold();};
  el.onkeydown=e=>{if([' ','Enter'].includes(e.key)&&!e.repeat){e.preventDefault();if(!busy&&!holding){snapshot();holding=true;void resetPreviousAndRecord();}}};
  el.onkeyup=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();void finishHold();}};
}
async function resetPreviousAndRecord(){
  if(capture.media.audioUrl){URL.revokeObjectURL(capture.media.audioUrl);capture.media.audioUrl='';}
  await capture.recordVoice();
}
async function finishHold(){
  if(!holding||finishing)return;holding=false;finishing=true;
  await capture.stopVoice();
  try{if(capture.media.audioUrl){const audio=await (await fetch(capture.media.audioUrl)).blob();await submitObservation(audio);}else{error=error||'这次没有录到声音，请允许麦克风后重新按住。';render();}}
  finally{finishing=false;}
}
async function cancelHold(){holding=false;await capture.stopVoice();notice='录音已取消，未提交。';render();}
root.addEventListener('input',snapshot);
root.addEventListener('change',e=>{if(e.target.id==='voice-pet'){if(holding||finishing||busy||sender.pending)return;petId=e.target.value;draft.text='';void resetCapture().then(render);}else snapshot();});
root.addEventListener('click',async e=>{
  const b=e.target.closest('[data-live]');if(!b||b.disabled||busy||holding||finishing)return;
  const action=b.dataset.live,id=b.dataset.id;
  if(action==='logout'){busy=true;render();try{await api.logout();}catch{}finally{epoch++;clearTimeout(pollTimer);await resetCapture();sender.discard();user=null;pets=[];notes=[];records=[];messages=[];view='login';busy=false;error='';notice='已退出，登录信息不会保存在浏览器里。';render();}return;}
  if(['home','new','voice','pet','chat'].includes(action)){
    if(sender.pending&&!confirm('本次保存结果尚未确认。离开后请在录入记录中检查是否已保存，确定离开？'))return;
    await go(action,id);return;
  }
  if(action==='submit-text'||action==='retry-submit'){await submitObservation();return;}
  if(action==='correct'){
    const r=records.find(r=>r.id===id);if(!r)return;
    await go('voice',petId);draft={text:r.transcript||r.original_text||'',share:r.share_with_agent,replacesId:id};render();return;
  }
  if(action==='withdraw'&&!confirm('撤回后，这条资料将不再用于新的 Agent 回答。确定撤回？'))return;
  busy=true;error='';render();
  try{
    if(action==='refresh'){if(view==='pet')await refreshDetail();else pets=(await api.pets()).pets;}
    if(action==='withdraw'){await api.withdrawObservation(id);await refreshDetail();}
    if(action==='retry'){await api.retryObservation(id);void api.processObservation(id).catch(()=>{});await refreshDetail();}
  }catch(e){failure(e);}finally{busy=false;render();}
});
root.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const form=e.target,data=new FormData(form);snapshot();
  busy=true;error='';notice='';render();
  try{
    if(form.id==='login-form'){
      const result=await api.login(String(data.get('username')),String(data.get('password')));data.delete('password');
      pets=(await api.pets()).pets;user=result.user;petId='';view='home';epoch++;
    }else if(form.id==='pet-form'){
      const result=await api.createPet({name:newDraft.name,profile:{species:newDraft.species,description:newDraft.description},published:newDraft.published});
      pets=(await api.pets()).pets;await go('voice',result.id);notice='档案已建立，现在说说它的习惯和喜好。';
    }else if(form.id==='chat-form'){
      const question=String(data.get('question')).trim();if(!question)return;
      const result=await api.chat(petId,question);messages.push({role:'user',text:question},{role:'pet',text:result.answer,citations:result.citations});chatText='';
    }
  }catch(e){if(form.id==='pet-form')notice='若连接中断，请先返回列表刷新，确认档案是否已建立，再决定是否重试。';failure(e);}
  finally{busy=false;render();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&holding)void cancelHold();else if(!document.hidden&&view==='pet'&&!busy)void refreshDetail(true);});
window.addEventListener('pagehide',()=>{holding=false;clearTimeout(pollTimer);capture.emergencyStop();});
render();
