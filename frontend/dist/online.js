import {escapeDisplay as esc} from './display-text.js';
import {createStationMedia} from './station-media.js';
import {knowledgePanel,recordPanel,gallery,setCategory} from './station-records.js';
import {workspaceFilters,recordFilters,applicationList,petList,summary,followupList,contactCard,applicantPage,followupNames,pair,chips} from './station-workspace.js';
import {createOnboardingSpeech} from './onboarding-speech.js';
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
const topics={habits:'生活习惯',likes:'喜好与互动',diet:'饮食照护',health:'健康观察',other:'其他观察'};
const statusLabels={queued:'已保存 · 等待整理',processing:'Agent 正在整理',archived:'已归档',failed:'整理失败 · 可以重试',withdrawn:'已撤回'};
let user=null,pets=[],view='login',petId='',notes=[],records=[],messages=[],busy=false,error='',notice='',epoch=0,pollTimer,holding=false,finishing=false;
let draft={text:'',share:true,replacesId:null},chatText='';
let applications=[],applicationId='',followups=[],followupId='',followupKey=crypto.randomUUID(),followDraft=null,followPayload=null;
const speech=createOnboardingSpeech();
let intakeDetails={};
let agentVoice={tone:'gentle',style:''};
let newDraft={name:'',species:'cat',description:'',published:false};
let captureResetting=false;
const intake=createIntakeUI({api,exampleMode,root,redraw:render,onDone:async result=>{intake.stop();pets=(await api.pets()).pets;await go('pet',result.id);notice='档案已建立，已确认的观察正在整理。';if(result.observationId)void api.processObservation(result.observationId).then(()=>refreshDetail()).catch(()=>{});render();}});
const mediaUpload=createStationMedia({api,root,redraw:render,onError:message=>{error=message;},onSaved:async()=>{pets=(await api.pets()).pets;await go('pet',petId);notice='照片与视频已保存到档案。';}});
const station=()=>user?.role==='station';
const owned=()=>pets.filter(p=>p.stationId===user?.stationId);
const pet=()=>pets.find(p=>p.id===petId);
const ownPet=()=>station()&&pet()?.stationId===user.stationId;
const mic='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
const capture=createCaptureController({onChange(){
  for(const field of root.querySelectorAll('#voice-pet,#share-agent,#observation-text'))field.disabled=holding||finishing||busy||sender.pending||!!(field.id==='voice-pet'&&draft.replacesId);
  const b=root.querySelector('#hold-record');
  if(b){b.classList.toggle('recording',!!capture.media.voiceRecorder);b.querySelector('span').textContent=capture.media.voicePending?'请允许麦克风':capture.media.voiceRecorder?`松开转录 · ${capture.media.audioSeconds} 秒`:'按住说话';}
  if(!captureResetting&&holding&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)void finishHold();
},onError(message){error=message.replace(/，?或体验示例口述。/g,'。').replace(/或体验示例口述/g,'');showError();}});
const btn=(label,action,extra='',cls='button secondary')=>`<button type="button" class="${cls}" data-live="${action}" ${busy?'disabled':''} ${extra}>${label}</button>`;
const header=(title,subtitle='')=>`<header class="topbar">${user&&view!=='home'?btn('‹','home','aria-label="返回宠物列表"','icon-button'):''}<div class="topbar-title"><strong>${esc(title)}</strong>${subtitle?`<small>${esc(subtitle)}</small>`:''}</div>${user?btn('退出','logout','','text-button'):''}</header>`;
const card=content=>`<section class="online-card">${content}</section>`;
const empty=(title,body)=>card(`<h2>${title}</h2><p class="online-note">${body}</p>`);
function showError(){const box=root.querySelector('#live-error');if(box)box.textContent=error;}
function snapshot(){
  if(view==='voice'){draft.text=root.querySelector('#observation-text')?.value??draft.text;draft.share=root.querySelector('#share-agent')?.checked??draft.share;}
  if(['followup','followup-new'].includes(view)){const f=root.querySelector('#followup-form');if(f&&!followPayload){const d=new FormData(f);followDraft={note:String(d.get('note')||''),dueAt:String(d.get('dueAt')||''),status:String(d.get('status')||'pending')};}}
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
  }else if(['home','pets','applications','followups'].includes(view)){
    title=station()?'救助站工作台':'认识你的新伙伴';sub='资料与记录已连接云端';
    const list=station()?owned():pets;
    if(view==='pets')title='站内伙伴';if(view==='applications')title='领养申请';if(view==='followups')title='回访跟踪';
    if(station()&&!list.length&&view==='home')content=`<section class="station-welcome"><div class="welcome-paw">🐾</div><h1>第一位伙伴，<br>从一张照片开始。</h1><p>拍下它，再和小助手聊聊。确认后建立档案。</p>${btn('拍下第一位伙伴','new','','button primary full')}</section>`;
    else if(view==='followups')content=followupList(followups,applications,pets);
    else if(view==='applications')content=applicationList(applications,pets);
    else if(view==='pets'||!station())content=petList(list,applications);
    else content=summary(list,applications,followups)+`<div class="section-heading"><h2>需要你看看</h2>${btn('刷新','refresh','','text-button')}</div>`+applicationList(applications,pets,{home:true});
  }else if(view==='new'){
    title='认识一位新伙伴';sub='拍下它，再一起聊聊它';content=intake.render();
  }else if(view==='voice'){
    title=draft.replacesId?'更正这条记录':'给宠物补充';sub='按住说 → 核对文字 → 确认归档';
    content=`<label>这次说的是<select id="voice-pet" ${busy||sender.pending||draft.replacesId?'disabled':''}>${owned().map(p=>`<option value="${esc(p.id)}" ${p.id===petId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><div class="voice-conversation"><div class="chat-bubble">我是档案小助手。说说${esc(pet()?.name||'它')}今天的新变化，我会把转录文字放在这里，等你确认后再整理归档。</div>${draft.text?`<div class="chat-bubble">我听到的是下面这些。你可以直接修改文字，确认无误再保存。</div><label>核对转录<textarea id="observation-text" rows="4" maxlength="12000">${esc(draft.text)}</textarea></label>${btn('确认文字，归档','submit-text','','button primary full spaced')}`:`<details><summary>也可以打字告诉我</summary><textarea id="observation-text" rows="4" maxlength="12000" placeholder="记录习惯、饮食或今天的新变化"></textarea>${btn('确认文字，归档','submit-text','','button secondary full')}</details>`}${sender.pending?btn('重试本次提交','retry-submit','','button primary full'):''}${capture.media.audioUrl?`<details ${error?'open':''}><summary>回听这段录音</summary><audio controls src="${esc(capture.media.audioUrl)}"></audio>${btn('重新转录','transcribe-again','','text-button')}</details>`:''}<details><summary>资料可见范围</summary><label class="check-label"><input id="share-agent" type="checkbox" ${draft.share?'checked':''}><span>允许宠物 Agent 引用确认后的整理结果<small>关闭后仅本站可见。</small></span></label></details></div><div class="voice-composer">${exampleMode?`${btn('试一段示例口述','sample-observation','','button primary full')}<p class="online-note">示例使用预设文字，不录音、不上传。<a href="?mode=online&role=station">正式登录后使用真实语音</a></p>`:''}${!exampleMode?`<button type="button" id="hold-record" class="online-voice" ${busy||sender.pending?'disabled':''} aria-label="按住录音，松开转录">${mic}<span>按住说话</span></button><p class="online-note">松开转录 · 上滑取消 · 确认后归档</p>`:''}${busy?'<p role="status">正在保存…</p>':''}</div>`;
  }else if(view==='pet'){
    title=pet()?.name||'宠物档案';sub='档案与长期资料';
    content=gallery(intakeDetails.visuals,pet(),ownPet())+card(`<h2>${esc(pet()?.name)}</h2><p>${esc(pet()?.profile.description||'还没有基础介绍')}</p>${ownPet()?`<div class="pet-visibility"><div><strong>向领养者公开</strong><small>${pet().published?'已公开 · 可查看档案并与分身聊天':'未公开 · 当前仅本站可见'}</small></div><button type="button" role="switch" aria-label="向领养者公开" aria-checked="${!!pet().published}" data-live="toggle-visibility" class="visibility-switch" ${busy?'disabled':''}><span></span></button></div><p class="visibility-note">仅本站可见的影像、内部记录和原始材料不会随档案公开。</p>`:''}<div class="online-actions">${ownPet()?btn('说一条新观察','voice','','button primary'):''}${btn('和它聊聊','chat')}${ownPet()?btn('分身表达','agent','','text-button'):''}</div>`)+knowledgePanel(notes,ownPet())+(ownPet()?`${intakeDetails.source_text||intakeDetails.ocr_text?`<details><summary>建档原始口述与材料 · 仅本站可见</summary><p>${esc(intakeDetails.source_text)}</p><p>${esc(intakeDetails.ocr_text)}</p></details>`:''}${recordPanel(records)}`:'');
  }else if(view==='media'){
    title='补充影像';sub=pet()?.name||'宠物长期档案';content=mediaUpload.render();
  }else if(view==='application'){
    const a=applications.find(a=>a.id===applicationId),profile=a?.snapshot;
    title='领养申请';sub='申请人确认分享的个人资料';
    content=!a?empty('申请暂时无法查看','返回工作台刷新后重试。'):`${contactCard(a,pets.find(p=>p.id===a.petId))}${card(`<h3>${esc(profile.lifestyle?.analysis?.title||'生活画像')}</h3><p>${esc(profile.lifestyle?.analysis?.summary||'')}</p><details><summary>全部访谈回答与偏好</summary>${Object.values(profile.lifestyle?.answers||{}).map(v=>`<p>${esc(v.text)}</p>`).join('')}<p>${(profile.memories||[]).map(esc).join('；')}</p></details><h3 class="spaced">补充资料与问题</h3><p>${esc(a.note)}</p>`)}${a.stage>=0&&a.stage<3?`<div class="online-actions">${btn(['同意见面','确认见面完成','确认交接'][a.stage],'application-next',a.stage===2&&profile.verification!=='verified'?'disabled':'','button primary')}${btn('结束申请','application-close','','button secondary')}</div>${a.stage===2&&profile.verification!=='verified'?'<p class="online-note">实名尚待核验，暂不能确认交接。</p>':''}`:''}`;
  }else if(view==='applicant'){
    title='领养者主页';sub='申请人分享给本站的资料';const a=applications.find(a=>a.id===applicationId);content=a?applicantPage(a,applications,pets):empty('暂时无法查看','返回申请详情重试。');
  }else if(view==='followup'||view==='followup-new'){
    const f=followups.find(f=>f.id===followupId),a=applications.find(a=>a.id===(f?.applicationId||applicationId));title=f?'回访记录':'安排回访';sub='记录到家后的生活与照护情况';
    content=a?contactCard(a,pets.find(p=>p.id===a.petId))+`<section class="online-card"><h2>${f?'跟进进度':'第一次回访'}</h2>${(f?.history||[]).map(h=>`<p><small>${date(h.at||h.createdAt||f.updatedAt)} · ${followupNames[h.status]||'已安排'}</small><br>${esc(h.text)}</p>`).join('')}<form id="followup-form" class="form-stack"><fieldset class="form-stack" ${followPayload?'disabled':''}>${f?`<label>本次状态<select name="status">${Object.entries(followupNames).map(([id,label])=>`<option value="${id}" ${(followDraft?.status||f.status)===id?'selected':''}>${label}</option>`).join('')}</select></label>`:''}<label>回访时间<input name="dueAt" type="datetime-local" required value="${followDraft?.dueAt||new Date((f?Date.parse(f.dueAt):Date.now()+86400000)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}"></label><label>记录与下一步<textarea name="note" required maxlength="2000" rows="4" placeholder="记录沟通结果、待确认的问题或下一次安排">${esc(followDraft?.note||'')}</textarea></label></fieldset><button class="button primary full">${followPayload?'重试同一条记录':f?'保存跟进记录':'安排回访'}</button></form><p class="online-note">保存到本站回访清单；联系领养者请使用上方电话或微信。</p></section>`:empty('没有找到对应申请','请返回回访列表。');
  }else if(view==='agent'){
    title=(pet()?.name||'它')+'的 AI 分身';sub='档案决定事实，风格决定表达';
    content=`<div class="info-box"><p>所有事实来自你维护的宠物档案与有效观察。这里仅调整说话方式，不会补写习惯、经历或健康情况。</p></div><form id="agent-voice-form" class="form-stack spaced"><label>说话口吻<select name="tone">${Object.entries({gentle:'温柔自然',shy:'慢热腼腆',calm:'安静简洁',lively:'轻快活泼'}).map(([key,label])=>`<option value="${key}" ${agentVoice.tone===key?'selected':''}>${label}</option>`).join('')}</select></label><label>表达偏好（选填）<textarea name="style" rows="3" maxlength="200" placeholder="例如：短句，少用语气词，保留一点腼腆。">${esc(agentVoice.style)}</textarea></label><button class="button primary full" ${busy?'disabled':''}>保存分身表达</button></form><p class="online-note">性格、习惯或照护情况有变化，请通过语音补充长期档案；没有记载的内容，AI 会明确表示不知道。</p>${btn('补充宠物档案','voice','','button secondary full')}`;
  }else if(view==='chat'){
    title=pet()?.name||'宠物 Agent';sub='AI 分身 · 根据救助站共享资料回答';
    content=`<p class="online-note">可以问习惯、喜好和照护记录。分身会根据照顾者的记录回答，不知道的事会说明。</p>${messages.map(m=>`<div class="chat-bubble ${m.role==='user'?'mine':''}">${esc(m.text)}</div>`).join('')}${busy?'<p role="status" class="online-note">正在查阅资料…</p>':''}<form id="chat-form" class="chat-compose"><label class="sr-only" for="chat-question">问问它</label><textarea id="chat-question" name="question" maxlength="2000" required placeholder="你平时喜欢玩什么？">${esc(chatText)}</textarea><button class="button primary" ${busy?'disabled':''}>发送</button></form>`;
  }
  const nav=station()&&['home','pets','applications','followups'].includes(view);
  const dock=nav&&owned().length;
  root.innerHTML=`<div class="phone-app online-app ${view==='new'?'intake-chat-page':''} ${view==='voice'?'voice-chat-page':''} ${nav?'station-nav-page':''} ${dock?'station-dock-page':''}">${header(title,sub)}<main class="main"><div id="live-error" class="online-error" role="alert">${esc(error)}</div>${notice?`<p class="online-note" role="status">${esc(notice)}</p>`:''}${exampleMode?`<div class="station-example-bar"><span>救助站示例 · 本页独立保存</span>${btn('切换场景','scenes','','text-button')}<a href="?mode=online&role=station">正式登录</a></div>`:''}${content}${!exampleMode&&(!user||view==='home')?'<a class="station-example-link" href="?mode=online&role=station&examples=1" target="_blank" rel="noopener">先看看救助站示例 →</a>':''}</main>${dock?`<div class="station-action-dock">${btn('＋ 录入新伙伴','new','','button secondary')}${btn('＋ 补充日常','voice','','button primary')}</div>`:''}${nav?`<nav class="station-nav" aria-label="救助站导航">${[['home','⌂','工作台'],['pets','♧','宠物'],['applications','▤','申请'],['followups','◷','回访']].map(([id,icon,label])=>`<button data-live="${id}" ${view===id?'aria-current="page"':''}><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav>`:''}</div>`;
  bindHold();if(view==='new')intake.bind();
}
function date(value){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function failure(e){error=errorMessage(e);if(e?.status===401&&e.message!=='INVALID_CREDENTIALS'){user=null;view='login';epoch++;clearTimeout(pollTimer);capture.emergencyStop();sender.discard();notes=[];records=[];messages=[];}showError();}
async function resetCapture(){captureResetting=true;holding=false;await capture.reset();captureResetting=false;}
async function go(next,id){
  if(mediaUpload.busy)return;if(view==='new'&&intake.busy)return;if(view==='new'&&next!=='new')intake.stop();
  clearTimeout(pollTimer);epoch++;snapshot();
  if(view==='voice'&&next!=='voice'){await resetCapture();sender.discard();}
  if(next==='voice'){petId=id||petId||owned()[0]?.id;if(!owned().some(p=>p.id===petId))petId=owned()[0]?.id;if(!petId)return;draft={text:'',share:true,replacesId:null};await resetCapture();}
  if(next==='new')intake.reset();
  if(id)petId=id;if(next==='pet'){notes=[];records=[];intakeDetails={};Object.assign(recordFilters,{q:'',status:'all',from:'',to:'',order:'desc',id:''});setCategory('all');}view=next;error='';notice='';messages=[];chatText='';render();root.scrollIntoView?.({block:'start'});
  if(next==='pet')await refreshDetail();
}
async function refreshDetail(silent=false){
  const ticket=epoch,id=petId;
  try{const [k,o,source]=await Promise.all([api.knowledge(id),ownPet()?api.observations(id,recordFilters):Promise.resolve({observations:[]}),ownPet()&&api.intake?api.intake(id):Promise.resolve({})]);
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
function bindHold(){if(exampleMode)return;const el=root.querySelector('#hold-record');if(!el)return;
  el.oncontextmenu=e=>e.preventDefault();
  let startY=0,cancelled=false;el.onpointermove=e=>{if(holding){cancelled=startY-e.clientY>65;el.querySelector('span').textContent=cancelled?'松手取消':'松开转录 · 上滑取消';}};
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
  try{if(capture.media.audioUrl){await transcribeObservation();}else{error=error||'这次没有录到声音，请允许麦克风后重新按住。';render();}}
  catch(e){failure(e);render();}finally{finishing=false;}
}
async function transcribeObservation(){
 if(exampleMode)return;error='';
 notice='正在转录，录音已保留…';render();const result=await speech.transcribe(capture.media.audioUrl);
 if(result?.text){draft.text=result.text;notice='请核对下面的文字，确认后才会归档。';error='';}else if(result?.error){error=result.error;notice='';}render();
}
async function cancelHold(){holding=false;await capture.stopVoice();await resetCapture();notice='录音已取消，未提交。';render();}
root.addEventListener('input',()=>{snapshot();if(view==='media')mediaUpload.remember();});
root.addEventListener('change',e=>{if(e.target.matches('[data-media-file]')&&e.target.files?.length)void mediaUpload.change(e);});
root.addEventListener('change',e=>{if(e.target.id==='voice-pet'){if(holding||finishing||busy||sender.pending)return;petId=e.target.value;draft.text='';void resetCapture().then(render);}else snapshot();});
root.addEventListener('click',async e=>{
  if(e.target.closest('[data-media-save]')){await mediaUpload.save(petId);return;}
  if(mediaUpload.busy)return;
  const filter=e.target.closest('[data-ws-filter]');if(filter&&!busy){if(filter.dataset.wsFilter==='knowledge')setCategory(filter.dataset.value);else if(filter.dataset.wsFilter==='record'){recordFilters.status=filter.dataset.value;recordFilters.id='';await refreshDetail();}else workspaceFilters[filter.dataset.wsFilter]=filter.dataset.value;render();return;}
  const b=e.target.closest('[data-live]');if(!b||b.disabled||busy||holding||finishing)return;
  const action=b.dataset.live,id=b.dataset.id;
  if(view==='new'&&intake.busy)return;
  if(action==='sample-observation'){error='';draft.text=exampleObservation.replace('吐司',pet()?.name||'它');const field=root.querySelector('#observation-text');if(field)field.value=draft.text;notice='示例转录已准备好，请核对后确认归档。';render();return;}
  if(action==='scenes'){await go('scenes');return;}
  if(action==='reset-examples'||action==='scene'){if(action==='reset-examples'||id==='empty'||!owned().length)api.reset(id==='empty');pets=(await api.pets()).pets;applications=(await api.applications()).applications;followups=station()&&api.followups?(await api.followups()).followups||[]:[];petId=owned()[0]?.id||'';applicationId=applications[0]?.id||'';if(id==='agent')agentVoice=(await api.agent(petId)).voice;await go(action==='reset-examples'?'scenes':id==='empty'?'home':['failed','private'].includes(id)?'pet':id);return;}
  if(action==='logout'){if(!confirm('确定退出救助站账号？'))return;busy=true;render();try{await api.logout();}catch{}finally{epoch++;clearTimeout(pollTimer);await resetCapture();sender.discard();user=null;pets=[];notes=[];records=[];messages=[];view='login';busy=false;error='';notice='已退出，登录信息不会保存在浏览器里。';render();}return;}
  if(action==='media'){mediaUpload.reset();await go('media');return;}
  if(action==='source-record'||action==='clear-record'){Object.assign(recordFilters,{q:'',status:'all',from:'',to:'',order:'desc',id:action==='source-record'?id:''});await refreshDetail();root.querySelector('#record-panel')?.scrollIntoView({block:'start'});return;}
  if(action==='metric'){const kind={pets:'pet',applications:'application',followups:'followup'}[b.dataset.view];workspaceFilters[kind]=b.dataset.filter;workspaceFilters.query='';await go(b.dataset.view);return;}
  if(action==='applicant'){applicationId=id;await go('applicant');return;}
  if(action==='copy-wechat'){try{await navigator.clipboard.writeText(applications.find(a=>a.id===id)?.snapshot.wechat||'');notice='微信号已复制。';}catch{notice='请长按微信号复制。';}render();return;}
  if(action==='followup'||action==='followup-new'){if(action==='followup')followupId=id;else {followupId='';applicationId=id;}followupKey=crypto.randomUUID();followDraft=null;followPayload=null;await go(action);return;}
  if(action==='transcribe-again'){finishing=true;try{await transcribeObservation();}finally{finishing=false;}return;}
  if(action==='application'){applicationId=id;await go('application');return;}
  if(action==='application-next'||action==='application-close'){const a=applications.find(a=>a.id===applicationId);if(!a)return;if(!confirm(action==='application-close'?'确定结束这份申请？':'确认推进到下一阶段？'))return;busy=true;try{const updated=await api.applicationStage(a.id,action==='application-close'?-1:a.stage+1,a.version);Object.assign(a,updated);notice='申请状态已更新，宠物分身会通知申请人。';}catch(e){failure(e);}finally{busy=false;render();}return;}
  if(action==='agent'){try{agentVoice=(await api.agent(petId)).voice;await go('agent');}catch(e){failure(e);}return;}
  if(['home','pets','applications','followups','new','voice','pet','chat'].includes(action)){
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
    if(action==='toggle-visibility'&&ownPet()){const published=!pet().published;await api.setVisibility(petId,published);pets=(await api.pets()).pets;notice=published?'档案已向领养者公开。':'已关闭公开展示，档案仍保留在本站。';}
    if(action==='refresh'){if(view==='pet')await refreshDetail();else{pets=(await api.pets()).pets;applications=(await api.applications()).applications;followups=station()&&api.followups?(await api.followups()).followups||[]:[];}}
    if(action==='withdraw'){await api.withdrawObservation(id);await refreshDetail();}
    if(action==='retry'){await api.retryObservation(id);void api.processObservation(id).catch(()=>{});await refreshDetail();}
  }catch(e){failure(e);}finally{busy=false;render();}
});
root.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const form=e.target,data=new FormData(form);snapshot();
  if(form.id==='record-search'){Object.assign(recordFilters,{q:String(data.get('q')||''),from:String(data.get('from')||''),to:String(data.get('to')||''),order:String(data.get('order')||'desc'),id:''});await refreshDetail();root.querySelector('#record-panel')?.scrollIntoView({block:'start'});return;}
  if(form.id==='station-search'){workspaceFilters.query=String(data.get('query')||'');render();return;}
  if(!['login-form','pet-form','agent-voice-form','chat-form','followup-form'].includes(form.id))return;
  busy=true;error='';notice='';render();
  try{
    if(form.id==='login-form'){
      const result=await api.login(String(data.get('username')),String(data.get('password')));data.delete('password');
      if(requiredRole&&result.user.role!==requiredRole){await api.logout();throw new Error('ROLE_MISMATCH');}
      pets=(await api.pets()).pets;user=result.user;applications=(await api.applications()).applications;followups=station()&&api.followups?(await api.followups()).followups||[]:[];petId='';view='home';epoch++;
    }else if(form.id==='followup-form'){
      const f=followups.find(f=>f.id===followupId),body=followPayload||{dueAt:new Date(String(data.get('dueAt'))).toISOString(),note:String(data.get('note'))};
      followPayload||=f?{...body,status:String(data.get('status')),version:f.version,requestId:followupKey}:{...body,applicationId};if(f)await api.updateFollowup(f.id,followPayload);else await api.createFollowup(followPayload,followupKey);
      followups=(await api.followups()).followups;followDraft=null;followPayload=null;view='followups';notice='回访安排与记录已保存。';
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
if(exampleMode){user=api.user();pets=(await api.pets()).pets;applications=(await api.applications()).applications;followups=station()&&api.followups?(await api.followups()).followups||[]:[];view='home';render();}
