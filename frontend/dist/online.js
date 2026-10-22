import {createPawletterClient} from './pawletter-api.js';
import {createCaptureController} from './capture.js';
import {createObservationSender,errorMessage} from './online-flow.js';
import {createIntakeUI} from './intake-ui.js';
import {createStationExamples,stationScenes,exampleObservation} from './station-examples.js';
import {prepareSpeechAudio} from './audio-upload.js';
const exampleMode=new URL(location.href).searchParams.get('examples')==='1'&&new URL(location.href).searchParams.get('role')==='station';
const api=exampleMode?createStationExamples(window.sessionStorage):createPawletterClient('https://pawletter-api-446222711695.asia-east1.run.app');
const roleParam=new URL(location.href).searchParams.get('role');
const requiredRole=['station','adopter'].includes(roleParam)?roleParam:null;
const sender=createObservationSender(api),root=document.querySelector('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const topics={habits:'生活习惯',likes:'喜好与互动',diet:'饮食照护',health:'健康观察',other:'其他观察'};
const statusLabels={queued:'已保存 · 等待整理',processing:'Agent 正在整理',archived:'已归档',failed:'整理失败 · 可以重试',withdrawn:'已撤回'};
let user=null,pets=[],view='login',petId='',notes=[],records=[],messages=[],busy=false,error='',notice='',epoch=0,pollTimer,holding=false,finishing=false;
let draft={text:'',share:true,replacesId:null},chatText='';
let applications=[],applicationId='';
let intakeDetails={};
let agentVoice={tone:'gentle',style:''};
let newDraft={name:'',species:'cat',description:'',published:false};
let captureResetting=false;
const intake=createIntakeUI({api,exampleMode,root,redraw:render,onDone:async result=>{intake.stop();pets=(await api.pets()).pets;await go('pet',result.id);notice='档案已建立，已确认的观察正在整理。';if(result.observationId)void api.processObservation(result.observationId).then(()=>refreshDetail()).catch(()=>{});render();}});
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
  if(!user&&requiredRole==='station'){title='救助站登录';sub='使用已开通的站点账号';}
  if(!user&&requiredRole==='adopter'){title='领养者登录';sub='登录你的领养者账号';}
  if(!user){
    content=`<p class="eyebrow">${requiredRole==='station'?'FOR EVERY LITTLE LIFE':'A REAL CONNECTION'}</p><h1>${requiredRole==='station'?'照顾它的日常，<br>从一句话开始。':'让每次了解，<br>都留下真实的记忆。'}</h1>${card(`<form id="login-form" class="form-stack"><label>${requiredRole==='station'?'站点账号':'账号'}<input name="username" autocomplete="username" required maxlength="64" autocapitalize="none" spellcheck="false"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label><button class="button primary full" ${busy?'disabled':''}>${busy?'正在登录…':requiredRole==='station'?'登录救助站':'登录'}</button></form>`)}<p class="online-note">账号由管理员开通，救助站权限随账号分配。当前开放宠物资料、语音补充与 Agent 问答；领养者可从首页注册；实名核验服务与自动回访仍待接入。</p><a class="text-button" href="./">返回领养者界面</a>`;
  }else if(view==='scenes'){
    title='救助站示例场景';sub='独立示例，不写入正式账号';content=stationScenes.map(([id,label,desc])=>`<button class="online-pet" data-live="scene" data-id="${id}"><span><strong>${label}</strong><small>${desc}</small></span><span>›</span></button>`).join('')+btn('重置所有示例','reset-examples','','button secondary full spaced');
  }else if(['home','pets','applications'].includes(view)){
    title=station()?'救助站工作台':'认识你的新伙伴';sub='资料与记录已连接云端';
    const list=station()?owned():pets;
    const queue=applications.filter(a=>a.stage>=0&&a.stage<3);
    const petRows=list.map(p=>`<button class="online-pet" data-live="pet" data-id="${esc(p.id)}">${p.profile.photoUrl?`<img class="pet-symbol" src="${esc(p.profile.photoUrl)}" alt="${esc(p.name)}">`:'<span class="pet-symbol">🐾</span>'}<span><strong>${esc(p.name)}</strong><small>${esc(p.profile.description||'一起慢慢认识它')}</small></span><span>›</span></button>`).join('');
    const appRows=(view==='home'?queue:applications).map(a=>`<button class="online-pet" data-live="application" data-id="${esc(a.id)}"><span><strong>${esc(a.name)} → ${esc(pets.find(p=>p.id===a.petId)?.name||'宠物')}</strong><small>${['待审核','待见面','待交接','已完成'][a.stage]||'已结束'} · ${a.snapshot.verification==='verified'?'实名已核验':'实名待核验'}</small></span><span>›</span></button>`).join('');
    if(view==='pets')title='站内伙伴';if(view==='applications')title='领养申请';
    if(station()&&!list.length&&view!=='applications')content=`<section class="station-welcome"><div class="welcome-paw">🐾</div><p class="eyebrow">HELLO, LITTLE FRIEND</p><h1>第一位伙伴，<br>从一张照片开始。</h1><p>拍下它，说说它。小助手整理档案，<br>以后每次补充都是它的新记忆。</p>${btn('拍下第一位伙伴','new','','button primary full')}<small>拍摄 → 语音介绍 → 确认建档</small></section>`;
    else content=`${station()&&view==='home'?`<div class="station-summary"><strong>${list.length}<small>位伙伴</small></strong><strong>${queue.length}<small>份待处理申请</small></strong></div>`:''}${view!=='pets'&&station()?`<div class="section-heading"><h2>${view==='applications'?'全部申请':'需要你看看'}</h2></div>${appRows||empty('暂时没有待处理申请','可以记录伙伴今天的新变化。')}`:''}${view!=='applications'?`<div class="section-heading"><h2>${station()?'站内宠物':'待认识的小伙伴'} · ${list.length}</h2>${btn('刷新','refresh','','text-button')}</div>${petRows||empty('暂时没有可查看的宠物','救助站发布后会出现在这里。')}`:''}`;
  }else if(view==='new'){
    title='认识一位新伙伴';sub='拍下它，再一起聊聊它';content=intake.render();
  }else if(view==='voice'){
    title=draft.replacesId?'更正这条记录':'给宠物补充';sub='说完，Agent 自动整理到它的资料库';
    content=`${draft.replacesId?'<p class="online-note">提交后旧记录立即退出 Agent 资料，新内容整理完成后生效。</p>':''}<label>这次说的是<select id="voice-pet" ${busy||sender.pending||draft.replacesId?'disabled':''}>${owned().map(p=>`<option value="${esc(p.id)}" ${p.id===petId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="online-note">可以说它的习惯、爱好、饮食或最近的变化。不用分类，也不用填表。</p><label class="check-label"><input id="share-agent" type="checkbox" ${draft.share?'checked':''} ${busy||sender.pending?'disabled':''}><span>允许宠物 Agent 引用整理结果<small>关闭后仅本站可见，原始录音始终不向领养者开放。</small></span></label>${exampleMode?btn('使用示例口述并归档','sample-observation','','button primary full'):''}<button type="button" id="hold-record" class="online-voice" ${busy||sender.pending||exampleMode?'disabled':''} aria-label="按住录音，松开提交">${mic}<span>按住说话</span></button><p class="online-note" style="text-align:center">最长 60 秒 · 松开归档 · 上滑取消</p>${capture.media.audioUrl?`<audio controls src="${esc(capture.media.audioUrl)}"></audio>`:''}${sender.pending?`<p class="online-note">本次提交内容已锁定。重试会沿用同一条记录，避免重复归档。</p>${btn('重试本次提交','retry-submit','','button primary full')}`:`<details ${draft.text?'open':''}><summary>也可以用文字记录</summary><label>你的观察<textarea id="observation-text" rows="4" maxlength="12000" placeholder="例如：吐司平时喜欢逗猫棒，今天换粮后有点软便，还不确定原因。">${esc(draft.text)}</textarea></label>${btn('保存并自动整理','submit-text','','button secondary full spaced')}</details>`}${busy?'<p role="status" class="online-note">正在保存，请稍候…</p>':''}`;
  }else if(view==='pet'){
    title=pet()?.name||'宠物档案';sub='档案与长期资料';
    content=`${pet()?.profile.photoUrl?`<img class="station-pet-cover" src="${esc(pet().profile.photoUrl)}" alt="${esc(pet().name)}">`:''}${card(`<h2>${esc(pet()?.name)}</h2><p>${esc(pet()?.profile.description||'还没有基础介绍')}</p><div class="online-actions">${ownPet()?btn('说一条新观察','voice','','button primary'):''}${btn('和它聊聊','chat')}${ownPet()?btn('分身表达','agent','','text-button'):''}</div>`)}<div class="section-heading"><h2>它的资料库</h2>${btn('刷新','refresh','','text-button')}</div>${notes.length?notes.map(n=>card(`<span class="live-tag">${topics[n.topic]||'观察'} · ${{ongoing:'长期观察',observation:'单次观察',pending:'待核实'}[n.certainty]||'观察'}</span><p class="spaced">${esc(n.quote)}</p><p class="online-note">${esc(n.station)} · ${date(n.recorded_at)}</p>`)).join(''):empty('还没有整理好的资料',ownPet()?'说一条观察，Agent 会在这里留下记录。':'你可以先问问它，也可以等待救助站补充资料。')}${ownPet()?`${intakeDetails.visuals?.length?`<details><summary>查看全部照片与视频</summary><div class="station-visual-gallery">${intakeDetails.visuals.map(v=>v.mime.startsWith('video/')?`<video src="${esc(v.url)}" controls playsinline></video>`:`<img src="${esc(v.url)}" alt="${esc(pet()?.name)}的档案照片">`).join('')}</div></details>`:''}${intakeDetails.source_text||intakeDetails.ocr_text?`<details><summary>建档原始口述与材料 · 仅本站可见</summary><p style="white-space:pre-wrap">${esc(intakeDetails.source_text)}</p><p style="white-space:pre-wrap">${esc(intakeDetails.ocr_text)}</p></details>`:''}<h2 class="spaced">录入记录与进度</h2><p class="online-note">页面关闭后仍会继续整理；失败时保留原始内容，稍后可重试。</p>${records.map(r=>card(`<div class="record-status"><strong>${statusLabels[r.status]||'处理中'}</strong><time>${date(r.created_at)}</time></div><p>${esc(r.transcript||r.original_text||(r.media_id?'语音已保存，等待转写。':'暂无文字'))}</p><p class="online-note">${r.share_with_agent?'整理结果允许 Agent 引用':'仅本站可见'}</p>${r.status==='archived'&&!r.transcript&&!r.original_text?'<p>这段记录没有提取出可归档资料。</p>':''}<div class="online-actions">${r.status==='failed'?btn('重新整理','retry',`data-id="${esc(r.id)}"`):''}${r.status!=='withdrawn'?btn('更正','correct',`data-id="${esc(r.id)}"`)+btn('撤回','withdraw',`data-id="${esc(r.id)}"`):''}</div>`)).join('')||'<p class="online-note">还没有录入记录。</p>'}`:''}`;
  }else if(view==='application'){
    const a=applications.find(a=>a.id===applicationId),profile=a?.snapshot;
    title='领养申请';sub='申请人确认分享的个人资料';
    content=!a?empty('申请暂时无法查看','返回工作台刷新后重试。'):`${card(`<h2>${esc(a.name)} → ${esc(pets.find(p=>p.id===a.petId)?.name||'宠物')}</h2><p>${['待审核','待见面','待交接','已完成'][a.stage]||'已结束'}</p><p class="online-note">实名：${profile.verification==='verified'?'已核验':'待核验'}</p><p>${esc(profile.realName)} · ${esc(profile.phone)}</p><p>${esc(profile.wechat||'')}${profile.email?' · '+esc(profile.email):''}</p>`)}${card(`<h3>${esc(profile.lifestyle?.analysis?.title||'生活画像')}</h3><p>${esc(profile.lifestyle?.analysis?.summary||'')}</p><details><summary>全部访谈回答与偏好</summary>${Object.values(profile.lifestyle?.answers||{}).map(v=>`<p>${esc(v.text)}</p>`).join('')}<p>${(profile.memories||[]).map(esc).join('；')}</p></details><h3 class="spaced">补充资料与问题</h3><p>${esc(a.note)}</p>`)}${a.stage>=0&&a.stage<3?`<div class="online-actions">${btn(['同意见面','确认见面完成','确认交接'][a.stage],'application-next',a.stage===2&&profile.verification!=='verified'?'disabled':'','button primary')}${btn('结束申请','application-close','','button secondary')}</div>${a.stage===2&&profile.verification!=='verified'?'<p class="online-note">实名尚待核验，暂不能确认交接。</p>':''}`:''}`;
  }else if(view==='agent'){
    title=(pet()?.name||'它')+'的 AI 分身';sub='档案决定事实，风格决定表达';
    content=`<div class="info-box"><p>所有事实来自你维护的宠物档案与有效观察。这里仅调整说话方式，不会补写习惯、经历或健康情况。</p></div><form id="agent-voice-form" class="form-stack spaced"><label>说话口吻<select name="tone">${Object.entries({gentle:'温柔自然',shy:'慢热腼腆',calm:'安静简洁',lively:'轻快活泼'}).map(([key,label])=>`<option value="${key}" ${agentVoice.tone===key?'selected':''}>${label}</option>`).join('')}</select></label><label>表达偏好（选填）<textarea name="style" rows="3" maxlength="200" placeholder="例如：短句，少用语气词，保留一点腼腆。">${esc(agentVoice.style)}</textarea></label><button class="button primary full" ${busy?'disabled':''}>保存分身表达</button></form><p class="online-note">性格、习惯或照护情况有变化，请通过语音补充长期档案；没有记载的内容，AI 会明确表示不知道。</p>${btn('补充宠物档案','voice','','button secondary full')}`;
  }else if(view==='chat'){
    title=pet()?.name||'宠物 Agent';sub='AI 分身 · 根据救助站共享资料回答';
    content=`<p class="online-note">可以问习惯、喜好和照护记录。回答会附上资料来源；不知道的事会说明。</p>${messages.map(m=>`<div class="chat-bubble ${m.role==='user'?'mine':''}">${esc(m.text)}${(m.citations||[]).map(c=>`<div class="citation">${esc(c.quote)}<br><small>${esc(c.station)} · ${date(c.recorded_at)}</small></div>`).join('')}</div>`).join('')}${busy?'<p role="status" class="online-note">正在查阅资料…</p>':''}<form id="chat-form" class="chat-compose"><label class="sr-only" for="chat-question">问问它</label><textarea id="chat-question" name="question" maxlength="2000" required placeholder="你平时喜欢玩什么？">${esc(chatText)}</textarea><button class="button primary" ${busy?'disabled':''}>发送</button></form>`;
  }
  const nav=station()&&['home','pets','applications'].includes(view);
  const dock=nav&&owned().length;
  root.innerHTML=`<div class="phone-app online-app ${nav?'station-nav-page':''} ${dock?'station-dock-page':''}">${header(title,sub)}<main class="main"><div id="live-error" class="online-error" role="alert">${esc(error)}</div>${notice?`<p class="online-note" role="status">${esc(notice)}</p>`:''}${exampleMode?`<div class="station-example-bar"><span>救助站示例 · 本页独立保存</span>${btn('切换场景','scenes','','text-button')}<a href="?mode=online&role=station">正式登录</a></div>`:''}${content}${!exampleMode&&(!user||view==='home')?'<a class="station-example-link" href="?mode=online&role=station&examples=1" target="_blank" rel="noopener">先看看救助站示例 →</a>':''}</main>${dock?`<div class="station-action-dock">${btn('＋ 录入新伙伴','new','','button secondary')}${btn('＋ 补充日常','voice','','button primary')}</div>`:''}${nav?`<nav class="station-nav" aria-label="救助站导航">${[['home','⌂','工作台'],['pets','♧','宠物'],['applications','▤','申请']].map(([id,icon,label])=>`<button data-live="${id}" ${view===id?'aria-current="page"':''}><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav>`:''}</div>`;
  bindHold();if(view==='new')intake.bind();
}
function date(value){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function failure(e){error=errorMessage(e);if(e?.status===401&&e.message!=='INVALID_CREDENTIALS'){user=null;view='login';epoch++;clearTimeout(pollTimer);capture.emergencyStop();sender.discard();notes=[];records=[];messages=[];}showError();}
async function resetCapture(){captureResetting=true;holding=false;await capture.reset();captureResetting=false;}
async function go(next,id){
  if(view==='new'&&intake.busy)return;if(view==='new'&&next!=='new')intake.stop();
  clearTimeout(pollTimer);epoch++;snapshot();
  if(view==='voice'&&next!=='voice'){await resetCapture();sender.discard();}
  if(next==='voice'){petId=id||petId||owned()[0]?.id;if(!owned().some(p=>p.id===petId))petId=owned()[0]?.id;if(!petId)return;draft={text:'',share:true,replacesId:null};await resetCapture();}
  if(next==='new')intake.reset();
  if(id)petId=id;if(next==='pet'){notes=[];records=[];intakeDetails={};}view=next;error='';notice='';messages=[];chatText='';render();root.scrollIntoView?.({block:'start'});
  if(next==='pet')await refreshDetail();
}
async function refreshDetail(silent=false){
  const ticket=epoch,id=petId;
  try{const [k,o,source]=await Promise.all([api.knowledge(id),ownPet()?api.observations(id):Promise.resolve({observations:[]}),ownPet()&&api.intake?api.intake(id):Promise.resolve({})]);
    if(ticket!==epoch||view!=='pet'||id!==petId)return;
    notes=k.notes;records=o.observations;intakeDetails=source;if(!silent)error='';render();
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
  let startY=0,cancelled=false;el.onpointermove=e=>{if(holding){cancelled=startY-e.clientY>65;el.querySelector('span').textContent=cancelled?'松手取消':'松开归档 · 上滑取消';}};
  el.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();if(!busy&&!holding&&!finishing){snapshot();startY=e.clientY;cancelled=false;holding=true;el.setPointerCapture(e.pointerId);void resetPreviousAndRecord();}};
  el.onpointerup=e=>{e.preventDefault();void(cancelled?cancelHold():finishHold());};
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
  try{if(capture.media.audioUrl){const audio=await (await fetch(capture.media.audioUrl)).blob();await submitObservation(await prepareSpeechAudio(audio));}else{error=error||'这次没有录到声音，请允许麦克风后重新按住。';render();}}
  catch(e){failure(e);render();}finally{finishing=false;}
}
async function cancelHold(){holding=false;await capture.stopVoice();notice='录音已取消，未提交。';render();}
root.addEventListener('input',snapshot);
root.addEventListener('change',e=>{if(e.target.id==='voice-pet'){if(holding||finishing||busy||sender.pending)return;petId=e.target.value;draft.text='';void resetCapture().then(render);}else snapshot();});
root.addEventListener('click',async e=>{
  const b=e.target.closest('[data-live]');if(!b||b.disabled||busy||holding||finishing)return;
  const action=b.dataset.live,id=b.dataset.id;
  if(view==='new'&&intake.busy)return;
  if(action==='sample-observation'){draft.text=exampleObservation;const field=root.querySelector('#observation-text');if(field)field.value=draft.text;await submitObservation();return;}
  if(action==='scenes'){await go('scenes');return;}
  if(action==='reset-examples'||action==='scene'){if(action==='reset-examples'||id==='empty'||!owned().length)api.reset(id==='empty');pets=(await api.pets()).pets;applications=(await api.applications()).applications;petId=owned()[0]?.id||'';applicationId=applications[0]?.id||'';if(id==='agent')agentVoice=(await api.agent(petId)).voice;await go(action==='reset-examples'?'scenes':id==='empty'?'home':['failed','private'].includes(id)?'pet':id);return;}
  if(action==='logout'){if(!confirm('确定退出救助站账号？'))return;busy=true;render();try{await api.logout();}catch{}finally{epoch++;clearTimeout(pollTimer);await resetCapture();sender.discard();user=null;pets=[];notes=[];records=[];messages=[];view='login';busy=false;error='';notice='已退出，登录信息不会保存在浏览器里。';render();}return;}
  if(action==='application'){applicationId=id;await go('application');return;}
  if(action==='application-next'||action==='application-close'){const a=applications.find(a=>a.id===applicationId);if(!a)return;if(!confirm(action==='application-close'?'确定结束这份申请？':'确认推进到下一阶段？'))return;busy=true;try{const updated=await api.applicationStage(a.id,action==='application-close'?-1:a.stage+1,a.version);Object.assign(a,updated);notice='申请状态已更新，宠物分身会通知申请人。';}catch(e){failure(e);}finally{busy=false;render();}return;}
  if(action==='agent'){try{agentVoice=(await api.agent(petId)).voice;await go('agent');}catch(e){failure(e);}return;}
  if(['home','pets','applications','new','voice','pet','chat'].includes(action)){
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
    if(action==='refresh'){if(view==='pet')await refreshDetail();else{pets=(await api.pets()).pets;applications=(await api.applications()).applications;}}
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
      if(requiredRole&&result.user.role!==requiredRole){await api.logout();throw new Error('ROLE_MISMATCH');}
      pets=(await api.pets()).pets;user=result.user;applications=(await api.applications()).applications;petId='';view='home';epoch++;
    }else if(form.id==='pet-form'){
      const result=await api.createPet({name:newDraft.name,profile:{species:newDraft.species,description:newDraft.description},published:newDraft.published});
      pets=(await api.pets()).pets;await go('voice',result.id);notice='档案已建立，现在说说它的习惯和喜好。';
    }else if(form.id==='agent-voice-form'){
      agentVoice=(await api.updateAgent(petId,{tone:String(data.get('tone')),style:String(data.get('style')||'')})).voice;notice='分身表达已保存，下次回答将使用新口吻。';
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
if(exampleMode){user=api.user();pets=(await api.pets()).pets;applications=(await api.applications()).applications;view='home';render();}
