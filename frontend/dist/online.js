import {escapeDisplay} from './display-text.js';
import {createStationMedia} from './station-media.js';
import {knowledgePanel,recordPanel,gallery,setCategory} from './station-records.js';
import {workspaceFilters,recordFilters,applicationList,petList,summary,followupList,contactCard,applicantPage,followupNames,pair,chips} from './station-workspace.js';
import {createOnboardingSpeech} from './onboarding-speech.js';
import {createPawletterClient} from './pawletter-api.js';
import {createObservationSender,errorMessage} from './online-flow.js';
import {createIntakeUI} from './intake-ui.js';
import {createDailyUI} from './daily-ui.js';
import {createStationExamples,stationScenes,exampleObservation} from './station-examples.js';
const exampleMode=new URL(location.href).searchParams.get('examples')==='1'&&new URL(location.href).searchParams.get('role')==='station';
const api=exampleMode?createStationExamples(window.sessionStorage):createPawletterClient('https://pawletter-api-446222711695.asia-east1.run.app');
const roleParam=new URL(location.href).searchParams.get('role');
const requiredRole=['station','adopter'].includes(roleParam)?roleParam:null;
const root=document.querySelector('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const topics={habits:'生活习惯',likes:'喜好与互动',diet:'饮食照护',health:'健康观察',other:'其他观察'};
const statusLabels={queued:'已保存 · 等待整理',processing:'Agent 正在整理',archived:'已归档',failed:'整理失败 · 可以重试',withdrawn:'已撤回'};
let user=null,pets=[],view='login',petId='',notes=[],records=[],messages=[],busy=false,error='',notice='',epoch=0,pollTimer;
let chatText='',highlight='',pendingCorrection=null;
let applications=[],applicationId='',followups=[],followupId='',followupKey=crypto.randomUUID(),followDraft=null,followPayload=null;
let stations=[],stationFilter='';
const speech=createOnboardingSpeech();
let intakeDetails={};
let agentVoice={tone:'gentle',style:''};
let newDraft={name:'',species:'cat',description:'',published:false};
const intake=createIntakeUI({api,exampleMode,root,redraw:render,canWrite:()=>station()&&view==='new',getDraftKey:()=>user?`${exampleMode?'example':'online'}:${user.stationId}:${user.id}`:null,onDone:async result=>{
 const actor=user,ticket=epoch;busy=true;
 try{const response=await api.pets();if(user!==actor||epoch!==ticket)throw Error('INTAKE_SESSION_CHANGED');
  pets=response.pets;await go('pet',result.id,true);if(user!==actor)throw Error('INTAKE_SESSION_CHANGED');notice='已入档';
  if(result.observationId)void api.processObservation(result.observationId).then(()=>{if(user===actor&&view==='pet'&&petId===result.id)return refreshDetail();}).catch(()=>{});
 }finally{busy=false;render();}
}});
const mediaUpload=createStationMedia({api,root,redraw:render,onError:message=>{error=message;},onSaved:async()=>{pets=(await api.pets()).pets;await go('pet',petId);notice='照片与视频已保存到档案。';}});
const daily=createDailyUI({root,redraw:render,exampleMode,analyse:(id,body)=>api.reviewObservation(id,body),createSender:()=>createObservationSender(api),speech,exampleText:name=>exampleObservation.replace('吐司',name||'它'),onSaved:async result=>{
 // Back on the partner's page, the new record is highlighted while the knowledge base catches up.
 highlight=result.id;await go('pet',result.petId,true);notice='补充已保存';render();
 const ticket=epoch;void Promise.allSettled((result.ids||[result.id]).map(id=>api.processObservation(id))).finally(()=>{if(ticket===epoch&&view==='pet')void refreshDetail(true);});
}});
const station=()=>user?.role==='station';
const allStations=()=>station()&&user.canReadAllStations===true;
const owned=()=>pets.filter(p=>p.stationId===user?.stationId);
const pet=()=>pets.find(p=>p.id===petId);
const ownPet=()=>station()&&pet()?.stationId===user.stationId;
const readDetails=()=>station()&&!!pet()&&(ownPet()||allStations());
const canChat=()=>!!pet()&&(ownPet()||pet().published===true);
const rowStation=row=>row?.stationId||pets.find(p=>p.id===row?.petId)?.stationId;
const canEditApplication=a=>station()&&!!a&&rowStation(a)===user.stationId;
const stationName=id=>stations.find(s=>s.id===id)?.name||pets.find(p=>p.stationId===id)?.stationName||id||'救助站';
const namedPets=()=>pets.map(p=>({...p,stationName:stationName(p.stationId)}));
const inScope=row=>!station()||(allStations()&&!stationFilter)||rowStation(row)===(allStations()?stationFilter:user.stationId);
const resetFilters=()=>Object.assign(workspaceFilters,{application:'all',pet:'all',followup:'all',query:''});
async function refreshWorkspace(account=user){
  const ticket=epoch,owner=user;
  const staff=account?.role==='station';
  const [p,a,f,s]=await Promise.all([api.pets(),api.applications(),staff&&api.followups?api.followups():{followups:[]},staff?api.stations():{stations:[]}]);
  if(ticket!==epoch||owner!==user)return;
  pets=p.pets;applications=a.applications;followups=f.followups||[];stations=s.stations;
  if(stationFilter&&!stations.some(s=>s.id===stationFilter))stationFilter='';
}
const btn=(label,action,extra='',cls='button secondary')=>`<button type="button" class="${cls}" data-live="${action}" ${busy?'disabled':''} ${extra}>${label}</button>`;
const header=(title,subtitle='')=>`<header class="topbar">${user&&view!=='home'?btn('‹','home','aria-label="返回宠物列表"','icon-button'):''}<div class="topbar-title"><strong>${escapeDisplay(title)}</strong>${subtitle?`<small>${escapeDisplay(subtitle)}</small>`:''}</div>${user?btn('退出','logout','','text-button'):''}</header>`;
const card=content=>`<section class="online-card">${content}</section>`;
const empty=(title,body)=>card(`<h2>${title}</h2><p class="online-note">${body}</p>`);
function showError(){const box=root.querySelector('#live-error');if(box)box.textContent=error;}
function snapshot(){
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
    const allPets=namedPets(),list=allPets.filter(inScope),apps=applications.filter(inScope),visits=followups.filter(inScope);
    if(view==='pets')title='站内伙伴';if(view==='applications')title='领养申请';if(view==='followups')title='回访跟踪';
    if(station()&&!allStations()&&!list.length&&view==='home')content=`<section class="station-welcome"><div class="welcome-paw">🐾</div><h1>认识第一位伙伴</h1>${btn('录入新伙伴','new','','button primary full')}</section>`;
    else if(view==='followups')content=followupList(visits,apps,list,{canEdit:canEditApplication});
    else if(view==='applications')content=applicationList(apps,list);
    else if(view==='pets'||!station())content=petList(list,apps);
    else content=summary(list,apps,visits)+`<div class="section-heading"><h2>需要你看看</h2>${btn('刷新','refresh','','text-button')}</div>`+applicationList(apps,list,{home:true});
  }else if(view==='new'){
    title='录入新伙伴';sub=allStations()?stationName(user.stationId):'';content=intake.render();
  }else if(view==='voice'){
    title=daily.title();sub='';content=daily.render();
  }else if(view==='pet'){
    title=pet()?.name||'宠物档案';sub=allStations()?stationName(pet()?.stationId):'档案与长期资料';
    content=gallery(intakeDetails.visuals,pet(),ownPet())+card(`<h2>${esc(pet()?.name)}</h2><p>${escapeDisplay(pet()?.profile.description||'还没有基础介绍')}</p>${ownPet()?`<div class="pet-visibility"><div><strong>向领养者公开</strong><small>${pet().published?'已公开 · 可查看档案并与分身聊天':'未公开 · 当前仅本站可见'}</small></div><button type="button" role="switch" aria-label="向领养者公开" aria-checked="${!!pet().published}" data-live="toggle-visibility" class="visibility-switch" ${busy?'disabled':''}><span></span></button></div><p class="visibility-note">仅本站可见的影像、内部记录和原始材料不会随档案公开。</p>`:''}<div class="online-actions">${ownPet()?btn('补充','voice',`data-id="${esc(petId)}"`,'button primary'):''}${canChat()?btn('和它聊聊','chat'):''}${readDetails()?btn('分身表达','agent','','text-button'):''}</div>`)+knowledgePanel(notes,readDetails())+(readDetails()?`${intakeDetails.source_text||intakeDetails.ocr_text?`<details><summary>建档原始口述与材料</summary><p>${esc(intakeDetails.source_text)}</p><p>${esc(intakeDetails.ocr_text)}</p></details>`:''}${intakeDetails.documents?.length?`<div class="intake-attachments">${intakeDetails.documents.map(d=>`<a href="${esc(d.url)}" download="${esc(d.name)}" target="_blank" rel="noopener">▤ ${esc(d.name)}</a>`).join('')}</div>`:''}${recordPanel(records,highlight,ownPet())}`:'');
  }else if(view==='media'){
    title='补充影像';sub=pet()?.name||'宠物长期档案';content=mediaUpload.render();
  }else if(view==='application'){
    const a=applications.find(a=>a.id===applicationId),profile=a?.snapshot;
    title='领养申请';sub=stationName(rowStation(a));
    content=!a?empty('申请暂时无法查看','返回工作台刷新后重试。'):`${contactCard(a,namedPets().find(p=>p.id===a.petId))}${card(`<h3>${esc(profile.lifestyle?.analysis?.title||'生活画像')}</h3><p>${esc(profile.lifestyle?.analysis?.summary||'')}</p><details><summary>全部访谈回答与偏好</summary>${Object.values(profile.lifestyle?.answers||{}).map(v=>`<p>${esc(v.text)}</p>`).join('')}<p>${(profile.memories||[]).map(esc).join('；')}</p></details><h3 class="spaced">补充资料与问题</h3><p>${esc(a.note)}</p>`)}${canEditApplication(a)&&a.stage>=0&&a.stage<3?`<div class="online-actions">${btn(['同意见面','确认见面完成','确认交接'][a.stage],'application-next',a.stage===2&&profile.verification!=='verified'?'disabled':'','button primary')}${btn('结束申请','application-close','','button secondary')}</div>${a.stage===2&&profile.verification!=='verified'?'<p class="online-note">实名尚待核验，暂不能确认交接。</p>':''}`:''}`;
  }else if(view==='applicant'){
    title='领养者主页';const a=applications.find(a=>a.id===applicationId);sub=stationName(rowStation(a));content=a?applicantPage(a,applications,namedPets()):empty('暂时无法查看','返回申请详情重试。');
  }else if(view==='followup'||view==='followup-new'){
    const f=followups.find(f=>f.id===followupId),a=applications.find(a=>a.id===(f?.applicationId||applicationId));title=f?'回访记录':'安排回访';sub=stationName(rowStation(a));
    content=a?contactCard(a,namedPets().find(p=>p.id===a.petId))+`<section class="online-card"><h2>${f?'跟进进度':'第一次回访'}</h2>${(f?.history||[]).map(h=>`<p><small>${date(h.at||h.createdAt||f.updatedAt)} · ${followupNames[h.status]||'已安排'}</small><br>${esc(h.text)}</p>`).join('')}${canEditApplication(a)?`<form id="followup-form" class="form-stack"><fieldset class="form-stack" ${followPayload?'disabled':''}>${f?`<label>本次状态<select name="status">${Object.entries(followupNames).map(([id,label])=>`<option value="${id}" ${(followDraft?.status||f.status)===id?'selected':''}>${label}</option>`).join('')}</select></label>`:''}<label>回访时间<input name="dueAt" type="datetime-local" required value="${followDraft?.dueAt||new Date((f?Date.parse(f.dueAt):Date.now()+86400000)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}"></label><label>记录与下一步<textarea name="note" required maxlength="2000" rows="4" placeholder="记录沟通结果、待确认的问题或下一次安排">${esc(followDraft?.note||'')}</textarea></label></fieldset><button class="button primary full">${followPayload?'重试同一条记录':f?'保存跟进记录':'安排回访'}</button></form><p class="online-note">保存到本站回访清单；联系领养者请使用上方电话或微信。</p>`:''}</section>`:empty('没有找到对应申请','请返回回访列表。');
  }else if(view==='agent'){
    title=(pet()?.name||'它')+'的 AI 分身';sub=stationName(pet()?.stationId);
    content=ownPet()?`<div class="info-box"><p>所有事实来自你维护的宠物档案与有效观察。这里仅调整说话方式，不会补写习惯、经历或健康情况。</p></div><form id="agent-voice-form" class="form-stack spaced"><label>说话口吻<select name="tone">${Object.entries({gentle:'温柔自然',shy:'慢热腼腆',calm:'安静简洁',lively:'轻快活泼'}).map(([key,label])=>`<option value="${key}" ${agentVoice.tone===key?'selected':''}>${label}</option>`).join('')}</select></label><label>表达偏好（选填）<textarea name="style" rows="3" maxlength="200" placeholder="例如：短句，少用语气词，保留一点腼腆。">${esc(agentVoice.style)}</textarea></label><button class="button primary full" ${busy?'disabled':''}>保存分身表达</button></form><p class="online-note">性格、习惯或照护情况有变化，请通过语音补充长期档案；没有记载的内容，AI 会明确表示不知道。</p>${btn('补充','voice',`data-id="${esc(petId)}"`,'button secondary full')}`:card(`<h2>${esc({gentle:'温柔自然',shy:'慢热腼腆',calm:'安静简洁',lively:'轻快活泼'}[agentVoice.tone]||agentVoice.tone)}</h2><p>${esc(agentVoice.style||'未设置表达偏好')}</p>`);
  }else if(view==='chat'){
    title=pet()?.name||'宠物 Agent';sub='AI 分身 · 根据救助站共享资料回答';
    content=`<p class="online-note">可以问习惯、喜好和照护记录。分身会根据照顾者的记录回答，不知道的事会说明。</p>${messages.map(m=>`<div class="chat-bubble ${m.role==='user'?'mine':''}">${escapeDisplay(m.text)}</div>`).join('')}${busy?'<p role="status" class="online-note">正在查阅资料…</p>':''}<form id="chat-form" class="chat-compose"><label class="sr-only" for="chat-question">问问它</label><textarea id="chat-question" name="question" maxlength="2000" required placeholder="你平时喜欢玩什么？">${esc(chatText)}</textarea><button class="button primary" ${busy?'disabled':''}>发送</button></form>`;
  }
  const nav=station()&&['home','pets','applications','followups'].includes(view);
  const dock=nav&&(owned().length||allStations());
  const stationSelect=nav&&allStations()?`<label class="form-stack station-scope"><span class="sr-only">救助站</span><select id="station-filter" aria-label="救助站"><option value="">全部救助站</option>${stations.map(s=>`<option value="${esc(s.id)}" ${stationFilter===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`:'';
  root.innerHTML=`<div class="phone-app online-app ${view==='new'||view==='voice'?'intake-simple-page':''} ${nav?'station-nav-page':''} ${dock?'station-dock-page':''}">${header(title,sub)}<main class="main"><div id="live-error" class="online-error" role="alert">${esc(error)}</div>${notice?`<div class="intake-saved-actions"><p class="online-note" role="status">${esc(notice)}</p>${notice==='已入档'?btn('继续录入','new','','text-button'):''}</div>`:''}${exampleMode?`<div class="station-example-bar"><span>${['new','voice'].includes(view)?'示例 · 不调用真实 AI':'救助站示例 · 本页独立保存'}</span>${btn('切换场景','scenes','','text-button')}<a href="?mode=online&role=station">正式登录</a></div>`:''}${stationSelect}${content}${!exampleMode&&(!user||view==='home')?'<a class="station-example-link" href="?mode=online&role=station&examples=1" target="_blank" rel="noopener">先看看救助站示例 →</a>':''}</main>${dock?`<div class="station-action-dock">${btn(allStations()?'＋ 录入本站伙伴':'＋ 录入新伙伴','new','','button secondary')}${owned().length?btn(allStations()?'＋ 补充本站伙伴':'＋ 补充','voice','','button primary'):''}</div>`:''}${nav?`<nav class="station-nav" aria-label="救助站导航">${[['home','⌂','工作台'],['pets','♧','宠物'],['applications','▤','申请'],['followups','◷','回访']].map(([id,icon,label])=>`<button data-live="${id}" ${view===id?'aria-current="page"':''}><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav>`:''}</div>`;
  if(view==='new')intake.bind();if(view==='voice')daily.bind();
}
function date(value){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function failure(e){error=errorMessage(e);if(e?.status===401&&e.message!=='INVALID_CREDENTIALS'){user=null;view='login';epoch++;clearTimeout(pollTimer);daily.stop();daily.forget();notes=[];records=[];messages=[];}showError();}
async function go(next,id,completed=false){
  if(next==='new'&&!station()||next==='media'&&!ownPet()||next==='agent'&&!readDetails()||next==='chat'&&!canChat())return;
  if(next==='voice'&&(!station()||id&&!owned().some(p=>p.id===id)))return;
  if(mediaUpload.busy)return;if(view==='new'&&intake.blocking&&!completed)return;if(view==='voice'&&daily.blocking&&!completed)return;if(view==='new'&&next!=='new')intake.stop();
  clearTimeout(pollTimer);epoch++;snapshot();
  if(view==='voice'&&next!=='voice'){daily.stop();}
  // From the workspace the rescuer picks a partner; from a profile or a correction the partner is already known.
  if(next==='voice'){if(!owned().length)return;daily.open({pets:owned(),petId:owned().some(p=>p.id===id)?id:null,correction:pendingCorrection});pendingCorrection=null;}
  if(next==='new'){stationFilter=user.stationId;await intake.reset();}
  if(!(completed&&next==='pet'))highlight='';if(id)petId=id;if(next==='pet'){notes=[];records=[];intakeDetails={};Object.assign(recordFilters,{q:'',status:'all',from:'',to:'',order:'desc',id:''});setCategory('all');}view=next;error='';notice='';messages=[];chatText='';render();root.scrollIntoView?.({block:'start'});
  if(next==='pet')await refreshDetail();
  if(['home','pets','applications','followups'].includes(next))await refreshWorkspaceView();
}
async function refreshWorkspaceView(){
 const ticket=epoch;
 try{await refreshWorkspace();if(ticket===epoch)render();}
 catch(e){if(ticket===epoch){failure(e);render();}}
}
async function refreshDetail(silent=false){
  const ticket=epoch,id=petId;
  try{const [k,o,source]=await Promise.all([api.knowledge(id),readDetails()?api.observations(id,recordFilters):Promise.resolve({observations:[]}),readDetails()&&api.intake?api.intake(id):Promise.resolve({})]);
    if(ticket!==epoch||view!=='pet'||id!==petId)return;
    notes=k.notes;records=o.observations;intakeDetails=source;if(!silent)error='';render();
    // Records sort by the day they happened, so a back-dated entry may sit lower: bring it into view once.
    if(!silent&&highlight)root.querySelector('.just-added')?.scrollIntoView?.({block:'center'});
  }catch(e){if(ticket===epoch){failure(e);render();}}
  if(ticket===epoch&&view==='pet'&&user&&records.some(r=>['queued','processing'].includes(r.status))){clearTimeout(pollTimer);pollTimer=setTimeout(()=>refreshDetail(true),8000);}
}
root.addEventListener('input',()=>{snapshot();if(view==='media')mediaUpload.remember();});
root.addEventListener('change',e=>{if(view==='media'&&ownPet()&&e.target.matches('[data-media-file]')&&e.target.files?.length)void mediaUpload.change(e);});
root.addEventListener('change',e=>{if(e.target.id==='station-filter'){if(!allStations()||!['home','pets','applications','followups'].includes(view))return;const value=e.target.value;if(value&&!stations.some(s=>s.id===value))return;stationFilter=value;resetFilters();render();return;}snapshot();});
root.addEventListener('click',async e=>{
  if(e.target.closest('[data-media-save]')){if(view==='media'&&ownPet())await mediaUpload.save(petId);return;}
  if(mediaUpload.busy)return;
  const filter=e.target.closest('[data-ws-filter]');if(filter&&!busy){if(filter.dataset.wsFilter==='knowledge')setCategory(filter.dataset.value);else if(filter.dataset.wsFilter==='record'){recordFilters.status=filter.dataset.value;recordFilters.id='';await refreshDetail();}else workspaceFilters[filter.dataset.wsFilter]=filter.dataset.value;render();return;}
  const b=e.target.closest('[data-live]');if(!b||b.disabled||busy)return;
  const action=b.dataset.live,id=b.dataset.id;
  if(['media','toggle-visibility','correct','withdraw','retry'].includes(action)&&!ownPet())return;
  if(['correct','withdraw','retry'].includes(action)&&!records.some(r=>r.id===id))return;
  if(action==='voice'&&['pet','agent'].includes(view)&&!ownPet()||action==='agent'&&!readDetails()||action==='chat'&&!canChat())return;
  if(['scenes','scene','reset-examples'].includes(action)&&!exampleMode)return;
  if(view==='new'&&intake.blocking)return;if(view==='voice'&&daily.blocking)return;
  if(action==='scenes'){await go('scenes');return;}
  if(action==='reset-examples'||action==='scene'){if(action==='reset-examples'||id==='empty'||!owned().length)api.reset(id==='empty');pets=(await api.pets()).pets;applications=(await api.applications()).applications;followups=station()&&api.followups?(await api.followups()).followups||[]:[];petId=owned()[0]?.id||'';applicationId=applications[0]?.id||'';if(id==='agent')agentVoice=(await api.agent(petId)).voice;await go(action==='reset-examples'?'scenes':id==='empty'?'home':['failed','private'].includes(id)?'pet':id);return;}
  if(action==='logout'){if(!confirm('确定退出救助站账号？'))return;busy=true;render();try{await api.logout();}catch{}finally{epoch++;clearTimeout(pollTimer);daily.stop();daily.forget();user=null;pets=[];stations=[];applications=[];followups=[];stationFilter='';notes=[];records=[];messages=[];view='login';busy=false;error='';notice='已退出，登录信息不会保存在浏览器里。';render();}return;}
  if(action==='media'){mediaUpload.reset();await go('media');return;}
  if(action==='source-record'||action==='clear-record'){Object.assign(recordFilters,{q:'',status:'all',from:'',to:'',order:'desc',id:action==='source-record'?id:''});await refreshDetail();root.querySelector('#record-panel')?.scrollIntoView({block:'start'});return;}
  if(action==='metric'){const kind={pets:'pet',applications:'application',followups:'followup'}[b.dataset.view];workspaceFilters[kind]=b.dataset.filter;workspaceFilters.query='';await go(b.dataset.view);return;}
  if(action==='applicant'){applicationId=id;await go('applicant');return;}
  if(action==='copy-wechat'){try{await navigator.clipboard.writeText(applications.find(a=>a.id===id)?.snapshot.wechat||'');notice='微信号已复制。';}catch{notice='请长按微信号复制。';}render();return;}
  if(action==='followup'||action==='followup-new'){if(action==='followup-new'&&!canEditApplication(applications.find(a=>a.id===id)))return;if(action==='followup')followupId=id;else {followupId='';applicationId=id;}followupKey=crypto.randomUUID();followDraft=null;followPayload=null;await go(action);return;}
  if(action==='application'){applicationId=id;await go('application');return;}
  if(action==='application-next'||action==='application-close'){const a=applications.find(a=>a.id===applicationId);if(!canEditApplication(a))return;if(!confirm(action==='application-close'?'确定结束这份申请？':'确认推进到下一阶段？'))return;busy=true;try{const updated=await api.applicationStage(a.id,action==='application-close'?-1:a.stage+1,a.version);Object.assign(a,updated);notice='申请状态已更新，宠物分身会通知申请人。';}catch(e){failure(e);}finally{busy=false;render();}return;}
  if(action==='agent'){try{agentVoice=(await api.agent(petId)).voice;await go('agent');}catch(e){failure(e);}return;}
  if(['home','pets','applications','followups','new','voice','pet','chat'].includes(action)){
    await go(action,id);return;
  }
  if(action==='correct'){
    const r=records.find(r=>r.id===id);if(!r)return;
    pendingCorrection={id:r.id,petId,text:r.transcript||r.original_text||'',observedOn:r.observed_on,shared:r.share_with_agent};await go('voice',petId);return;
  }
  if(action==='withdraw'&&!confirm('撤回后，这条资料将不再用于新的 Agent 回答。确定撤回？'))return;
  busy=true;error='';render();
  try{
    if(action==='toggle-visibility'&&ownPet()){const published=!pet().published;await api.setVisibility(petId,published);pets=(await api.pets()).pets;notice=published?'档案已向领养者公开。':'已关闭公开展示，档案仍保留在本站。';}
    if(action==='refresh'){if(view==='pet')await refreshDetail();else await refreshWorkspace();}
    if(action==='withdraw'){await api.withdrawObservation(id);await refreshDetail();}
    if(action==='retry'){await api.retryObservation(id);void api.processObservation(id).catch(()=>{});await refreshDetail();}
  }catch(e){failure(e);}finally{busy=false;render();}
});
root.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const form=e.target,data=new FormData(form);snapshot();
  if(form.id==='record-search'){Object.assign(recordFilters,{q:String(data.get('q')||''),from:String(data.get('from')||''),to:String(data.get('to')||''),order:String(data.get('order')||'desc'),id:''});await refreshDetail();root.querySelector('#record-panel')?.scrollIntoView({block:'start'});return;}
  if(form.id==='station-search'){workspaceFilters.query=String(data.get('query')||'');render();return;}
  if(!['login-form','pet-form','agent-voice-form','chat-form','followup-form'].includes(form.id))return;
  if(form.id==='pet-form'&&(!station()||view!=='new')||form.id==='agent-voice-form'&&(view!=='agent'||!ownPet())||form.id==='chat-form'&&(view!=='chat'||!canChat()))return;
  if(form.id==='followup-form'){if(!['followup','followup-new'].includes(view))return;const f=followups.find(f=>f.id===followupId),a=applications.find(a=>a.id===(f?.applicationId||applicationId));if(!canEditApplication(a))return;}
  busy=true;error='';notice='';render();
  try{
    if(form.id==='login-form'){
      const result=await api.login(String(data.get('username')),String(data.get('password')));data.delete('password');
      if(requiredRole&&result.user.role!==requiredRole){await api.logout();throw new Error('ROLE_MISMATCH');}
      await refreshWorkspace(result.user);user=result.user;stationFilter=allStations()?'':user.stationId;resetFilters();petId='';view='home';epoch++;
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
document.addEventListener('visibilitychange',()=>{if(document.hidden||busy||!user)return;if(view==='pet')void refreshDetail(true);else if(['home','pets','applications','followups'].includes(view))void refreshWorkspaceView();});
window.addEventListener('pagehide',()=>{clearTimeout(pollTimer);daily.stop();});
render();
if(exampleMode){user=api.user();await refreshWorkspace();stationFilter=user.stationId;view='home';render();}
