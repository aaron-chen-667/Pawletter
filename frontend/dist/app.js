import {escapeDisplay as esc} from './display-text.js';
import { knowledgeTopics, observationEntries, confirmObservation, saveUnprocessedObservation, knowledgeReply } from './pet-knowledge.js';
import { STORAGE_KEY, freshState, activePet, recommendations, extractMemory, mergeMemory, addMessage, greet, replyFor, reviewConversation, advanceApplication, summarizeFeedback, stages } from './domain.js';
import { createCaptureController } from './capture.js';
import { storeMedia, mediaUrl, clearMedia } from './media-store.js';
import { initializeDiscovery, cityLocations, nearbyStations, stationFor, distanceKm, distanceLabel } from './discovery.js';
import { initializeCommunity, registerDemo, addStationRating, stationById, stationPets, evaluationStatus, adoptionDay, publicProfile, requestFollowup, completeFollowupRequest } from './community.js';
import { communityView } from './community-ui.js';
import { enrichCatalog, populateDefaultExamples, storyCards, createStory, STORY_STORAGE_KEY, STORY_MODE_KEY } from './samples.js';

import { lifestyleQuestions, confirmLifestyle, beginRegistration, completeRegistration } from './lifestyle.js';
import {createOnboardingSpeech} from './onboarding-speech.js';
import {createAdopterAccount} from './adopter-account.js';
import {loginView,interviewView} from './account-ui.js';
import {createPressToTalk} from './press-to-talk.js';
import {petJourneyMessage} from './pet-voice.js';
import {cloudPet} from './cloud-pets.js';
import {profileFactsView} from './profile-facts.js';
import {petShareData,sharePet} from './pet-share.js';
import {EXAMPLES_KEY,exampleAnswers,exampleScenes,createAdopterExamples,createExampleAccount} from './adopter-examples.js';
const exampleMode=new URL(location.href).searchParams.get('examples')==='1';
const lifestyleSpeech=createOnboardingSpeech();
let lifestyleSpeechBusy=false,lifestyleSpeechError='',lifestyleSpeechArmed=false;

let lifestyleStep=0,lifestyleText='',lifestyleValue='unknown',lifestyleReview=false,lifestyleViewing=false;
const lifestyleOwner=()=>state.account||state.registrationDraft;
const accountApi=exampleMode?createExampleAccount(()=>state):createAdopterAccount();
let authRestoring=accountApi.hasSession(),authBusy=false,registrationCredentials=null,registrationKey=null,pendingAction=null;
let interviewVoiceOpen=false;
let interviewEpoch=0,interviewTurns=[],interviewAnalysis=null,applicationNote='';
let applicationReview=false,applicationKey=null,applicationBusy=false,applicationError='';
let catalogRows=[],catalogBusy=true,catalogError='',chatBusy=false,chatError='',chatEpoch=0;
let initialPetId=new URL(location.href).searchParams.get('pet');
let profileFacts=null,factsEpoch=0;
async function loadProfileFacts(){
 const id=page.id;if(page.name!=='profile'||!activePet(state,id)?.cloud)return;
 const epoch=++factsEpoch;profileFacts={status:'loading'};render();
 try{const result=await accountApi.facts(id);if(epoch!==factsEpoch)return;profileFacts={status:'ready',notes:result.notes};}
 catch{if(epoch!==factsEpoch)return;profileFacts={status:'error'};}
 if(page.name==='profile'&&page.id===id)render();
}
let storyMode=exampleMode;
function guestState(){const value=freshState();value.defaultExamplesRevision=1;value.memory=[];value.consent=true;initializeDiscovery(value);value.location.source='default';initializeCommunity(value);value.pets=catalogRows.map(cloudPet);value.role='user';return value;}
let state=exampleMode?createAdopterExamples():guestState();
if(exampleMode){try{const saved=JSON.parse(sessionStorage.getItem(EXAMPLES_KEY));if(saved?.exampleData&&saved.exampleVersion===1)state=saved;}catch{}catalogBusy=false;}
let page={name:'meet'};
function acceptAccount(profile){
 if(exampleMode){state.account=profile;registrationCredentials=null;registrationKey=null;save();return;}
 let saved;try{saved=JSON.parse(sessionStorage.getItem('pawletter.user.'+profile.id));}catch{}
 state=guestState();
 if(saved?.version===1){for(const key of ['following','messages','muted','read','memory','passed','swipeHistory','discoveryMode','location','radius','applicationDrafts'])if(saved[key]!==undefined)state[key]=saved[key];}
 state.account=profile;state.consent=profile.consent!==false;void loadApplications(profile.id);
 registrationCredentials=null;registrationKey=null;
 if(state.consent)greet(state);
 save();
}
function registrationGate(action,value){
 if(authRestoring){toast('正在恢复登录，请稍候。');return;}
 pendingAction={action,value};openOverlay('registration-gate');
}
function resumeAccount(){
 const next=pendingAction;pendingAction=null;
 navigate('meet');navigationStack=[];
 if(next?.action==='chat')openChat(next.value);
 else if(next?.action==='apply')navigate('apply',next.value);
 else if(next?.action==='follow'||next?.action==='swipe-like'){if(!state.following.includes(next.value))state.following.push(next.value);save();render();}
 else if(next?.action==='lifestyle')startLifestyle();
 else if(['memory','progress','ratings','saved'].includes(next?.action))navigate(next.action==='saved'?'meet':next.action);
}

let filter = 'all';
let workFilter='all',animalFilter='all',animalSearch='';
let observationResult=null,observationBusy=false,observationHold=false,observationFinishing=false,observationPetId=null,observationEditing=false;
let overlay = null;
let draft = { photos: [], description: '', sample: false };
if (state.draft) {
  draft = { ...draft, ...state.draft };
  if (!draft.photos.length && draft.image) draft.photos = [draft.image];
}
let captureMode = 'photo';
let analysisStep = 0;
let analysisEpoch = 0;
let textFallback = false;
let captureIntent = { kind:'intake' };
let pendingFeedback = null;
let locationError = '';
let locating = false;
let swipeGesture = null;
let suppressClickUntil = 0;
let confirmEditing = false;
let registrationReturn = state.registrationDraft?.returnTo||null;
let publishingFeedback = false;
let toastTimer;
let navigationStack=[];
const app = document.querySelector('#app');
const overlayRoot = document.querySelector('#overlay');
const capture = createCaptureController({
  onChange() {
    if(page.name==='voice'&&captureIntent.kind==='observation'&&(observationHold||observationFinishing)){
      const mic=document.querySelector('#observation-hold'),select=document.querySelector('#observation-pet');
      if(select)select.disabled=true;
      if(mic){mic.classList.toggle('recording',!!capture.media.voiceRecorder);mic.querySelector('span').textContent=capture.media.voicePending?'允许麦克风后继续按住':capture.media.voiceRecorder?'松开归档 · '+capture.media.audioSeconds+' 秒':'正在保存…';}
      if(observationHold&&!observationFinishing&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)queueMicrotask(()=>finishObservationHold());
      return;
    }
    if(page.name==='lifestyle'||page.name==='apply'){
      updateVoiceUI();
      if(voiceChat.state.holding&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)queueMicrotask(()=>voiceChat.end());
      return;
    }

    if (page.name === 'intake' && capture.media.videoRecorder?.state === 'recording' && document.querySelector('.shutter.recording')) {
      document.querySelector('#capture-time').textContent = `00:${String(capture.media.recordingSeconds).padStart(2,'0')} / 00:30`;
      return;
    }
    if (page.name === 'voice' && capture.media.voiceRecorder?.state === 'recording' && document.querySelector('.voice-mic.recording')) {
      document.querySelector('#voice-time').textContent = `00:${String(capture.media.audioSeconds).padStart(2,'0')}`;
      return;
    }
    if (page.name === 'intake' || page.name === 'voice') render();
  },
  onError: message => toast(message),
});
const icons = {
  share:'<path d="M12 16V2m-5 5 5-5 5 5M5 12v9h14v-9"/>',
  paw:'<ellipse cx="7" cy="8" rx="2" ry="2.7" transform="rotate(-25 7 8)"/><ellipse cx="12" cy="5.5" rx="2" ry="2.7"/><ellipse cx="17" cy="8" rx="2" ry="2.7" transform="rotate(25 17 8)"/><path d="M6 17c0-3.3 3.8-7 6-7s6 3.7 6 7c0 3.5-3.6 2-6 2s-6 1.5-6-2Z"/>',
  heart:'<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>',
  chat:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2 1.7-5A8.5 8.5 0 1 1 21 11.5Z"/><path d="M7 10h8M7 14h5"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back:'<path d="m15 5-7 7 7 7"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  spark:'<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7ZM20 2v4M18 4h4"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  camera:'<path d="M4 6h3l2-3h6l2 3h3v14H4Z"/><circle cx="12" cy="12" r="4"/>',
  mic:'<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  book:'<path d="M12 5v16M12 5C8 2 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-6-2-10 1Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  home:'<path d="m3 10 9-8 9 8v11H3ZM9 21v-8h6v8"/>',
  inbox:'<path d="M3 3h18v18H3ZM3 14h5l2 3h4l2-3h5"/>',
  play:'<path d="m9 5 11 7-11 7Z"/>',
  send:'<path d="m3 3 18 9-18 9 4-9Zm4 9h14"/>',
  shield:'<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  refresh:'<path d="M20 8A8 8 0 0 0 5 5L2 8m0-6v6h6M4 16a8 8 0 0 0 15 3l3-3m0 6v-6h-6"/>',
  edit:'<path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
};
function icon(name,cls='') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="${name==='paw'?'currentColor':'none'}" stroke="${name==='paw'?'none':'currentColor'}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.paw}</svg>`; }
function photo(p,cls='',extra='') { return `<img class="${cls}" src="${esc(p.image||'./assets/paw.svg')}" alt="${esc(p.name)}的照片" ${extra} />`; }
function button(label,action,cls='button',value='',extra='') { return `<button class="${cls}" data-action="${action}" ${value?`data-value="${esc(value)}"`:''} ${extra}>${label}</button>`; }
function save() {
 if(exampleMode){try{sessionStorage.setItem(EXAMPLES_KEY,JSON.stringify({...state,exampleVersion:1}));return true;}catch{return false;}}
 if(!state.account)return true;
 try{const saved={version:1};for(const key of ['following','messages','muted','read','memory','passed','swipeHistory','discoveryMode','location','radius','applicationDrafts'])saved[key]=state[key];sessionStorage.setItem('pawletter.user.'+state.account.id,JSON.stringify(saved));return true;}
 catch{toast('当前设备暂时无法保存浏览记录。');return false;}
}
function toast(message) {
  const target=document.querySelector('#toast'); target.textContent=message; target.classList.add('visible');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>target.classList.remove('visible'),3600);
}
function navigate(name,id) {
  if(['apply','chat','memory','progress','lifestyle','ratings','public-profile'].includes(name)&&!state.account&&!(name==='lifestyle'&&state.registrationDraft)){registrationGate(name,id);return;}
  if(name==='apply'&&page.name!=='apply'){applicationReview=false;applicationError='';applicationNote=state.applicationDrafts?.[id]?.note||'';applicationKey=crypto.randomUUID();}
  leaveCapture(name);
  if(name==='confirm')confirmEditing=false;
  if(page.name!==name||page.id!==id)navigationStack.push({...page});
  page={name,id}; overlay=null; render(); window.scrollTo({top:0,behavior:'instant'});
  if(name==='intake')capture.startCamera();
  if(name==='profile')void loadProfileFacts();
}
function leaveCapture(next) {
  factsEpoch++;profileFacts=null;
  if(['lifestyle','apply'].includes(page.name)&&next!==page.name){resetLifestyleSpeech();voiceChat.cancel();interviewEpoch++;}
  if(page.name==='voice'&&next!=='voice'&&captureIntent.kind==='observation'){observationHold=false;observationPetId=null;}
  if(page.name==='intake'&&next!=='intake')capture.stopCamera();
  if((page.name==='voice'||page.name==='lifestyle')&&next!==page.name)capture.stopVoice();
  if(page.name==='analyzing'&&next!=='analyzing')analysisEpoch++;
}
function setRole(role) { if(role==='rescue'){location.assign('?mode=online&role=station');return;}state.role='user';save();navigate('meet');navigationStack=[]; }
function petStatus(p) { return p.status==='adopted'?'已找到家':p.status==='paused'?'暂停领养':!p.confirmed?'待确认':'等待一个家'; }
function sectionHeading(eyebrow,title,action='') { return `<div class="section-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div>${action}</div>`; }
function statusPill(p) {return `<span class="status-pill ${p.status==='adopted'?'green':''}"><i></i>${petStatus(p)}</span>`;}
function empty(title,desc,action='') { return `<div class="empty"><span class="empty-icon">${icon('paw')}</span><h3>${title}</h3><p>${desc}</p>${action}</div>`; }
function currentApplication(petId) { return state.applications.find(a=>a.petId===petId && a.stage>=0 && (!a.adopterId||a.adopterId===state.account?.id)); }
function topbar(title,sub='',back=true) {
  return `<header class="topbar">${back?button(icon('back'),'back','icon-button','','aria-label="返回"'):`<span class="brand-mark">${icon('paw')}</span>`}<div class="topbar-title"><strong>${title}</strong>${sub?`<small>${sub}</small>`:''}</div>${button(icon('user'),'identity','icon-button','','aria-label="切换身份"')}</header>`;
}
function shellHeader() {
  const locationControl=button(`<span class="location-pin">${icon('pin')}</span><span class="location-copy"><strong>${esc(state.location.label)}</strong><small>附近 ${state.radius} km</small></span>${icon('chevron','location-chevron')}`,'location','header-location','','aria-label="位置与距离设置"');
  const roleControl=button(`${icon('user')}<span>领养者</span>${icon('chevron','role-chevron')}`,'identity','header-role','','aria-label="切换身份，当前为领养者"');
  return `<header class="brand-header"><div class="brand"><span class="brand-mark">${icon('paw')}</span><div><b>爪爪来信</b><small>PAWLETTER</small></div></div><div class="header-actions">${page.name==='meet'?locationControl:page.name==='mine'?roleControl:''}</div></header>`;
}
function nav() {
  const rescue=state.role==='rescue';
  const items=rescue?[['work','home','工作台'],['animals','paw','动物'],['tracking','book','跟进']]:[['messages','chat','消息'],['meet','compass','遇见'],['mine','user','我的']];
  const unread=Object.entries(state.messages).filter(([id,msg])=>msg.some(m=>m.from==='pet'&&m.at>(state.read[id]||0))).length;
  return `<nav class="bottom-nav" aria-label="${rescue?'救助者':'用户'}导航">${items.map(([name,i,label])=>`<button data-action="nav" data-value="${name}" class="nav-item ${page.name===name?'active':''}">${icon(i)}${name==='messages'&&unread?'<i class="nav-dot"></i>':''}<span>${label}</span></button>`).join('')}</nav>`;
}
function render() {
  const rootPages=['meet','messages','mine','work','animals','tracking'];
  let body='';
  switch(page.name) {
    case 'stories':body=storiesPage();break;
    case 'adopter-login':body=loginView({topbar,button});break;
    case 'stations':case 'station':body=exampleMode?communityView(page.name,page.id,{state,topbar,esc,icon,button,menu,photo,sectionHeading,renderMedia,empty}):cloudStationPage(page.id);break;
    case 'register':case 'account':case 'station-onboarding':case 'public-profile':case 'ratings':
      body=communityView(page.name,page.id,{state,topbar,esc,icon,button,menu,photo,sectionHeading,renderMedia,empty});break;
    case 'meet': body=meetPage(); break;
    case 'messages':body=messagesPage();break;
    case 'mine':body=minePage();break;
    case 'profile':body=profilePage();break;
    case 'chat':body=chatPage();break;
    case 'memory':body=memoryPage();break;
    case 'apply':body=applyPage();break;
    case 'progress':body=progressPage();break;
    case 'work':body=workPage();break;
    case 'animals':body=animalsPage();break;
    case 'intake':body=intakePage();break;
    case 'voice':body=voicePage();break;
    case 'analyzing':body=analyzingPage();break;
    case 'feedback-review':body=feedbackReviewPage();break;
    case 'confirm':body=confirmPage();break;
    case 'agent':body=petManagementPage();break;
    case 'agent-settings':body=agentPage();break;
    case 'application':body=applicationPage();break;
    case 'tracking':body=trackingPage();break;
    case 'lifestyle':body=lifestylePage();break;
    case 'followup':body=followupPage();break;
    default:body=meetPage();
  }
  if(exampleMode)body=`<div class="example-toolbar"><button data-action="example-scenes">${icon('book')} 示例体验 <span>切换场景</span></button><a href="./">返回正式</a></div>`+body;
  app.innerHTML=`<aside class="desktop-note"><a class="desktop-brand" href="#/">${icon('paw')} PAWLETTER</a><p class="editorial">把相遇，<br>写成回家。</p><p class="desktop-description">一封来自毛茸茸世界的来信。<br>认识它，了解它，然后一起回家。</p><span class="desktop-label">公益领养 · 让陪伴发生</span><div class="desktop-line"></div><p class="desktop-foot">每一个小小的生命，<br>都值得被认真认识。</p></aside><div class="phone-app ${exampleMode?'example-app ':''}${page.name==='chat'?'chat-app':page.name==='lifestyle'&&!lifestyleReview?'interview-app':''}">${body}${rootPages.includes(page.name)?nav():''}</div><aside class="desktop-right"><span>01 / MEET A NEW FRIEND</span><p>让喜欢，<br>有一个真实的去处。</p><button data-action="identity">切换身份 ${icon('arrow')}</button><img class="desktop-qr" src="./assets/qr.png" alt="手机扫码访问" /><small>手机扫码体验</small></aside>`;
  if(exampleMode){
   const composer=app.querySelector('.interview-composer');if(composer)composer.insertAdjacentHTML('afterbegin',button('用一句示例回答体验','example-answer','example-fill','','type="button"'));
   const apply=app.querySelector('#application-form');if(apply)apply.insertAdjacentHTML('afterbegin',button('填入示例补充','example-application','example-fill','','type="button"'));
   const register=app.querySelector('#register-form');if(register)register.insertAdjacentHTML('afterbegin','<p class="example-note">此处仅体验注册流程，不创建真实账号。请使用示例资料。</p>'+button('填入示例资料','example-registration','example-fill','','type="button"'));
  }
  app.querySelector('.phone-app').classList.toggle('capture-app',page.name==='intake');
  app.querySelector('.phone-app').classList.toggle('discovery-app',page.name==='meet');
  app.querySelector('.phone-app').classList.toggle('story-mode',storyMode);
  const stream=app.querySelector('.interview-stream');if(stream)stream.scrollTop=stream.scrollHeight;

  if(page.name==='intake'&&capture.media.stream) {
    const preview=app.querySelector('#camera-preview');
    if(preview){preview.srcObject=capture.media.stream;preview.play().catch(()=>{});}
  }
  renderOverlay();
  hydrateMedia();
  if (page.name==='chat') requestAnimationFrame(()=>{ const list=document.querySelector('.chat-stream'); if(list)list.scrollTop=list.scrollHeight; });
}
function discoveryItems() {
  let list=recommendations(state).map(item=>({...item,distance:distanceKm(state.location,stationFor(item.pet))}));
  if(state.discoveryMode==='nearby')list=list.filter(item=>!Number.isFinite(item.distance)||item.distance<=state.radius);
  if(state.discoveryMode==='swipe'&&filter!=='saved')list=list.filter(item=>!state.passed.includes(item.pet.id));
  if(filter==='cat')list=list.filter(x=>x.pet.species==='猫');
  if(filter==='dog')list=list.filter(x=>x.pet.species==='狗');
  if(filter==='saved')list=list.filter(x=>state.following.includes(x.pet.id));
  return list;
}
function storiesPage() {
  return `${topbar('走进一个完整的领养故事','预置虚构数据 · 可以操作 · 原记录保留')}<main class="main"><div class="page-title"><p class="eyebrow">MORE THAN A HELLO</p><h1>它们的故事，<br>从这里继续。</h1><p>不必从空白开始，直接体验一段有来有往的相遇。</p></div><div class="demo-inline">17 只猫狗、3 个站点。以下人物、申请、对话与授权均为虚构情节；进入后使用独立数据，不会覆盖你的原记录。切换故事会重新载入该情节。</div><div class="story-list">${storyCards.map(s=>`<button class="story-card" data-action="enter-story" data-value="${s.id}"><img src="${esc(s.image)}" alt="${esc(s.title)}照片" /><div><span>${esc(s.tag)}</span><h2>${esc(s.title)}</h2><p>${esc(s.description)}</p><strong>进入故事 ${icon('arrow')}</strong></div></button>`).join('')}</div>${storyMode?button('返回我的操作记录','exit-story','button secondary full'):button('继续认识小伙伴','nav','button secondary full','meet')}</main>`;
}
async function disabledLegacyStory(id) {
  if(!save())return;
  try {
    let next;
    if(id) {
      next=createStory(id);
      localStorage.setItem(STORY_STORAGE_KEY,JSON.stringify(next));
      sessionStorage.setItem(STORY_MODE_KEY,'on');
    } else {
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));
      next=saved?.version===1?saved:freshState();
      sessionStorage.removeItem(STORY_MODE_KEY);
    }
    await capture.reset();
    state=next;storyMode=!!id;initializeDiscovery(state);initializeCommunity(state);enrichCatalog(state);populateDefaultExamples(state);
    draft=state.draft?structuredClone(state.draft):{photos:[],description:'',sample:false};
    captureIntent={kind:'intake'};pendingFeedback=null;registrationReturn=null;filter='all';navigationStack=[];
    if(!id){const url=new URL(location.href);url.searchParams.delete('story');history.replaceState({},'',url);}
    const card=storyCards.find(s=>s.id===id);
    navigate(card?.route||'mine',card?.petId);navigationStack=[];
    toast(id?'已进入虚构故事，原操作记录保留':'已返回你原来的操作记录');
  } catch {toast('切换失败，请检查浏览器存储设置；原记录仍保留。');}
}
function catalogStatusView() {
  if(catalogBusy)return '<section class="catalog-state" role="status" aria-live="polite"><h2>正在加载宠物档案</h2><p>稍等一下，正在读取救助站公开的资料。</p></section>';
  if(!catalogError)return '';
  const offline=catalogError==='offline',network=catalogError==='network';
  return `<section class="catalog-state" role="alert"><span class="catalog-state-icon" aria-hidden="true">${icon('refresh')}</span><h2>${offline?'网络已断开':network?'暂时连接不上服务':'服务暂时不可用'}</h2><p>${offline?'请检查网络连接，恢复后再试。':network?'暂时无法读取宠物档案，请检查网络或稍后重试。':'宠物档案暂时无法读取，请稍后重试。'}</p>${button('重新加载','catalog-retry','button primary')}</section>`;
}
function meetPage() {
  const list=discoveryItems();
  const hero=list[0];
  const nearby=state.discoveryMode==='nearby';
  const saved=state.discoveryMode==='saved';
  const opening=`${shellHeader()}<main class="main discover">

    <div class="intro-heading ${saved?'saved-intro':nearby?'nearby-intro':'chance-intro'}"><p class="eyebrow">${saved?'SAVED WITH A LITTLE LOVE.':nearby?'REAL PAWS. REAL CONNECTION.':'A LITTLE CHANCE. A NEW FRIEND.'}</p><h1>${saved?'喜欢的它们，<br>都在<span class="orange">这里。</span>':nearby?'你的附近，<br>有点<span class="orange">可爱。</span>':'下一位心动，<br>刚好<span class="orange">是你。</span>'}</h1><p>${saved?'再看一眼，接着聊聊，把心动慢慢变熟悉。':nearby?'找个离你近的小伙伴，先 say hi。':'让缘分翻一页，和没见过的小可爱打个招呼。'}</p><span class="intro-paw" aria-hidden="true">${icon(saved?'heart':nearby?'paw':'spark')}</span></div>
    <div class="discovery-tabs">${button(icon('pin')+' 附近','discovery-mode',nearby?'active':'','nearby')}${button(icon('spark')+' 随缘遇见','discovery-mode',!nearby&&!saved?'active':'','swipe')}${button(icon('heart')+' 喜欢的','discovery-mode',saved?'active':'','saved')}</div>
    <div class="filter-row" role="group" aria-label="筛选动物">${[['all','全部'],['cat','猫咪'],['dog','狗狗']].map(([id,label])=>button(label,'filter',`filter-chip ${filter===id?'selected':''}`,id)).join('')}</div>`;
  const catalogStatus=catalogStatusView();
  if(catalogStatus)return `${opening}${catalogStatus}</main>`;
  if(saved){
    const favorites=state.following.map(id=>activePet(state,id)).filter(p=>p&&(filter==='all'||p.species===(filter==='cat'?'猫':'狗')));
    return `${opening}<p class="saved-count">${favorites.length} 位喜欢的小伙伴</p><div class="saved-pet-list">${favorites.map(p=>`<article class="saved-pet-card"><button class="saved-pet-photo" data-action="profile" data-value="${p.id}" aria-label="查看${esc(p.name)}的档案">${photo(p,'','loading="lazy"')}</button><div class="saved-pet-info"><div class="saved-pet-name"><h2>${esc(p.name)}</h2>${button(icon('heart'),'follow','saved-pet-heart saved',p.id,`aria-label="取消喜欢${esc(p.name)}"`)}</div>${statusPill(p)}<p>${esc(p.age)} · ${esc(p.coat)} · ${esc(p.city)}</p><p class="saved-pet-mood">${esc(p.tags.slice(0,2).join(' · '))}</p><button class="saved-pet-station" data-action="station" data-value="${stationFor(p).id}">${icon('home')} ${esc(stationFor(p).name)} ${icon('chevron')}</button><div class="saved-pet-actions">${button('看档案','profile','button secondary',p.id)}${button(state.messages[p.id]?.length?'继续聊天':'打个招呼','chat','button primary',p.id)}</div></div></article>`).join('')||empty('还没有收藏的小伙伴','遇到心动的它，点一下爱心，下次就能在这里找到。',button('去随缘遇见','discovery-mode','button primary','swipe'))}</div></main>`;
  }
  return `${opening}
    ${hero?`<article class="hero-pet ${!nearby?'swipe-card':''}" ${!nearby?'id="swipe-card"':''} data-pet="${hero.pet.id}">
      ${!nearby?'<span class="swipe-stamp stamp-like">想认识</span><span class="swipe-stamp stamp-skip">下一位</span>':''}
      <button class="hero-image-button" data-action="profile" data-value="${hero.pet.id}" aria-label="了解${esc(hero.pet.name)}">${photo(hero.pet,'hero-image','fetchpriority="high"')}<span class="image-shade"></span><span class="hero-label">${icon('spark')} 和你有些合拍</span><span class="hero-caption"><span>${esc(hero.pet.name)} <small>${hero.pet.sex==='男孩子'?'♂':'♀'}</small></span><span class="hero-location">${esc(hero.pet.age)} · ${esc(hero.pet.city)}</span></span></button>
      ${button(icon('heart'),'follow',`save-button ${state.following.includes(hero.pet.id)?'saved':''}`,hero.pet.id,`aria-label="${state.following.includes(hero.pet.id)?'取消关注':'关注'}${esc(hero.pet.name)}"`)}
      <div class="hero-content"><p class="pet-quote">“${esc(hero.pet.mood)}”</p><div class="tags">${hero.pet.tags.slice(0,2).map(t=>`<span>${esc(t)}</span>`).join('')}</div><button class="match-reason station-card-link station-origin" data-action="station" data-value="${stationFor(hero.pet).id}"><span class="station-origin-symbol">${icon('home')}</span><span class="station-origin-copy"><small>照顾我的救助站</small><strong>${esc(stationFor(hero.pet).name)}</strong></span><span class="station-origin-distance">${Number.isFinite(hero.distance)?'约 '+distanceLabel(hero.distance):'距离待补充'} ${icon('chevron')}</span></button>${nearby?button(`和${esc(hero.pet.name)}打个招呼 ${icon('arrow')}`,'chat','button primary full',hero.pet.id):button('先看看真实档案 '+icon('arrow'),'profile','deck-profile',hero.pet.id)}</div>
    </article>`:empty(nearby?'这个范围暂时没有合适的伙伴':'这一轮，先看到这里。',nearby?'可以调整位置和距离，或去随缘遇见。':'喜欢的都帮你记着，可以回看或重新刷一轮。',nearby?button('调整位置与距离','location','button secondary'):button('重新遇见','reset-deck','button secondary'))}
    ${!nearby?`<div class="swipe-actions">${button(icon('refresh'),'undo-swipe','swipe-undo','','aria-label="撤回上一次滑动" '+(!state.swipeHistory.length?'disabled':''))}${button(icon('close'),'swipe-skip','swipe-no',hero?.pet.id||'','aria-label="左滑，换一位" '+(!hero?'disabled':''))}${button(icon('heart'),'swipe-like','swipe-yes',hero?.pet.id||'','aria-label="右滑，想认识" '+(!hero?'disabled':''))}${button(icon('chat'),'chat','swipe-chat',hero?.pet.id||'','aria-label="直接聊聊" '+(!hero?'disabled':''))}</div><p class="swipe-caption">喜欢只是开始，领养前要认真了解彼此。</p>`:''}
    ${nearby&&list.length>1?`${sectionHeading('MORE FRIENDS NEARBY','附近还有它们')}<div class="pet-grid">${list.slice(1).map(({pet,distance})=>`<button class="small-pet" data-action="profile" data-value="${pet.id}"><div>${photo(pet,'','loading="lazy"')}<span>${pet.species==='猫'?'喵':'汪'}</span></div><strong>${esc(pet.name)} <small>约 ${distanceLabel(distance)}</small></strong><p>${esc(pet.tags[0])}</p></button>`).join('')}</div>`:''}
  </main>`;
}
function messagesPage() {
  const entries=Object.entries(state.messages).filter(([,m])=>m.length).sort((a,b)=>b[1].at(-1).at-a[1].at(-1).at);
  return `${shellHeader()}<main class="main messages-page"><section class="messages-guide"><h1>宠物来信 <span>先聊聊，再决定</span></h1><p>和宠物 AI 分身聊习惯、喜好与照护。想进一步认识它，就发起领养申请。</p></section>
    ${requestsView()}
    <div class="consent-card">${icon('spark')}<div><strong>${state.consent===true?'接收宠物分身的招呼':state.consent===false?'主动招呼已暂停':'接收宠物分身的招呼'}</strong><p>按你的偏好推荐，点击开关可暂停。</p></div>${button(state.consent===true?'已开启':'开启','consent',`small-button ${state.consent===true?'muted-button':''}`,state.consent===true?'off':'on')}</div>
    ${entries.length?`<div class="message-list">${entries.map(([id,messages])=>{ const p=activePet(state,id);if(!p)return''; const last=messages.at(-1);const unread=last.from==='pet'&&last.at>(state.read[id]||0);return `<button class="message-item" data-action="chat" data-value="${id}"><div class="avatar-wrap">${photo(p,'avatar')}${unread?'<i></i>':''}</div><div class="message-preview"><div><strong>${esc(p.name)}</strong><span class="agent-tag">AI 分身</span><time>${state.sampleStory?'最近':'刚刚'}</time></div><p>${esc(last.text)}</p><small>${p.status==='adopted'?'一起生活的第 '+state.day+' 天':state.muted.includes(id)?'主动联系已暂停':unread?'给你发来一声招呼':'正在慢慢了解彼此'}</small></div>${icon('chevron')}</button>`;}).join('')}</div>`:empty('还没有开始聊天','去「遇见」选一只宠物，点击「聊一聊」。它的 AI 分身会根据救助档案回答你的问题。',button('去遇见宠物 '+icon('arrow'),'nav','button primary','meet'))}


  </main>`;
}
function minePage() {
  const application=state.applications.find(a=>a.stage>=0),account=state.account;
  const adopted=account?[...new Set(state.applications.filter(a=>a.stage===3&&a.adopterId===account.id).map(a=>a.petId))].map(id=>activePet(state,id)).filter(Boolean):[];
  return `${shellHeader()}<main class="main"><div class="personal-card ${adopted.length?'has-pets':''}"><div class="family-avatar-row"><span class="human-avatar">${esc(account?.nickname[0]||'你')}</span>${adopted.length?`<span class="family-plus" aria-hidden="true">+</span>${adopted.map(p=>`<button class="family-pet" data-action="chat" data-value="${p.id}" aria-label="和${esc(p.name)}的 Agent 聊天">${photo(p)}<span>${esc(p.name)}</span><small>AI 分身</small></button>`).join('')}`:''}</div><div class="personal-copy"><p class="eyebrow">MY LITTLE WORLD</p><h1>${account?'你好，'+esc(account.nickname):'让相遇，有个开始。'}</h1><p>${adopted.length?'你和 '+adopted.map(p=>esc(p.name)).join('、')+' 的小日子':account?'账号已注册 · 实名待核验':'先逛逛，准备领养时建立你的账号。'}</p></div></div>
    ${account?button('看看我的个人主页 '+icon('arrow'),'public-profile','button primary full'):button('注册领养账号 '+icon('arrow'),'register','button primary full')+button('已有账号，去登录','adopter-login','text-button full spaced')}
    <div class="stats-row"><div><b>${state.following.length}</b><span>喜欢的小伙伴</span></div><div><b>${state.memory.length}</b><span>偏好与记忆</span></div><div><b>${state.applications.filter(a=>a.stage>=0).length}</b><span>领养申请</span></div></div>
    <div class="menu-card">${menu('home','我的领养进度',application?activePet(state,application.petId)?.name+' · '+stages[application.stage]:'还没有提交申请','progress')}${menu('heart','救助站评价','0–5 星 · 定期回访与照护记录','ratings')}${menu('clock','生活画像与陪伴时间',account?.lifestyle?'已记录作息、空闲时间与领养预期 · 查看资料':account?'尚未记录 · 补充生活资料':'注册时通过语音对话建立画像','lifestyle')}${menu('shield','身份与领养公约','身份信息不在主页公开','account')}</div>
${sectionHeading('GETTING TO KNOW YOU','越了解，越合拍')}
    <div class="menu-card">${menu('book','我的偏好与记忆','你说过的喜欢，都可以修改','memory')}${menu('heart','我关注的小伙伴','看看想继续了解的它们','saved')}${menu('shield','主动招呼设置',state.consent?'已开启 · 点击暂停':'未开启 · 点击开启','consent',state.consent?'off':'on')}${menu('home','认识救助站','主页、待领养伙伴与专属 Agent','stations')}</div>
    <div class="join-station">${icon('home')} 我是救助站负责人 ${button('联系开通','station-onboarding','text-button')}</div>${account?`<div class="account-footer">${button('退出当前账号','logout','text-button')}</div>`:''}
  </main>`;
}
function menu(i,title,sub,action,value='') {return `<button class="menu-item" data-action="${action}" data-value="${value}"><span class="menu-icon">${icon(i)}</span><span><strong>${title}</strong><small>${sub}</small></span>${icon('chevron')}</button>`;}
function profilePage() {
  const p=activePet(state,page.id); if(!p)return empty('找不到这位小伙伴','请返回重新选择。');
  const application=currentApplication(p.id);
  return `<div class="profile-photo">${photo(p)}<div class="profile-top">${button(icon('back'),'back','icon-button glass','','aria-label="返回"')}${button(icon('share'),'share-pet','icon-button glass',p.id,'aria-label="分享宠物"')}</div><span class="profile-label">救助者维护的宠物档案</span>${button(icon('heart'),'follow',`icon-button glass profile-like ${state.following.includes(p.id)?'saved':''}`,p.id,`aria-label="${state.following.includes(p.id)?'取消喜欢':'喜欢'}${esc(p.name)}" aria-pressed="${state.following.includes(p.id)}"`)}</div><main class="main profile-main"><div class="profile-name"><div><p class="eyebrow">NICE TO MEET YOU</p><h1>${esc(p.name)} <small>${p.sex==='男孩子'?'♂':p.sex==='女孩子'?'♀':''}</small></h1></div>${statusPill(p)}</div><p class="pet-meta">${[p.age,p.sex,p.coat,p.city].filter(Boolean).map(esc).join(' · ')}</p><p class="profile-quote">“${esc(p.mood)}”</p><div class="tags">${p.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div>
    ${sectionHeading('A LITTLE ABOUT ME','先认识，真实的我')}
    <p class="body-copy">${esc(p.intro)}</p>${profileFactsView(p,profileFacts)}
    <button class="station-note station-card-link" data-action="station" data-value="${stationFor(p).id}"><span class="station-icon">${icon('home')}</span><div><strong>${esc(p.station)}</strong><p>看看是谁在照顾它 · 进入救助站主页</p></div>${icon('chevron')}</button>
    <p class="footnote">AI 分身只依据救助者档案介绍自己，不能实时感知动物状态。</p>
  </main><div class="sticky-actions">${button(icon('chat')+' 聊一聊','chat','button secondary',p.id)}${p.status==='adopted'?button('查看到家记录','followup','button primary',p.id):application?button('查看领养进度','progress','button primary',application.id):button('我想领养 '+icon('arrow'),'apply','button primary',p.id,p.status!=='available'?'disabled':'')}</div>`;
}
function chatPage() {
  const p=activePet(state,page.id); if(!p)return empty('没有找到对话','请返回消息列表。');
  const messages=state.messages[p.id]||[];
  const application=currentApplication(p.id);
  const adopted=p.status==='adopted',day=adoptionDay(state,p.id);
  const suggestions=adopted?['看看今天的照护提醒','今天开始出来走走了','我有点担心它的状态']:['你是什么性格？','我喜欢狸花，最好安静一点','我是第一次养猫'];
  const latest=state.followups.filter(f=>f.petId===p.id).at(-1);
  const context=adopted
    ? `<div class="chat-context adopted-context"><span class="context-icon">${icon('home')}</span><div><small>到家第 ${day} 天 · ${latest?.day===day?'今天已记录':'今天还没记录'}</small><strong>${day===1?'先安顿下来，慢慢熟悉。':'记录一点，共同生活的日常。'}</strong></div>${button(latest?.day===day?'查看日记':'记录今天','followup','context-button',p.id)}</div>`
    : application?`<div class="chat-context"><span class="context-icon">${icon('heart')}</span><div><small>领养申请 · ${stages[application.stage]}</small><strong>下一步，和救助者一起确认。</strong></div>${button('查看进度','progress','context-button',application.id)}</div>`
    : `<div class="chat-context">${photo(p,'mini-avatar')}<div><small>${esc(p.age)} · ${esc(p.tags[0])}</small><strong>聊得投缘，再认真了解它。</strong></div>${button('了解与领养','profile','context-button',p.id)}</div>`;
  return `<header class="topbar">${button(icon('back'),'back','icon-button','','aria-label="返回"')}<div class="topbar-title"><strong>${esc(p.name)} <span class="agent-tag">AI 分身</span></strong><small>${adopted?'已经成为家人，继续陪你记录日常':'慢慢认识彼此'}</small></div>${button(icon('more'),'chat-options','icon-button',p.id,'aria-label="对话设置"')}</header>${context}
    <div class="chat-stream" role="log" aria-label="聊天记录" aria-live="polite"><div class="chat-date">${state.sampleStory?'聊天记录':'今天 · 从一句你好开始'}</div>
    ${messages.map(m=>`<div class="chat-message ${m.from==='user'?'outgoing':''}">${m.from==='pet'?photo(p,'chat-avatar'):`<span class="chat-avatar person">${esc((state.account?.nickname||'小禾').slice(0,1))}</span>`}<div class="bubble-wrap"><div class="bubble">${esc(m.text)}</div>${m.reasons?`<small class="bubble-reason">${icon('spark')} ${esc(m.reasons.join(' · '))}</small>`:''}${m.memory?`<button class="memory-inline" data-action="memory">${icon('book')} 已记住你的偏好 · 查看或修改</button>`:''}${m.intent&&!adopted?button('了解领养条件 '+icon('arrow'),'apply','bubble-action',p.id):''}</div></div>`).join('')}
    </div><div class="chat-bottom">${chatBusy?'<p role="status" class="chat-loading">正在翻阅宠物的档案…</p>':''}${chatError?`<p role="alert" class="chat-error">${esc(chatError)}</p>`:''}<div class="chat-suggestions">${suggestions.map(t=>button(t,'suggestion','suggestion',t)).join('')}</div><form id="chat-form" class="chat-compose"><label class="sr-only" for="chat-input">发送消息</label><input id="chat-input" name="message" placeholder="${adopted?'聊聊你们今天的日常…':'说点什么，慢慢认识它…'}" autocomplete="off" maxlength="500" required /><button class="send-button" type="submit" aria-label="发送消息" ${chatBusy?'disabled':''}>${icon('send')}</button></form></div>`;
}
function memoryPage() {
  return `${topbar('我的偏好与记忆','让每一次推荐，更懂你的生活')}<main class="main"><div class="memory-hero">${icon('book')}<h1>喜欢，可以慢慢清晰。</h1><p>记住你明确说过的事。<br>也留给你随时改变的自由。</p></div><div class="memory-list">${state.memory.map(m=>`<div class="memory-item"><span class="memory-type">${m.type==='condition'?'生活条件':'我的偏好'}</span><strong>${esc(m.text)}</strong><small>${esc(m.source)}</small><div>${button(icon('edit'),'edit-memory','icon-button',m.id,'aria-label="编辑记忆"')}${button(icon('trash'),'delete-memory','icon-button',m.id,'aria-label="删除记忆"')}</div></div>`).join('')||empty('从一句喜欢开始','聊天中明确表达的偏好会出现在这里。')}</div>${button(icon('plus')+' 补充一条记忆','add-memory','button secondary full')}<p class="footnote">修改会影响下一轮推荐，不会修改动物档案。删除后不再参与匹配；重新明确表达时可再次记住。</p>${button('看看现在更适合谁 '+icon('arrow'),'nav','button primary full','meet')}</main>`;
}
function updateVoiceUI(){
 const v=voiceChat?.state;if(!v)return;
 const mic=document.querySelector('#interview-hold')||document.querySelector('#application-hold');
 const live=document.querySelector('#interview-live')||document.querySelector('#application-live');
 const toggle=document.querySelector('[data-action=interview-voice-toggle]');if(toggle)toggle.disabled=v.holding||v.finishing||lifestyleSpeechBusy||capture.media.voicePending;
 if(mic){mic.disabled=v.finishing||lifestyleSpeechBusy;mic.classList.toggle('recording',v.holding);mic.classList.toggle('cancelling',v.cancelling);const span=mic.querySelector('span');if(span)span.textContent=v.finishing?'正在处理…':v.cancelling?'松手取消':capture.media.voicePending?'允许麦克风后继续按住':v.holding?(capture.media.voiceRecorder?'松手发送 · '+capture.media.audioSeconds+' 秒':'正在打开麦克风…'):'按住说话';}
 if(live&&v.holding)live.textContent=v.cancelling?'这段不会发送':v.live|| (v.realtime?'正在听你说…':'正在录音，松手后转写…');
}
const voiceChat=createPressToTalk({capture,onChange:updateVoiceUI,onSend:async(url,live)=>{lifestyleText=live||'';await transcribeLifestyle();}});
function resetLifestyleSpeech(){lifestyleSpeech.cancel();lifestyleSpeechBusy=false;lifestyleSpeechError='';}
function loadLifestyleStep(index){
 if(!Number.isInteger(index)||index<0||index>=4)return;
 resetLifestyleSpeech();voiceChat.cancel();interviewEpoch++;capture.reset();lifestyleStep=index;lifestyleReview=false;lifestyleViewing=false;interviewAnalysis=null;interviewTurns=interviewTurns.filter(turn=>turn.step<index);lifestyleText='';render();
}
function startLifestyle(){
 resetLifestyleSpeech();const owner=lifestyleOwner();if(!owner){registrationGate('lifestyle');return;}
 owner.lifestyleDraft??=structuredClone(owner.lifestyle?.answers||{});lifestyleViewing=!!owner.lifestyle;lifestyleReview=lifestyleViewing;
 interviewAnalysis=owner.lifestyle?.analysis||null;lifestyleStep=0;lifestyleText='';interviewTurns=[];interviewVoiceOpen=false;capture.reset();navigate('lifestyle');
}
async function transcribeLifestyle(){
 if(exampleMode){toast('示例访谈使用预设回答；真实语音请返回正式界面体验。');return;}
 if(lifestyleSpeechBusy||!capture.media.audioUrl)return;
 const current=interviewEpoch,context=page.name;lifestyleSpeechBusy=true;lifestyleSpeechError='';render();
 const result=await lifestyleSpeech.transcribe(capture.media.audioUrl);if(!result||current!==interviewEpoch)return;
 lifestyleSpeechBusy=false;
 if(result.text){lifestyleText=result.text;if(context==='apply'){applicationNote=(applicationNote?applicationNote+'\n':'')+result.text;render();}else await sendInterviewAnswer(result.text);}
 else{lifestyleSpeechError=result.error;if(context==='apply'&&lifestyleText)applicationNote=lifestyleText;render();}
}
async function sendInterviewAnswer(text){
 if(lifestyleSpeechBusy||capture.media.voiceRecorder||capture.media.voicePending||!text.trim()||!lifestyleOwner())return;
 if(text.length>2000){toast('请控制在 2000 字以内。');return;}
 const epoch=interviewEpoch;const turn={step:lifestyleStep,text,reply:''};interviewTurns.push(turn);lifestyleText='';lifestyleSpeechBusy=true;lifestyleSpeechError='';render();
 try{
   const response=await accountApi.interview(lifestyleQuestions[lifestyleStep].key,text);if(epoch!==interviewEpoch)return;
   turn.reply=response.reply;
   if(!response.understood){lifestyleSpeechBusy=false;render();return;}
   lifestyleOwner().lifestyleDraft[lifestyleQuestions[lifestyleStep].key]={text,value:response.value};lifestyleText='';await capture.reset();
   lifestyleSpeechBusy=false;
   if(lifestyleStep<3){lifestyleStep++;render();}else await summarizeLifestyle();
 }catch(e){if(epoch===interviewEpoch){lifestyleText=text;lifestyleSpeechError=e.message;lifestyleSpeechBusy=false;render();}}
}
async function summarizeLifestyle(){
 const owner=lifestyleOwner();if(!owner||lifestyleSpeechBusy)return;
 const epoch=interviewEpoch;lifestyleReview=true;lifestyleViewing=false;lifestyleSpeechBusy=true;lifestyleSpeechError='';interviewAnalysis=null;render();
 try{const analysis=await accountApi.summary(owner.lifestyleDraft);if(epoch===interviewEpoch)interviewAnalysis=analysis;}
 catch(e){if(epoch===interviewEpoch)lifestyleSpeechError=e.message;}
 finally{if(epoch===interviewEpoch){lifestyleSpeechBusy=false;render();}}
}
async function confirmAccount(){
 if(authBusy||lifestyleSpeechBusy||!interviewAnalysis)return;
 const registering=!state.account;if(registering&&!registrationCredentials){navigate('register');toast('请重新填写账号资料。');return;}
 authBusy=true;lifestyleSpeechError='';render();
 try{
  const lifestyle={answers:lifestyleOwner().lifestyleDraft,analysis:interviewAnalysis};
  const profile=registering?await accountApi.register({...registrationCredentials,lifestyle},registrationKey):await accountApi.saveLifestyle(lifestyle);
  if(registering){acceptAccount(profile);resumeAccount();}else{state.account=profile;navigate('mine');}
  toast(exampleMode?'示例体验已保存，未创建真实账号。':registering?'账号已创建，实名待核验':'生活画像已保存');
 }catch(e){lifestyleSpeechError=e.message;}finally{authBusy=false;render();}
}
function lifestylePage(){
 if(!lifestyleOwner())return '';
 return interviewView({topbar,esc,icon,button,questions:lifestyleQuestions,answers:lifestyleViewing?state.account.lifestyle.answers:lifestyleOwner().lifestyleDraft,analysis:interviewAnalysis,step:lifestyleStep,review:lifestyleReview,viewing:lifestyleViewing,registering:!state.account,busy:lifestyleSpeechBusy||authBusy,error:lifestyleSpeechError,turns:interviewTurns,voiceOpen:interviewVoiceOpen,text:lifestyleText,audioUrl:capture.media.audioUrl});
}

function applyPage(){
 const p=activePet(state,page.id),a=state.account;if(!p||!a)return '';
 const analysis=a.lifestyle?.analysis;
 if(applicationReview)return `${topbar('确认本次申请','确认后交给负责它的救助站')}<main class="main"><section class="application-profile"><h2>${esc(a.nickname)} → ${esc(p.name)}</h2><p>${esc(a.realName)} · ${esc(a.phone)}</p><p>实名状态：${a.verification==='verified'?'已核验':'待核验'}</p><h3 class="spaced">${esc(analysis?.title||'生活画像')}</h3><p>${esc(analysis?.summary||'')}</p><details><summary>本次分享的全部个人资料</summary>${lifestyleQuestions.map(q=>`<p><strong>${esc(q.label)}</strong><br>${esc(a.lifestyle?.answers?.[q.key]?.text||'尚未了解')}</p>`).join('')}<p>微信：${esc(a.wechat||'未填写')}<br>邮箱：${esc(a.email||'未填写')}</p><p>${state.memory.map(m=>esc(m.text)).join('；')}</p></details><h3 class="spaced">本次补充与问题</h3><p style="white-space:pre-wrap">${esc(applicationNote)}</p>${button('返回修改','application-edit','text-button')}</section><form id="application-confirm-form" class="form-stack spaced"><label class="checkbox-label"><input name="shareProfile" type="checkbox" required>我确认将以上资料交给${esc(p.station)}，用于本次领养沟通。</label><p class="footnote">当前实名待核验，救助站会看到此状态。完成核验前不能确认交接。</p>${applicationError?`<p class="form-error" role="alert">${esc(applicationError)}</p>`:''}<button type="submit" class="button primary full" ${applicationBusy?'disabled':''}>${applicationBusy?'正在提交…':'确认提交领养申请'}</button></form></main>`;

 return `${topbar('准备领养申请','已带入你确认的资料')}<main class="main"><div class="mini-pet-card">${photo(p,'avatar')}<div><h2>再和${esc(p.name)}靠近一点</h2><p>确认资料，认真准备一个家。</p></div></div><form id="application-form" class="form-stack"><section class="application-profile"><h3>${esc(analysis?.title||'你的生活画像')}</h3><p>${esc(analysis?.summary||'可以在我的页面完善生活画像。')}</p><div class="persona-highlights">${(analysis?.highlights||[]).map(t=>`<span>${esc(t)}</span>`).join('')}</div><details><summary>查看本次带入的个人资料</summary><p>${esc(a.realName)} · ${esc(a.phone)}${a.wechat?' · 微信 '+esc(a.wechat):''}${a.email?' · '+esc(a.email):''}</p>${lifestyleQuestions.map(q=>`<p><strong>${esc(q.label)}</strong><br>${esc(a.lifestyle?.answers?.[q.key]?.text||'尚未了解')}</p>`).join('')}</details>${button('和助手聊聊，修改生活画像','lifestyle','text-button')}</section><section class="application-conversation"><div class="interview-bubble agent"><span class="interview-agent-mark">${icon('spark')} 领养助手</span><p>作息和陪伴安排已经带过来了。再说说家里的空间、家人意见和其他宠物吧；有什么想问救助站的，也一起告诉我。</p></div><div id="application-live" class="interview-live" role="status">${lifestyleSpeechBusy?'正在转写…':'一次说完，不用分项填写。'}</div>${lifestyleSpeechError?`<p class="form-error" role="alert">${esc(lifestyleSpeechError)}</p>${button('重新转写','lifestyle-transcribe','text-button')}`:''}<button id="application-hold" class="interview-hold" type="button" ${lifestyleSpeechBusy?'disabled':''}>${icon('mic')}<span>按住说话</span></button><label class="sr-only" for="application-note">补充资料与问题</label><textarea id="application-note" name="conditions" rows="4" maxlength="2000" required placeholder="说完会显示在这里，也可以直接打字修改。">${esc(applicationNote||state.applicationDrafts?.[p.id]?.note||'')}</textarea></section><p class="footnote">已确认的画像与本次补充会一起组成申请资料；正式提交前可以核对。下一步可以统一核对，不需要重新填写注册时确认的资料。</p><p class="form-error" id="application-error" role="alert"></p><button type="submit" class="button primary full">看看整理好的申请 ${icon('arrow')}</button></form></main>`;
}

function progressPage() {
  const applications=state.applications.filter(a=>!a.adopterId||a.adopterId===state.account?.id);
  return `${topbar('我的领养进度','慢慢来，每一步都值得认真')}<main class="main">${applications.length?applications.map(a=>{const p=activePet(state,a.petId);return `<article class="application-card"><div class="mini-pet-card">${photo(p,'avatar')}<div><h2>${esc(p.name)}</h2><p>${a.stage<0?'申请已结束':stages[a.stage]}</p></div></div><div class="timeline">${stages.map((s,i)=>`<div class="${a.stage>=i?'done':''}"><span>${a.stage>i?icon('check'):i+1}</span><p>${s}</p></div>`).join('')}</div><p class="body-copy">${a.stage===0?'救助者会查看你提交的条件，必要时继续沟通。':a.stage===1?'已进入见面阶段，具体时间地点由双方沟通确认。':a.stage===2?'见面结果已确认，等待双方完成交接。':a.stage===3?'交接已完成。接下来，我们一起记录适应过程。':'该申请已撤回或结束，可以重新认识其他伙伴。'}</p>${a.stage===3?button('进入到家跟进','followup','button primary full',p.id):a.stage>=0?button('撤回申请','withdraw','button secondary full',a.id):''}</article>`;}).join(''):empty('还没有申请','先聊一聊，认真认识一位新朋友。',button('去遇见','nav','button primary','meet'))}</main>`;
}
function workPage() {
  const station=stationById(state.activeStationId),team=stationPets(state,station.id);
  const belongs=id=>team.some(p=>p.id===id);
  const tasks=[
    ...state.followups.filter(f=>belongs(f.petId)&&!f.resolved).sort((a,b)=>Number(b.attention)-Number(a.attention)).map(f=>({type:'followup',title:activePet(state,f.petId).name+' · '+(f.attention?'需要关注':'收到近况'),detail:f.summary||f.text,action:'followup',id:f.petId,label:'查看并回复',urgent:f.attention})),
    ...state.applications.filter(a=>belongs(a.petId)&&a.stage>=0&&a.stage<3).map(a=>({type:'application',title:a.name+' → '+activePet(state,a.petId).name,detail:stages[a.stage],action:'application',id:a.id,label:['审核申请','安排见面','确认交接'][a.stage]})),
    ...team.filter(p=>!p.confirmed).map(p=>({type:'draft',title:p.name,detail:'档案已整理，等待你核对',action:'confirm',id:p.id,label:'核对档案'})),
    ...state.applications.filter(a=>belongs(a.petId)&&a.stage===3&&a.adopterId&&evaluationStatus(state,a).due).map(a=>({type:'rating',title:a.name+' · '+activePet(state,a.petId).name,detail:'已到定期评价时间',action:'ratings',id:a.adopterId,label:'填写评价'}))
  ];
  const visible=tasks.filter(t=>workFilter==='all'||t.type===workFilter);
  return `${topbar(esc(station.name),'今天，把待办一件件处理好',false)}<main class="main rescue-work">
    <div class="rescue-shortcuts">${button(icon('camera')+' 录入新伙伴','intake','button primary')}${button(icon('mic')+' 给宠物补充','pet-observation','button secondary')}</div>
    <div class="station-inline">${button('站点主页 '+icon('chevron'),'station','text-button',station.id)}<span>${team.length} 只宠物 · ${tasks.length} 项待办</span></div>
    <div class="task-tabs" aria-label="待办分类">${[['all','全部'],['application','申请'],['followup','回访'],['draft','档案'],['rating','评价']].map(([id,label])=>button(label+' '+(id==='all'?tasks.length:tasks.filter(t=>t.type===id).length),'work-filter',workFilter===id?'active':'',id)).join('')}</div>
    <div class="work-tasks">${visible.length?visible.map(t=>`<article class="work-task ${t.urgent?'urgent':''}"><span class="task-type">${{application:'领养申请',followup:'到家反馈',draft:'待确认档案',rating:'定期评价'}[t.type]}${t.urgent?' · 优先处理':''}</span><h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p>${button(t.label+' '+icon('arrow'),t.action,'button secondary full',t.id)}</article>`).join(''):empty('这类待办已处理好','新申请和回访反馈会出现在这里。')}</div>
    <div class="menu-card spaced">${menu('inbox','全部申请记录','查看申请进度与历史','applications')}${menu('spark','Agent 匹配记录','查看主动招呼与复盘','reviews')}</div>
  </main>`;
}
function animalRow(p) {return `<article class="animal-manage-card"><button class="animal-row" data-action="${p.confirmed?'agent':'confirm'}" data-value="${p.id}">${photo(p,'avatar')}<div><strong>${esc(p.name)}</strong><small>${esc(p.character)} · ${esc(p.age)}</small>${statusPill(p)}</div>${icon('chevron')}</button><div class="animal-quick-actions">${button(icon('mic')+' 语音补充','pet-observation','button secondary',p.id)}${button(p.confirmed?'查看档案':'核对草稿',p.confirmed?'agent':'confirm','text-button',p.id)}</div></article>`;}
function animalsPage() {
  const team=stationPets(state,state.activeStationId),pets=team.filter(p=>(animalFilter==='all'||(animalFilter==='draft'?!p.confirmed:p.confirmed&&p.status===animalFilter))&&(!animalSearch||p.name.includes(animalSearch)));
  return `${topbar('动物档案','找到它，说说今天的新发现',false)}<main class="main">${button(icon('plus')+' 录入新伙伴','intake','button primary full')}<form id="animal-search-form" class="animal-search"><input name="search" aria-label="按宠物名字查找" placeholder="搜索宠物名字" value="${esc(animalSearch)}" /><button class="button secondary">查找</button></form><div class="task-tabs">${[['all','全部'],['available','待领养'],['adopted','已领养'],['draft','草稿']].map(([id,label])=>button(label,'animal-filter',animalFilter===id?'active':'',id)).join('')}</div><div class="animal-list spaced">${pets.length?pets.map(animalRow).join(''):empty('没有找到对应宠物','试试其他名字或切换分类。')}</div></main>`;
}
function petManagementPage() {
  const p=activePet(state,page.id);if(!p||state.role!=='rescue'||stationFor(p).id!==state.activeStationId)return `${topbar('动物档案')}<main class="main">${empty('无法管理这只宠物','请在所属站点查看。')}</main>`;
  const notes=(p.knowledge||[]).filter(n=>!n.supersededAt),history=(p.knowledge||[]).filter(n=>n.supersededAt);
  const application=state.applications.find(a=>a.petId===p.id&&a.stage===3);
  const card=n=>`<article class="knowledge-card"><div><strong>${esc(knowledgeTopics.find(q=>q.key===n.topic)?.label||'观察')}</strong><span>${{ongoing:'长期观察',observation:'单次观察',pending:'待核实'}[n.certainty]}</span></div><p>${esc(n.text)}</p><small>${n.dateBasis==='recorded'?'记录于 ':'观察于 '}${esc(n.observedOn)} · ${esc(n.source)}</small></article>`;
  return `${topbar(esc(p.name)+'的档案','说出新观察，自动归档到它的资料库')}<main class="main pet-management"><div class="mini-pet-card">${photo(p,'avatar')}<div><h2>${esc(p.name)}</h2><p>${esc(p.species)} · ${esc(p.age)}</p>${statusPill(p)}</div></div>
    <button class="intake-cta observation-cta" data-action="pet-observation" data-value="${p.id}"><span class="intake-icon">${icon('mic')}</span><div><strong>说说它的新发现</strong><p>习惯、喜好、饮食和肠胃情况</p></div>${icon('plus')}</button>
    ${application?`<div class="menu-card spaced">${menu('user','领养人 · '+application.name,'查看主页和历史评价','public-profile',application.adopterId)}${menu('book','到家反馈与回访','查看近况，回复或发起回访','followup',p.id)}</div>`:''}
    ${sectionHeading('PET KNOWLEDGE','Agent 的长期资料库')}<p class="footnote">Agent 回答相关问题时会引用已归档的资料和来源。不同时间的观察分别保留，待核实内容会明确说明。</p>
    ${(p.observationSources||[]).filter(n=>n.status==='awaiting-analysis').map(n=>`<details class="rescue-details"><summary>${icon('clock')} 一段语音待整理 · ${esc(n.observedOn)}</summary><p class="footnote">原始资料已保存，转写服务尚未接入，暂不参与 Agent 的事实回答。</p>${renderMedia(n.media)}</details>`).join('')}
    ${notes.length?notes.slice().reverse().map(card).join(''):empty('还没有整理好的补充','说一段新发现，逐步丰富它的资料。')}
    <details class="rescue-details" open><summary>基础档案</summary><div class="facts-card">${[['character','性格'],['health','健康记录'],['needs','照护要求'],['unknown','待确认']].map(([key,label])=>`<div><span>${label}</span><p>${esc(p[key]||'待确认')}</p></div>`).join('')}</div>${button('修改基础档案','confirm','text-button full',p.id)}</details>
    ${history.length?`<details class="rescue-details"><summary>已更正的历史记录 · ${history.length} 条</summary>${history.map(card).join('')}</details>`:''}
    <div class="menu-card spaced">${menu('chat','试着问问它的 Agent','查看它如何根据档案回答','chat',p.id)}${menu('spark','Agent 表达与匹配设置','自我介绍、主动匹配和复盘','agent-settings',p.id)}${menu('home','所属救助站','查看对外主页','station',stationFor(p).id)}</div></main>`;
}
function observationPage() {
  const pets=stationPets(state,state.activeStationId),p=pets.find(p=>p.id===captureIntent.petId),busy=observationBusy||observationHold||observationFinishing||capture.media.voicePending;
  const result=observationResult?.petId===p?.id?observationResult:null;
  return `${topbar('给宠物补充','选好它，按住说，松开自动归档')}<main class="main observation-page ${result?'has-result':''}">
    <label class="observation-pet-label">这次说的是谁<select id="observation-pet" ${busy?'disabled':''}><option value="">选择一只宠物</option>${pets.map(pet=>`<option value="${pet.id}" ${p?.id===pet.id?'selected':''}>${esc(pet.name)} · ${esc(pet.species)}</option>`).join('')}</select></label>
    ${p?`<div class="observation-target">${photo(p,'avatar')}<div><strong>${esc(p.name)}</strong><small>本次资料只归入它的档案</small></div>${!busy?button('查看档案','agent','text-button',p.id):''}</div>`:''}
    <div class="voice-intro"><h1>新发现，<br>说出来就记住。</h1><p>它爱吃什么、喜欢怎么玩，<br>最近肠胃怎么样，都可以直接说。</p></div>
    <button id="observation-hold" class="hold-to-talk ${observationHold?'recording':''}" ${!p||observationBusy?'disabled':''} aria-label="长按说话，松开自动归档">${icon('mic')}<span>${observationBusy?'正在整理归档…':observationHold?'松开归档':result?'继续按住补充':'按住说话，松开归档'}</span></button>
    <p class="footnote centered">自动分辨内容、关联时间并归档，无需分类填表。<br>也可聚焦按钮，按住空格说话。</p>
    ${!busy?`<div class="voice-secondary">${button('不方便说话？写一句','observation-text','text-button','',''+(!p?'disabled':''))}${button('使用预设口述','observation-sample','text-button','',''+(!p?'disabled':''))}</div>`:''}
    ${observationEditing&&!busy?`<form id="observation-text-form" class="form-stack"><label>${result?.batchId?'更正刚才那条原话':'说说新观察'}<textarea name="text" required rows="3" maxlength="1000" placeholder="不用分类，像平常说话一样写下来">${esc(result?.originalText||'')}</textarea></label><button class="button primary full">整理并归档</button></form>`:''}
    ${result?`<section class="observation-result" aria-live="polite"><div class="result-heading">${icon(result.pending?'clock':'check')}<strong>${result.pending?'录音已保存，等待整理':'已归档到'+esc(p.name)+'的资料库'}</strong></div>${result.pending?'<p>语音转写服务尚未接入。原始录音已保留，不用重新填写，也不会把未识别内容用于 Agent 回答。</p>':`<p>已从原话整理并关联这只宠物，Agent 可以引用以下记录。</p>${result.notes.map(n=>`<div class="observation-result-note"><small>${esc(knowledgeTopics.find(q=>q.key===n.topic)?.label||'观察')} · ${{ongoing:'长期观察',observation:'本次观察',pending:'待核实'}[n.certainty]}</small><p>${esc(n.text)}</p></div>`).join('')}`}<div class="result-actions">${button('查看宠物资料','agent','text-button',p.id)}${result.batchId?button('更正这条','observation-correct','text-button')+button('撤回这条','observation-undo','text-button'):''}</div></section>`:''}
    <p class="footnote centered">当前文字按规则整理；真实录音保留为待整理资料。<br>语音识别与 Agent 服务接入后，沿同一流程自动归档。</p>
  </main>`;
}
async function archiveObservation(text='',petId=captureIntent.petId,replaceBatchId=null) {
  if(observationBusy)return;
  const pet=activePet(state,petId);
  if(!pet||state.role!=='rescue'||stationFor(pet).id!==state.activeStationId)return;
  observationBusy=true;render();
  const media=[];
  try{
    if(capture.media.audioUrl)media.push({type:'audio',...await storeMedia(capture.media.audioUrl)});
    const before=structuredClone(state),observedOn=new Date().toLocaleDateString('sv-SE');
    let batchId,notes=[];
    if(text.trim()){
      batchId=confirmObservation(state,petId,{entries:observationEntries(text),observedOn,dateBasis:'recorded',media,originalText:text,share:true});
      notes=pet.knowledge.filter(n=>n.batchId===batchId);
    }else{
      saveUnprocessedObservation(state,petId,{media,observedOn});
      batchId=pet.observationSources.at(-1).batchId;
    }
    if(replaceBatchId){
      for(const n of pet.knowledge||[])if(n.batchId===replaceBatchId)n.supersededAt=Date.now();
      const source=pet.observationSources.find(n=>n.batchId===replaceBatchId);
      if(source){source.status='corrected';source.replacedBy=batchId;}
    }
    if(!save()){state=before;throw new Error('设备空间不足，尚未归档，请重试。');}
    observationResult={petId,batchId,notes,originalText:text,pending:!text.trim()};
    observationEditing=false;
    await capture.reset();
  }catch(e){toast(e.message||'归档失败，请重试。');}
  finally{observationBusy=false;render();}
}
async function beginObservationHold(event) {
  if(observationHold||observationFinishing||observationBusy||!captureIntent.petId)return;
  event.preventDefault();
  observationPetId=captureIntent.petId;observationHold=true;observationEditing=false;
  if(event.pointerId!==undefined)event.currentTarget?.setPointerCapture?.(event.pointerId);
  await capture.reset();
  if(!observationHold)return;
  await capture.recordVoice();
}
async function finishObservationHold(cancelled=false) {
  if(!observationHold||observationFinishing)return;
  observationFinishing=true;observationHold=false;
  const petId=observationPetId;
  try{
    await capture.stopVoice();
    if(!cancelled&&capture.media.audioUrl&&page.name==='voice'&&captureIntent.kind==='observation'&&captureIntent.petId===petId)await archiveObservation('',petId);
    else if(cancelled)await capture.reset();
  }finally{observationPetId=null;observationFinishing=false;render();}
}
function intakePage() {
  const m=capture.media, filming=m.videoRecorder?.state==='recording';
  const count=draft.photos.length+(m.videoUrl?1:0);
  return `<div class="camera-page"><header class="camera-header">${button(icon('close'),'back','icon-button','','aria-label="退出拍摄"')}<div><strong>${captureIntent.kind==='observation'?'拍下补充观察':captureIntent.kind==='followup'?'拍下今天的近况':'拍下这位新伙伴'}</strong><span>01 拍摄 · 02 语音 · 03 AI 整理</span></div>${button(icon('refresh'),'flip-camera','icon-button','','aria-label="切换前后摄像头" '+(filming||m.cameraPending?'disabled':''))}</header>
    <div class="camera-viewfinder">
      ${m.stream?`<video id="camera-preview" autoplay playsinline muted aria-label="相机实时取景"></video><div class="viewfinder-corners"><i></i><i></i><i></i><i></i></div><span class="camera-live"><i></i> ${filming?'正在录像':'实时取景'}</span>`:`<div class="camera-unavailable"><span class="camera-symbol">${icon('camera')}</span><h1>${m.cameraPending?'正在打开相机':'让镜头认识它'}</h1><p>${esc(m.cameraError||'允许相机权限，直接拍摄照片和视频。')}</p>${!m.cameraPending?button(icon('camera')+' 开启相机','start-camera','button camera-retry'):''}<div class="native-camera-actions"><label>手机拍照<input id="native-photo" type="file" accept="image/*" capture="environment" /></label><label>手机录像<input id="native-video" type="file" accept="video/*" capture="environment" /></label></div></div>`}
      <div class="viewfinder-note"><span>${filming?'<b id="capture-time">00:'+String(m.recordingSeconds).padStart(2,'0')+' / 00:30</b>':captureMode==='photo'?'拍下它的模样，也可以拍已有的纸质记录':'录一小段日常，留住它自然的样子'}</span><small>${filming?'再次点击停止录像':'不用填表，拍完再说说你认识的它'}</small></div>
    </div>
    <div class="camera-controls"><div class="camera-mode">${button('照片','capture-mode',captureMode==='photo'?'selected':'','photo',filming?'disabled':'')}${button('视频','capture-mode',captureMode==='video'?'selected':'','video',filming?'disabled':'')}</div>
    <div class="shutter-row"><label class="gallery-control">${icon('inbox')}<span>相册</span><input id="photo-upload" type="file" accept="image/*,video/*" multiple ${filming?'disabled':''} /></label>${button('<span></span>','shutter',`shutter ${captureMode==='video'?'video-mode':''} ${filming?'recording':''}`,'',`aria-label="${filming?'停止录像':captureMode==='video'?'开始录像':'拍照'}" ${!m.stream||m.cameraPending?'disabled':''}`)}<div class="capture-count"><strong>${String(count).padStart(2,'0')}</strong><span>已拍素材</span></div></div>
    ${count?`<div class="capture-tray" aria-label="已拍素材">${draft.photos.map((src,index)=>`<div class="capture-thumb"><button data-action="preview-photo" data-value="${index}" aria-label="预览照片 ${index+1}"><img src="${esc(src)}" alt="已拍照片 ${index+1}" /></button>${button('×','remove-photo','remove-capture',String(index),'aria-label="删除照片 '+(index+1)+'" '+(filming?'disabled':''))}</div>`).join('')}${m.videoUrl?`<div class="capture-thumb video-thumb">${button(icon('play')+' 视频','preview-video','video-thumbnail')}${button('×','remove-video','remove-capture','','aria-label="删除视频" '+(filming?'disabled':''))}</div>`:''}</div>`:''}
    ${button('拍好了，介绍一下它 '+icon('arrow'),'to-voice','button primary full','',!count||filming?'disabled':'')}
    <div class="camera-footer"><span>照片最多 5 张 · 视频 1 段</span>${button('使用预设素材','sample-intake','text-button','',''+(filming?'disabled':''))}</div></div></div>`;
}
function voicePage() {
  if(captureIntent.kind==='observation')return observationPage();
  const m=capture.media,recording=m.voiceRecorder?.state==='recording';
  const feedback=captureIntent.kind==='followup',supplement=captureIntent.kind==='observation';
  const ready=!!m.audioUrl||!!draft.description.trim()||(feedback&&(draft.photos.length||m.videoUrl));
  return `${topbar(supplement?'补充'+esc(activePet(state,captureIntent.petId)?.name)+'的资料':feedback?'说说你们今天怎么样':'说说你认识的它',supplement?'01 说新观察 · 02 核对 · 03 同步资料库':feedback?'语音记录 · 到家第 '+captureIntent.day+' 天':'02 语音介绍 · 不用再填一张表')}<main class="main voice-page"><div class="voice-materials"><div class="stacked-photos">${draft.photos.slice(0,3).map(src=>`<img src="${esc(src)}" alt="已拍素材" />`).join('')||icon('camera')}</div><div><strong>${draft.photos.length||m.videoUrl?'画面已经准备好了':'也可以拍下今天的模样'}</strong><p>${draft.photos.length} 张照片${m.videoUrl?' · 1 段视频':''}，接下来只要说一说。</p></div>${button('补拍','resume-camera','text-button')}</div>
    <div class="voice-intro"><p class="eyebrow">${feedback?'LITTLE MOMENTS, TOGETHER':'YOU KNOW THEM BEST'}</p><h1>${supplement?'今天发现了<br>什么新习惯？':feedback?'拍下日常，<br>说说今天。':'就像向朋友<br>介绍它一样。'}</h1><p>${supplement?'比如喜欢怎样玩、吃什么，<br>最近肠胃表现如何，观察了多久。':feedback?'吃得怎么样，有没有开始探索新家？<br>把观察和担心，像聊天一样说出来。':'知道多少，就说多少。<br>名字、年龄、性格和照护情况，交给 AI 整理。'}</p></div>
    <div class="voice-hints">${(supplement?['生活习惯','喜欢什么','饮食照护','肠胃观察','发现时间']:feedback?['吃饭喝水','活动状态','亲近互动','想问的问题']:['叫什么','大概多大','什么性格','健康记录','相处习惯']).map(t=>`<span>${t}</span>`).join('')}</div>
    <div class="voice-recorder ${recording?'is-recording':''}"><div class="voice-rings"></div>${button(icon(recording?'stop':'mic'),'record',`voice-mic ${recording?'recording':''}`,'',`aria-label="${recording?'结束语音介绍':m.audioUrl?'重新录制语音':'开始语音介绍'}" ${m.voicePending?'disabled':''}`)}<strong id="voice-time">${recording?'00:'+String(m.audioSeconds).padStart(2,'0'):m.voicePending?'正在打开麦克风…':m.audioUrl?'已录好 '+m.audioSeconds+' 秒':'点击开始说话'}</strong><p>${recording?'再点一次结束 · 最长 60 秒':m.audioUrl?'可以先听一遍，也可以重新录制。':'不必组织措辞，像平常聊天就好。'}</p></div>
    ${m.audioUrl?`<audio controls src="${m.audioUrl}" class="audio-preview" aria-label="回听语音介绍"></audio>`:''}
    ${draft.description?`<div class="voice-transcript"><span>${draft.sample?'预设口述转写':'文字补充'}</span><p>${esc(draft.description)}</p></div>`:''}
    ${textFallback?`<label class="text-fallback">不方便说话，也可以写下来<textarea id="draft-description" rows="3" maxlength="1000" placeholder="它叫…，平时喜欢…">${esc(draft.description)}</textarea></label>`:''}
    <div class="voice-secondary">${button(textFallback?'收起文字补充':'不方便说话？打字补充','toggle-text','text-button','',''+(recording?'disabled':''))}${button('体验预设口述','sample-voice','text-button','',''+(recording?'disabled':''))}</div>
    ${button((supplement?'整理补充，核对变化 ':feedback?'整理今天的记录 ':'交给 AI，生成档案 ')+icon('spark'),'analyze-intake','button primary full','',!ready||recording||m.voicePending?'disabled':'')}
    <p class="footnote centered">Demo：图片文字（OCR）、视频理解与语音转写为流程模拟。真实素材不会上传；无法识别的信息留待确认。</p></main>`;
}
function analyzingPage() {
  const feedback=captureIntent.kind==='followup',supplement=captureIntent.kind==='observation';
  const steps=['整理照片与视频素材','图片文字（OCR）与外观识别','整理语音介绍与行为线索',supplement?'整理补充内容，保留已有档案':feedback?'合并成一条待确认的到家记录':'合并信息，生成待确认档案'];
  return `${topbar('让 AI 来整理',supplement?'补充观察 · 核对后进入资料库':feedback?'到家记录 · 确认后再同步':'03 生成档案')}<main class="main analysis-page"><div class="analysis-orbit">${icon('spark')}</div><p class="eyebrow">LEAVE THE REST TO AI</p><h1>${feedback?'你负责陪伴，<br>我负责记下来。':'你负责认识它，<br>我负责记下来。'}</h1><p>把镜头里的模样，和你说的故事，<br>整理成一份可以确认的${feedback?'记录':'档案'}。</p><div class="analysis-steps">${steps.map((s,i)=>`<div class="${i<analysisStep?'done':i===analysisStep?'current':''}">${icon(i<analysisStep?'check':i===analysisStep?'spark':'clock')}<span>${s}</span><small>${i<analysisStep?'已演示':i===analysisStep?'演示中':'等待'}</small></div>`).join('')}</div><p class="footnote">当前未调用真实 OCR、视觉模型或语音转写服务。仅预设口述与主动补充的文字参与规则整理。</p></main>`;
}
function renderMedia(items=[]) {
  return `<div class="checkin-media">${items.map(m=>m.type==='photo'?`<img src="${esc(m.src)}" alt="用户提交的观察照片" />`:`<${m.type} controls ${m.type==='video'?'playsinline':''} ${m.src?`src="${esc(m.src)}"`:`data-media-id="${esc(m.id)}"`} aria-label="${m.type==='video'?'用户拍摄的视频':'用户的语音反馈'}"></${m.type}>`).join('')}</div>`;
}
async function hydrateMedia() {
  for(const el of document.querySelectorAll('[data-media-id]')) {
    try {const url=await mediaUrl(el.dataset.mediaId);if(el.isConnected&&url)el.src=url;else if(el.isConnected)el.outerHTML='<p class="footnote">本地素材已不可用，请重新录入。</p>';}
    catch {if(el.isConnected)el.outerHTML='<p class="footnote">无法读取本地素材，请在原浏览器重试。</p>';}
  }
}
function feedbackReviewPage() {
  if(!pendingFeedback)return `${topbar('确认到家记录')}<main class="main">${empty('还没有准备好记录','返回到家日记，拍一拍、说一说。')}</main>`;
  const m=capture.media;
  const items=[...draft.photos.map(src=>({type:'photo',src})),...(m.videoUrl?[{type:'video',src:m.videoUrl}]:[]),...(m.audioUrl?[{type:'audio',src:m.audioUrl}]:[])];
  return `${topbar('确认这条到家记录','第 '+pendingFeedback.day+' 天 · 确认后救助者可见')}<main class="main"><div class="feedback-review-intro">${icon('book')}<h1>今天的故事，在这里。</h1><p>照片、视频和语音会一起保存，<br>先看一眼，再分享给救助者。</p></div>${renderMedia(items)}<div class="review-note"><strong>${draft.sample?'预设口述整理':'根据你提交的内容'}</strong>${esc(pendingFeedback.text)}</div><p class="footnote">${m.audioUrl&&!draft.description?'真实录音尚未转写，提交后需要救助者听取。不会据此自动判断动物正常。':'AI 整理为规则模拟，健康或适应问题仍需人工确认。'}</p>${button('确认同步给救助者 '+icon('arrow'),'submit-checkin','button primary full')}${button('返回补充','return-voice','button secondary full spaced')}</main>`;
}
function confirmPage() {
  const p=activePet(state,page.id);if(!p)return '';
  const fields=[['name','名字'],['species','品类'],['age','年龄'],['coat','外观与花纹'],['character','性格观察'],['health','已有健康记录'],['unknown','待确认信息'],['needs','照护与领养要求']];
  return `${topbar('确认动物档案','看一眼，再帮它开启新的相遇')}<main class="main"><div class="step-label"><span>01 拍摄</span><i></i><span>02 语音</span><i></i><span class="current">03 确认</span></div><div class="mini-pet-card">${photo(p,'avatar')}<div><h2>${esc(p.name)}的档案草稿</h2><p>资料先整理好，有不对的地方再改。</p></div></div>
    ${!confirmEditing?`<div class="facts-card">${fields.map(([key,label])=>`<div><span>${label}</span><p>${esc(p[key]||'待确认')}</p></div>`).join('')}</div>${button(icon('edit')+' 有信息要修改','edit-confirm','button secondary full')}`:''}
    <form id="confirm-form" class="form-stack spaced" data-id="${p.id}">
    <div class="form-stack" ${!confirmEditing?'hidden style="display:none"':''}>${fields.map(([key,label])=>key==='species'?`<label>品类<select name="species">${['待确认','猫','狗'].map(v=>`<option ${p.species===v?'selected':''}>${v}</option>`).join('')}</select></label>`:key==='name'||key==='age'||key==='coat'?`<label>${label}<input name="${key}" ${key==='name'?'required':''} maxlength="${key==='name'?20:40}" value="${esc(p[key])}" /></label>`:`<label>${label}<textarea name="${key}" rows="2" maxlength="300">${esc(p[key])}</textarea></label>`).join('')}</div>
    <div class="info-box">${icon('shield')}<p>当前 AI/OCR 为模拟，未识别的事实保留待确认。确认后发布档案，再启用 Agent。</p></div><button class="button primary full" type="submit">确认档案，预览 Agent ${icon('spark')}</button></form>
    ${p.intakeMedia?.length?`${sectionHeading('ORIGINAL MOMENTS','刚刚拍的、说的')}${renderMedia(p.intakeMedia)}`:''}</main>`;
}
function agentPage() {
  const p=activePet(state,page.id);if(!p)return '';
  return `${topbar(`${esc(p.name)}的专属 Agent`,'档案稳定，表达可以有自己的个性')}<main class="main"><div class="agent-identity">${photo(p,'large-avatar')}<p class="eyebrow">A PERSONAL LITTLE AGENT</p><h1>你好，我是${esc(p.name)}。</h1><p>${esc(p.mood)}</p>${statusPill(p)}</div><div class="agent-balance"><div><b>70<span>%</span></b><strong>真实档案与角色底线</strong></div><div><b>30<span>%</span></b><strong>表达方式与创意空间</strong></div></div><p class="footnote">设计原则示意，非精确模型参数。真实信息不随匹配效果改变。</p>
    ${p.agentVoice?`<div class="case-note"><span>${esc(p.persona)} · 表达设定</span><p>${esc(p.agentVoice)}</p></div>`:''}${sectionHeading('MY VOICE','它会这样介绍自己')}<form id="agent-form" class="form-stack" data-id="${p.id}"><label>个性签名<input name="mood" required maxlength="80" value="${esc(p.mood)}" /></label><label>自我介绍<textarea name="intro" required rows="3" maxlength="500">${esc(p.intro)}</textarea></label><button class="button secondary full" type="submit">保存表达设定</button></form>
    <div class="spaced">${button(icon('play')+' 预览形象短片','film','button secondary full',p.id)}</div><div class="menu-card spaced">${menu('home','所属救助站',esc(stationFor(p).name),'station',stationFor(p).id)}${menu('edit','查看与补充宠物资料','语音补充习惯、喜好与照护观察','agent',p.id)}${menu('spark','查看匹配复盘','对象选择与表达如何调整','reviews',p.id)}</div>
    <div class="status-controls">${button(p.active?'暂停 Agent 主动匹配':'确认并启用 Agent','toggle-agent',`button ${p.active?'secondary':'primary'} full`,p.id,p.status==='adopted'?'disabled':'')}${p.status!=='adopted'?button(p.status==='paused'?'恢复开放领养':'暂停开放领养','toggle-status','text-button',p.id):'<p class="footnote">已领养：停止新的领养招呼，保留到家支持。</p>'}</div>
  </main>`;
}
function applicationPage() {
  const a=state.applications.find(a=>a.id===page.id);
  if(!a)return `${topbar('领养申请')}<main class="main">${empty('还没有申请','切换用户端，完成聊天并提交一份申请。')}</main>`;
  const p=activePet(state,a.petId);
  if(state.role!=='rescue'||stationFor(p).id!==state.activeStationId)return `${topbar('领养申请')}<main class="main">${empty('仅负责站点可查看申请资料','可以通过领养者主页了解公开的领养记录。')}</main>`;
  const adopter=publicProfile(state,a.adopterId);
  const profileEntry=a.adopterId?`<button class="adopter-entry" data-action="public-profile" data-value="${esc(a.adopterId)}"><span class="human-avatar">${esc(adopter.nickname[0])}</span><span><strong>${esc(adopter.nickname)}<small>领养者</small></strong><span>查看个人主页 · 当前申请与历史评价</span></span>${icon('chevron')}</button>`:'<p class="footnote">此旧申请尚未绑定领养账号。</p>';
  return `${topbar('处理领养申请','最终由救助者与领养人共同确认')}<main class="main"><div class="mini-pet-card">${photo(p,'avatar')}<div><h2>${esc(a.name)}想认识${esc(p.name)}</h2><p>${a.stage<0?'已结束':stages[a.stage]}</p></div></div>${profileEntry}<div class="facts-card"><div><span>所在城市</span><p>${esc(a.city)}</p></div><div><span>手机号</span><p>${esc(a.phone||'未填写')}</p></div><div><span>微信号</span><p>${esc(a.wechat||'未填写')}</p></div><div><span>邮箱</span><p>${esc(a.email||(/@/.test(a.contact||'')?a.contact:'')||'未填写')}</p></div>${a.contact&&!/@/.test(a.contact)?`<div><span>原联系方式</span><p>${esc(a.contact)}</p></div>`:''}<div><span>照护条件</span><p>${esc(a.conditions)}</p></div><div><span>用户问题</span><p>${esc(a.questions||'暂无补充')}</p></div><div><span>需要确认</span><p>${esc(p.needs)}；${esc(p.unknown)}</p></div></div>${sectionHeading('THE PERSON BEHIND THE APPLICATION','生活画像与个人申请信息')}<div class="facts-card">${lifestyleQuestions.map(q=>`<div><span>${esc(q.label)}</span><div><p>${esc(a.applicantProfile?.answers?.[q.key]?.text||'本次申请未提供')}</p>${a.applicantProfile?.answers?.[q.key]?.audio?renderMedia([a.applicantProfile.answers[q.key].audio]):''}</div></div>`).join('')}<div><span>偏好与生活条件</span><p>${esc(a.applicantProfile?.memory||'本次申请未提供')}</p></div></div><div class="info-box">${icon('shield')}<p>以上为领养者提交时确认的资料，包括生活画像与偏好；后续修改个人画像不改写这份申请。身份材料不在此公开。请结合沟通和实际见面判断。</p></div><div class="timeline">${stages.map((s,i)=>`<div class="${a.stage>=i?'done':''}"><span>${i+1}</span><p>${s}</p></div>`).join('')}</div>${a.stage>=0&&a.stage<3?`${button(['通过初审，进入见面','确认见面结果，准备交接','双方已确认，完成交接'][a.stage],'advance','button primary full',a.id)}${button('暂不匹配，结束申请','reject','button secondary full spaced',a.id)}`:a.stage===3?button('查看到家跟进','followup','button primary full',p.id):''}</main>`;
}
const requestKindLabels={photo:'照片',video:'视频',audio:'语音',any:'照片 / 视频 / 语音'};
function household(petId){return state.applications.find(a=>a.petId===petId&&a.stage===3);}
function requestsView(petId) {
  const rescue=state.role==='rescue';
  const requests=(state.followupRequests||[]).filter(r=>(!petId||r.petId===petId)&&(rescue?r.stationId===state.activeStationId:r.adopterId===state.account?.id)).slice().reverse();
  return requests.length?`<section class="followup-requests"><h3>${rescue?'回访要求与回复进度':'救助站的回访邀请'}</h3>${requests.map(r=>`<article class="request-card"><header><strong>${esc(activePet(state,r.petId)?.name)} · ${requestKindLabels[r.kind]}</strong><span>${r.status==='pending'?'待领养者回复':state.followups.find(f=>f.id===r.feedbackId)?.resolved?'已查看并回复':'已提交 · 待站点查看'}</span></header><p>${esc(r.message)}</p><small>${esc(stationById(r.stationId)?.name)} · 希望 ${new Date(r.dueAt).toLocaleDateString('zh-CN')} 前反馈</small>${!rescue&&r.status==='pending'?button('拍摄或语音回复','respond-request','button primary full',r.id):rescue&&r.status==='submitted'?button('查看回访记录','followup','text-button',r.petId):''}</article>`).join('')}</section>`:'';
}
function trackingPage() {
  const adopted=stationPets(state,state.activeStationId).filter(p=>p.status==='adopted');
  return `${topbar('领养后的每一天','家庭、近况和回访，一起跟进',false)}<main class="main"><div class="page-title"><p class="eyebrow">LIFE, TOGETHER</p><h1>家的新日常。</h1><p>知道它和谁一起生活，也知道下一次该问候什么。</p></div>${adopted.length?adopted.map(p=>{
    const a=household(p.id),latest=state.followups.filter(f=>f.petId===p.id&&(!a||f.adopterId===a.adopterId)).at(-1);
    const pending=state.followupRequests.some(r=>r.applicationId===a?.id&&r.status==='pending');
    return `<article class="tracking-card"><button class="tracking-open" data-action="followup" data-value="${p.id}"><div class="mini-pet-card">${photo(p,'avatar')}<div><h2>${esc(p.name)} · 到家第 ${adoptionDay(state,p.id)} 天</h2><p>最后反馈：${latest?'第 '+latest.day+' 天':'暂无'}</p></div>${icon('chevron')}</div></button>
    <div class="tracking-adopter"><span class="human-avatar">${esc((a?.name||'待')[0])}</span><div><small>领养人</small><strong>${esc(a?.name||'账号待关联')}</strong></div>${a?.adopterId?button('个人主页 '+icon('chevron'),'public-profile','text-button',a.adopterId):''}</div>
    <span class="tracking-status ${latest?.attention&&!latest.resolved?'attention':''}">${!latest?'暂未反馈':latest.attention&&!latest.resolved?'需要人工关注':latest.resolved?'已回复处理':'已收到反馈'}</span><p>${esc(latest?.summary||'尚未收到近况，可主动邀请领养者记录。')}</p>
    <div class="tracking-actions">${button('查看并回复','followup','button secondary',p.id)}${a?.adopterId?button(pending?'查看待回复要求':'索要照片 / 发起回访',pending?'followup':'request-followup','button primary',pending?p.id:a.id):''}</div></article>`;
  }).join(''):empty('等待第一位到家的伙伴','完成交接后，会在这里建立持续记录。',button('查看领养申请','applications','button secondary'))}</main>`;
}
function followupPage() {
  const p=activePet(state,page.id);if(!p)return '';
  const rescue=state.role==='rescue',day=adoptionDay(state,p.id);
  if(!rescue&&!currentApplication(p.id))return `${topbar('到家日记')}<main class="main">${empty('这是另一个家庭的私密回访','只有领养该动物的账号和所属站点可以在演示中查看。',button('查看所属站点','station','button secondary',stationFor(p).id))}</main>`;
  if(rescue&&stationFor(p).id!==state.activeStationId)return `${topbar('到家日记')}<main class="main">${empty('仅负责站点可查看私密回访','请返回所属站点的跟进列表。')}</main>`;
  const a=household(p.id);
  const records=state.followups.filter(f=>f.petId===p.id);
  const tips=day===1?['给它一个安静、安全的休息空间。','按救助者交接的习惯安排照护，先观察再调整。','记录你看到的情况；不确定时联系救助者。']:day===3?['回看这几天的观察，留意变化。','尊重它的距离，按实际反应慢慢互动。','把还没有解决的问题反馈给救助者。']:['一起回顾这一周的适应过程。','确认仍需要支持的事项，逐步建立日常节奏。','稳定后减少打扰，保留随时反馈的入口。'];
  return `${topbar(`${esc(p.name)}的到家日记`,rescue?'救助者视角 · 仅基于用户主动反馈':'慢慢适应，也慢慢成为家人')}<main class="main">
    ${rescue&&a?`<div class="tracking-adopter"><span class="human-avatar">${esc((a.name||'领')[0])}</span><div><small>领养人</small><strong>${esc(a.name)}</strong></div>${button('查看个人主页','public-profile','text-button',a.adopterId)}</div>${!state.followupRequests.some(r=>r.applicationId===a.id&&r.status==='pending')?button('索要照片 / 发起回访','request-followup','button primary full',a.id):''}`:''}
    ${requestsView(p.id)}
    ${rescue?`<p class="footnote spaced">到家第 ${day} 天 · ${records.filter(f=>!f.resolved).length} 条待回复</p>`:`<div class="day-card"><div><p class="eyebrow">OUR DAYS TOGETHER</p><h1>第 <b>${day.toString().padStart(2,'0')}</b> 天</h1><p>${day===1?'新家的第一声你好。':day===3?'一点一点，靠近彼此。':'让陪伴，成为日常。'}</p></div>${photo(p)}</div>`}
    ${!rescue?`<div class="checkin-entry"><h3>今天，它和你怎么样？</h3><p>拍下一个日常片段，再说说你的观察。<br>不用填表，整理好后再一起同步给救助者。</p>${button(icon('camera')+' 拍一拍，说说今天','start-checkin','button primary full',p.id)}${button(icon('mic')+' 直接语音记录','voice-checkin','text-button',p.id)}</div>
      <div class="guidance-card"><h3>${icon('book')} 今天，一起留意这些</h3>${tips.map(t=>`<p>${icon('check')} ${t}</p>`).join('')}<small>照护提示，不提供诊断；健康异常请及时联系兽医。</small></div>`:''}
    ${sectionHeading('LITTLE MOMENTS','已记录的日常')}
    <div class="feedback-list">${records.length?records.slice().reverse().sort((a,b)=>rescue?Number(a.resolved)-Number(b.resolved):0).map(f=>`${rescue&&f.resolved?'<details class="rescue-details"><summary>已处理 · 第 '+f.day+' 天的反馈</summary>':''}<article class="feedback-card"><div><span>DAY ${String(f.day).padStart(2,'0')}</span><small>${f.attention&&!f.resolved?'需要人工关注':f.resolved?'已回复':'已反馈'}</small></div><p>${esc(f.text)}</p>${renderMedia(f.media)}<p class="publication-status">${f.publication?.allowed?'本条素材已授权展示到个人主页':'仅发给站点 · 未展示到个人主页'}${!rescue&&f.publication?.allowed?button('撤下展示','unpublish-moment','text-button',f.id):''}</p><blockquote>${esc(f.summary)}</blockquote>${f.reply?`<div class="rescue-reply"><strong>救助者回复</strong><p>${esc(f.reply)}</p></div>`:''}${rescue&&!f.resolved?`<form class="reply-form" data-feedback="${f.id}"><label class="sr-only" for="reply-${f.id}">回复反馈</label><textarea id="reply-${f.id}" name="reply" required maxlength="500" placeholder="回复用户，记录下一步安排…"></textarea><button class="button secondary full" type="submit">回复并标记已处理</button></form>`:''}</article>${rescue&&f.resolved?'</details>':''}` ).join(''):empty('还没有反馈','最后反馈：暂无。系统无法自动感知动物状态。')}</div></main>`;
}
function renderOverlay() {
  if(!overlay) {overlayRoot.innerHTML=''; document.body.classList.remove('modal-open');return;}
  document.body.classList.add('modal-open');
  let title='',body='';
  if(overlay.type==='example-scenes'){
    title='领养者场景示例';body=`<p class="modal-intro">宠物、人物和记录均为虚构示例，配图用于展示。聊天采用预设回应，操作只保存在当前标签页，不会提交真实申请。</p><div class="example-scene-grid">${exampleScenes.map(([id,title,desc,petId])=>`<button data-action="example-scene" data-value="${id}"><img src="${esc(state.pets.find(p=>p.id===petId)?.image||'./assets/orange.jpg')}" alt=""><span><strong>${title}</strong><small>${desc}</small></span>${icon('chevron')}</button>`).join('')}</div>${button('重置本页示例记录','example-reset','text-button full spaced')}<a class="button secondary full" href="./">返回正式界面</a>`;
  } else if(overlay.type==='registration-gate'){title='请先注册，继续认识它';body=`<p class="modal-intro">建立你的账号，保存喜欢的小伙伴、和它的 AI 分身聊天，也让救助站了解你的照护安排。</p><div class="logout-actions">${button('再逛逛','close-modal','button secondary')}${button('前往注册','register','button primary')}</div>${button('已有账号，去登录','adopter-login','text-button full spaced')}`;
  } else if(overlay.type==='pet-share') {
    const p=state.pets.find(p=>p.id===overlay.id);title='分享'+(p?.name||'宠物档案');
    body=p?`<p class="modal-intro">复制下面的链接，让朋友也来认识它。</p><input class="share-link" aria-label="宠物分享链接" readonly value="${esc(petShareData(p).url)}" onclick="this.select()">${button('完成','close-modal','button secondary full spaced')}`:'';
  } else if(overlay.type==='identity') {
    title='切换身份';
    body=`<p class="modal-intro">选择你在这里的身份</p><div class="identity-options"><button class="identity-option selected" data-action="identity-adopter"><span class="identity-symbol">${icon('user')}</span><span><strong>领养者</strong><small>认识小伙伴，寻找适合的陪伴</small></span><span class="identity-current">当前</span></button><a class="identity-option" href="?mode=online&role=station"><span class="identity-symbol station">${icon('home')}</span><span><strong>救助站</strong><small>登录站点账号，管理宠物与资料</small></span>${icon('chevron')}</a></div>`;
  } else if(overlay.type==='logout') {
    title=exampleMode?'退出示例体验？':'退出当前账号？';
    body=`<p class="modal-intro">${exampleMode?'返回正式领养者界面，真实账号登录状态保持不变。':'退出后将返回未登录的领养者界面，账号与已确认的生活画像保存在服务器，退出后本页不再显示个人资料。'}</p><div class="logout-actions">${button('取消','close-modal','button secondary')}${button('确认退出','confirm-logout','button primary')}</div>`;
  } else if(overlay.type==='request-followup') {
    const a=state.applications.find(a=>a.id===overlay.id&&a.stage===3),pet=a&&activePet(state,a.petId);
    title='发起一次回访';
    body=!a||state.role!=='rescue'||stationFor(pet).id!==state.activeStationId?'<p>这份领养暂不能发起回访。</p>':`<p class="modal-intro">邀请 ${esc(a.name)} 记录 ${esc(pet.name)} 的近况</p><form id="followup-request-form" data-application="${a.id}" class="form-stack"><label>希望收到<select name="kind"><option value="photo">照片</option><option value="video">视频</option><option value="audio">语音</option><option value="any">照片、视频或语音均可</option></select></label><label>想了解什么<textarea name="message" required maxlength="300" rows="3">想看看最近的生活状态，请拍一张近照，再说说饮食、活动和适应情况。</textarea></label><label>希望多久内反馈<select name="dueDays"><option value="3">3 天内</option><option value="1">1 天内</option><option value="7">7 天内</option></select></label><p class="footnote">当前仅支持站内请求，短信和微信通知尚未接入。回访素材默认仅站点可见，主页展示仍需领养者另行授权。</p><p class="form-error" role="alert"></p><button class="button primary full" type="submit">发送回访邀请</button></form>`;
  } else if(overlay.type==='share-checkin') {
    title='这段日常，想分享给谁？';
    body=`<div class="share-privacy">${icon('shield')}<div><strong>默认只交给负责的救助站</strong><p>发送给站点不等于公开。下面的授权只对这一次记录生效。</p></div></div><div class="share-preview"><h3>本次素材</h3><p>${draft.photos.length} 张照片 · ${capture.media.videoUrl?'1 段视频':'无视频'} · ${capture.media.audioUrl?'1 段语音':'无语音'}</p><p>主页配文固定为「一起生活的小片段」。回访描述、AI 整理结果、联系方式和站点回复不会公开。</p><small>若选择展示，原始照片、视频与声音也会展示。请先检查是否含人脸、住址或其他不想公开的内容；可以返回修改。</small></div>${button('仅发给站点','send-private','button primary full')}${button('同时展示到个人主页','send-public','button secondary full spaced')}${button('返回检查素材','close-modal','text-button full spaced')}<p class="footnote">之后可在个人主页撤下展示，站点回访记录仍保留。</p>`;
  } else if(overlay.type==='location') {
    title='在哪里遇见？';
    const stations=[...new Map(state.pets.map(p=>[p.stationId,stationFor(p)])).values()].map(s=>({...s,distance:distanceKm(state.location,s)})).filter(s=>Number.isFinite(s.distance)&&s.distance<=state.radius).sort((a,b)=>a.distance-b.distance);
      body=`<p class="modal-intro">当前：${esc(state.location.label)} · ${state.location.source==='live'?'设备定位':state.location.source==='manual'?'手动选择':'默认城市，可更改'}</p>${button(icon('pin')+(locating?' 正在定位…':' 使用我的当前位置'),'locate','button primary full','',locating?'disabled':'')}<p class="footnote">定位只在本浏览器用于距离计算，不上传服务器。站点位置尚未完成实地核验。</p>${locationError?`<p class="location-error" role="status">${esc(locationError)}</p>`:''}<form id="location-form" class="form-stack"><div class="form-row"><label>也可以选择城市<select name="city">${Object.keys(cityLocations).map(city=>`<option ${state.location.label===city?'selected':''}>${city}</option>`).join('')}</select></label><label>附近范围<select name="radius">${[5,20,50,300].map(r=>`<option value="${r}" ${state.radius===r?'selected':''}>${r} km</option>`).join('')}</select></label></div><button class="button secondary full" type="submit">使用这个位置与范围</button></form>${catalogBusy||catalogError?catalogStatusView():`${sectionHeading('AROUND YOU',stations.length+' 家附近站点')}<div class="nearby-stations">${stations.length?stations.map(s=>`<article><span class="station-icon">${icon('home')}</span><div><strong>${esc(s.name)}</strong><p>${esc(s.city)} · ${esc(s.area)} · ${state.pets.filter(p=>stationFor(p).id===s.id&&p.status==='available'&&p.active).length} 位待领养伙伴</p></div><div class="nearby-station-actions"><small>约 ${distanceLabel(s.distance)}</small>${button('查看主页','station','text-button',s.id)}</div></article>`).join(''):'<p class="body-copy">附近暂无站点，可扩大范围或切换「随缘遇见」。</p>'}</div>`}`;
  } else if(overlay.type==='chat-options') {
    const p=activePet(state,overlay.id),muted=state.muted.includes(p.id);
    title='与'+p.name+'的对话';
    body=`<div class="mini-pet-card">${photo(p,'avatar')}<div><h2>${esc(p.name)}的 AI 分身</h2><p>消息设置只影响这位小伙伴。</p></div></div><div class="menu-card">${menu('paw','查看它的真实档案','照片、观察记录与照护需求','profile',p.id)}${menu('chat',muted?'恢复主动联系':'暂停主动联系',muted?'恢复后仍遵循你的全局招呼设置':'暂停后你仍然可以主动和它聊天','mute',p.id)}</div><p class="footnote">你的偏好统一放在「我的 → 我的偏好与记忆」。聊天记住新偏好时，也会在原消息旁提示。</p>`;
  } else if(overlay.type==='capture-photo') {
    title='查看照片';body=`<div class="media-detail"><img src="${esc(draft.photos[Number(overlay.id)])}" alt="已拍照片" /></div><p class="footnote">保留原始宽高比。可以返回继续补拍。</p>`;
  } else if(overlay.type==='capture-video') {
    title='查看视频';body=`<div class="media-detail"><video src="${esc(capture.media.videoUrl)}" controls playsinline></video></div>`;
  } else if(overlay.type==='demo') {
    title='设置';
    const adopted=state.pets.find(p=>p.status==='adopted');
    body=`<p class="modal-intro">切换视角，走完从相遇到回家的故事。</p><p class="field-caption">切换角色</p><div class="segmented">${button('领养人','role',state.role==='user'?'active':'','user')}${button('救助者','role',state.role==='rescue'?'active':'','rescue')}</div><form id="station-switch-form" class="form-stack spaced"><label>已开通站点<select name="stationId">${['warm','garden','sun'].map(id=>`<option value="${id}" ${state.activeStationId===id?'selected':''}>${esc(stationById(id).name)}</option>`).join('')}</select></label><button class="button secondary full" type="submit">预览此站工作台</button></form><div class="demo-control-list">${storyMode?menu('back','返回我的记录','退出当前体验场景','exit-story'):''}${menu('user','新用户注册','创建领养账号，并与 Agent 完成生活画像','new-registration')}${menu('book','切换体验场景','预置聊天、申请、回访与评价 · 保留原记录','stories')}${menu('spark','触发下一封招呼','遵循主动消息开关与当前偏好','next-greeting')}${menu('book','演示未回复后的复盘','橘子将寻找下一位用户','demo-review')}${menu('clock','推进到家时间',adopted?`当前第 ${state.day} 天，推进至下一节点`:'完成交接后解锁','next-day')}${menu('refresh','重置体验','清除本 Demo 的本地数据，从头开始','reset')}</div><div class="demo-capabilities"><strong>功能接入状态</strong><p>界面与状态可操作；对话、档案整理和复盘为规则模拟。短片为预制创意短片。没有向真实用户或救助站发送消息。</p><p>数据只在本浏览器保存；不同设备不会实时同步。</p></div>`;
  } else if(overlay.type==='memory') {
    const m=state.memory.find(m=>m.id===overlay.id);
    title=m?'修改记忆':'补充记忆';
    body=`<form id="memory-form" class="form-stack" data-id="${m?.id||''}"><label>记忆内容<input name="text" required maxlength="120" value="${esc(m?.text||'')}" placeholder="例如：喜欢狸花，偏好安静的性格" /></label><label>类型<select name="type"><option value="preference" ${m?.type==='preference'?'selected':''}>我的偏好</option><option value="condition" ${m?.type==='condition'?'selected':''}>生活条件</option></select></label><button class="button primary full" type="submit">保存记忆</button></form>`;
  } else if(overlay.type==='film') {
    const p=activePet(state,overlay.id);title=`${p.name}的小剧场`;
    body=`<div class="film-preview"><video controls playsinline poster="${esc(p.image)}" src="./assets/pawletter-film.webm" aria-label="纸箱质检日记预制创意短片"></video></div><span class="label-tag">预制创意短片 · 非动物实拍行为</span><h3>今天，我是纸箱质检员。</h3><p class="body-copy">用一段轻松的形象内容，让你记住它。当前共用一段预制演示短片，不代表根据上传素材实时生成。</p><p class="footnote">正式产品可根据每只动物的素材生成个性内容，并由救助者确认后发布。</p>`;
  } else if(overlay.type==='reviews') {
    title='Agent 的匹配笔记';
    const reviews=state.reviews.filter(r=>!overlay.id||r.petId===overlay.id);
    body=reviews.length?reviews.map(r=>`<article class="review-card"><span class="label-tag">匹配复盘 · ${esc(activePet(state,r.petId)?.name)}</span><h3>这一轮，我们学到了什么</h3><p>${esc(r.summary)}</p><strong>下一步</strong><p>${esc(r.next)}</p><div class="candidate-card"><small>下一位匹配对象</small><strong>${esc(r.candidate)}</strong><p>“${esc(r.preview)}”</p><span>已模拟发起新招呼 · 未联系真实用户</span></div></article>`).join(''):empty('还没有复盘记录','在设置触发“未回复”分支，查看对象选择如何变化。');
  } else if(overlay.type==='applications') {
    title='领养申请';
    const applications=state.applications.filter(a=>stationFor(activePet(state,a.petId)).id===state.activeStationId).sort((a,b)=>(a.stage<0?4:a.stage)-(b.stage<0?4:b.stage)||(b.createdAt||0)-(a.createdAt||0));
    body=applications.length?applications.map(a=>{const p=activePet(state,a.petId);return `<button class="animal-row" data-action="application" data-value="${a.id}">${photo(p,'avatar')}<div><strong>${esc(a.name)} → ${esc(p.name)}</strong><small>${a.stage<0?'申请已结束':stages[a.stage]}</small></div>${icon('chevron')}</button>`;}).join(''):empty('暂时没有申请','切换用户端，选择一位小伙伴提交领养意向。');
  } else if(overlay.type==='confirm-reset') {
    title='从第一封来信重新开始？';
    body=`<p class="body-copy">将清除本 Demo 的聊天、记忆、上传档案、申请和回访记录。此操作只影响当前浏览器。</p>${button('确认重置体验','confirm-reset','button primary full')}`;
  }
  overlayRoot.innerHTML=`<div class="modal-backdrop" data-action="dismiss"><section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="sheet-handle"></div><div class="modal-header"><h2 id="modal-title">${title}</h2>${button(icon('close'),'close-modal','icon-button','','aria-label="关闭"')}</div><div class="modal-content">${body}</div></section></div>`;
  requestAnimationFrame(()=>overlayRoot.querySelector('input, .modal-header button')?.focus());
}
function openOverlay(type,id) { overlay={type,id}; renderOverlay(); }
async function openChat(id){
 if(!state.account){registrationGate('chat',id);return;}const p=activePet(state,id);if(!p)return;
 const ticket=++chatEpoch;chatBusy=true;chatError='';navigate('chat',id);
 try{const result=await accountApi.history(id);if(ticket!==chatEpoch||page.id!==id||page.name!=='chat')return;state.messages[id]=result.messages;
  if(!result.messages.length)addMessage(state,id,'pet',`你好，我是${p.name}的 AI 分身。我的回答来自照顾我的人写下的档案，你想先了解哪一面？`);
  state.read[id]=Date.now()+1;save();
 }catch(e){if(ticket===chatEpoch)chatError=e.message;}finally{if(ticket===chatEpoch){chatBusy=false;if(page.name==='chat'&&page.id===id)render();}}
}
async function sendChat(text){
 const p=activePet(state,page.id);if(!p||!text.trim()||chatBusy)return;
 const question=text.trim().slice(0,500),ticket=++chatEpoch,owner=state.account?.id;chatBusy=true;chatError='';addMessage(state,p.id,'user',question);render();
 try{const result=await accountApi.chat(p.id,question);if(ticket!==chatEpoch||owner!==state.account?.id)return;
  mergeMemory(state,extractMemory(question));addMessage(state,p.id,'pet',result.answer,{citations:result.citations});state.read[p.id]=Date.now()+1;save();
 }catch(e){if(ticket===chatEpoch){chatError=e.message+' 可以重新发送这句话。';state.messages[p.id]?.pop();}}
 finally{if(ticket===chatEpoch){chatBusy=false;if(page.name==='chat'&&page.id===p.id)render();}}
}
async function loadCatalog(){
 if(exampleMode){catalogBusy=false;if(initialPetId){const id=initialPetId;initialPetId=null;if(state.pets.some(p=>p.id===id))navigate('profile',id);}render();return;}
 catalogBusy=true;catalogError='';render();
 try{const result=await accountApi.catalog();if(!Array.isArray(result?.pets))throw new Error('Invalid catalog response');catalogRows=result.pets;state.pets=catalogRows.map(cloudPet);if(state.account&&state.consent)greet(state);
  if(initialPetId){const id=initialPetId;initialPetId=null;if(state.pets.some(p=>p.id===id))navigate('profile',id);else toast('这份宠物档案暂未公开或已下架，可以看看其他小伙伴。');}
 }
 catch(e){catalogError=navigator.onLine===false?'offline':e instanceof TypeError?'network':'service';}
 finally{catalogBusy=false;if(['meet','messages','mine','station','stations'].includes(page.name))render();}
}
function cloudStationPage(id){
 const catalogStatus=catalogStatusView();
 if(catalogStatus)return `${topbar(id?'救助站':'认识救助站','从它的长期档案，认识照顾它的人')}<main class="main">${catalogStatus}</main>`;
 const rows=id?state.pets.filter(p=>p.stationId===id):state.pets,stations=[...new Map(rows.map(p=>[p.stationId,p.stationRecord])).values()];
 return `${topbar(id?(stations[0]?.name||'救助站'):'认识救助站','从它的长期档案，认识照顾它的人')}<main class="main">${stations.length?stations.map(st=>`<section class="application-profile spaced"><h2>${esc(st.name)}</h2><p>${esc(st.city)}</p>${rows.filter(p=>p.stationId===st.id).map(p=>`<button class="menu-item" data-action="profile" data-value="${p.id}">${photo(p,'avatar')}<span><strong>${esc(p.name)}</strong><small>${esc(p.character)}</small></span>${icon('chevron')}</button>`).join('')}</section>`).join(''):empty('还没有公开的宠物档案','救助者发布档案后，会在这里展示。')}</main>`;
}

async function consent(value) {
 if(!state.account){registrationGate('consent',value);return;}
 try{await accountApi.preferences(value==='on');state.consent=value==='on';const p=state.consent?greet(state):null;save();render();toast(p?`${p.name}给你发来了一封招呼`:state.consent?'已开启主动招呼':'已暂停新的主动招呼');}catch(e){toast(e.message);}
}

document.addEventListener('click',async event=>{
  if(Date.now()<suppressClickUntil){event.preventDefault();return;}
  const target=event.target.closest('[data-action]');if(!target)return;
  const {action,value}=target.dataset;
  if(!state.account&&['follow','chat','apply','swipe-like','consent','memory','progress','ratings','lifestyle','saved'].includes(action)){registrationGate(action,value);return;}
  switch(action) {
    case 'example-scenes':if(exampleMode)openOverlay('example-scenes');break;
    case 'example-reset':if(exampleMode){state=createAdopterExamples();save();navigate('meet');toast('示例已重置，正式资料未改变。');}break;
    case 'example-scene':{
      if(!exampleMode)break;const scene=exampleScenes.find(s=>s[0]===value);if(!scene)break;
      if(!state.account)state.account=createAdopterExamples().account;
      if(value==='register'){state.account=null;state.registrationDraft=null;navigate('register');}
      else if(value==='saved'){state.discoveryMode='saved';navigate('meet');}
      else if(value==='lifestyle')startLifestyle();
      else if(value==='apply'){applicationReview=false;applicationNote=state.applicationDrafts?.ash?.note||'家里已封窗，家人同意领养，希望了解它的照护安排。';navigate('apply','ash');}
      else navigate(value,value==='followup'?'rice':undefined);
      break;
    }
    case 'example-answer':if(exampleMode)await sendInterviewAnswer(exampleAnswers[lifestyleQuestions[lifestyleStep].key].text);break;
    case 'example-application':if(exampleMode){applicationNote='家里已经封窗，家人同意领养。工作日白天上班，晚上有时间陪伴，家人可以分担照护。想先了解它的饮食和适应情况。';render();}break;
    case 'example-registration':if(exampleMode){const form=document.querySelector('#register-form');for(const [key,value] of Object.entries({nickname:'小禾',username:'example_xiaohe',password:'example-only-1234',realName:'示例用户',phone:'00000000000',email:'xiaohe@example.com'})){if(form.elements[key])form.elements[key].value=value;}form.elements.covenant.checked=true;form.elements.privacy.checked=true;}break;
    case 'share-pet':{
      const p=state.pets.find(p=>p.id===value);if(!p)break;target.disabled=true;
      try{const result=await sharePet(petShareData(p));if(result==='copied')toast('宠物链接已复制，可以分享给朋友');else if(result==='manual')openOverlay('pet-share',p.id);}finally{target.disabled=false;}break;
    }
    case 'application-edit':applicationReview=false;render();break;
    case 'catalog-retry':await loadCatalog();break;
    case 'facts-retry':await loadProfileFacts();break;
    case 'nav':navigate(value);break;
    case 'identity':openOverlay('identity');break;
    case 'identity-adopter':overlay=null;state.role='user';save();render();break;
    case 'work-filter':workFilter=value;render();break;
    case 'animal-filter':animalFilter=value;render();break;
    case 'agent-settings':navigate('agent-settings',value);break;
    case 'pet-observation':{
      const p=value?activePet(state,value):null;
      if(state.role!=='rescue'||(value&&(!p||stationFor(p).id!==state.activeStationId)))break;
      await capture.reset();captureIntent={kind:'observation',petId:p?.id||''};draft={photos:[],description:'',sample:false};observationResult=null;observationEditing=false;observationHold=false;navigate('voice');break;
    }
    case 'observation-text':observationResult=null;observationEditing=true;render();break;
    case 'observation-correct':observationEditing=true;render();break;
    case 'observation-sample':await archiveObservation('最近两周，它每天傍晚喜欢追逗猫棒，玩一会儿就去窗边睡觉。昨天换粮后出现软便，今天仍需观察；没有确认是过敏。');break;
    case 'observation-undo':{
      if(!observationResult||state.role!=='rescue'||observationBusy)break;
      const pet=activePet(state,observationResult.petId);if(!pet||stationFor(pet).id!==state.activeStationId)break;
      const before=structuredClone(state);
      for(const note of pet.knowledge||[])if(note.batchId===observationResult.batchId)note.supersededAt=Date.now();
      const source=pet.observationSources?.find(n=>n.batchId===observationResult.batchId);if(source)source.status='withdrawn';
      if(!save()){state=before;break;}
      observationResult=null;observationEditing=false;render();toast('这条已撤回，Agent 不再引用；历史记录保留');break;
    }
    case 'stories':navigate('stories');break;
    case 'enter-story':await switchStory(value);break;
    case 'exit-story':await switchStory(null);break;
    case 'register':navigate('register');break;
    case 'adopter-login':navigate('adopter-login');break;
    case 'logout':if(state.account)openOverlay('logout');break;
    case 'confirm-logout':{
      if(exampleMode){location.assign('./');break;}
      if(!state.account||authBusy)break;authBusy=true;target.disabled=true;
      try{await accountApi.logout();save();resetLifestyleSpeech();voiceChat.cancel();chatEpoch++;chatBusy=false;await capture.reset();state=guestState();registrationCredentials=null;registrationKey=null;pendingAction=null;draft={photos:[],description:'',sample:false};navigate('meet');navigationStack=[];toast('已退出登录');}catch(e){toast(e.message);target.disabled=false;}finally{authBusy=false;}break;
    }

    case 'account':case 'station-onboarding':case 'stations':case 'public-profile':case 'ratings':navigate(action,value);break;
    case 'station':navigate('station',value);break;
    case 'unpublish-moment':{if(state.role!=='user')break;const f=state.followups.find(f=>f.id===value&&f.adopterId===state.account?.id);if(f){f.publication={...f.publication,allowed:false,withdrawnAt:Date.now()};save();render();toast('已撤下主页展示，站点回访记录保留');}break;}
    case 'rating-appeal':{const r=state.ratings.find(r=>r.id===value&&r.adopterId===state.account?.id);if(r){r.appeal={at:Date.now()};save();render();toast('复核请求已在本地记录，等待站点核实');}break;}
    case 'back':{const next=navigationStack.pop()||{name:state.role==='rescue'?'work':'meet'};leaveCapture(next.name);page=next;overlay=null;render();window.scrollTo(0,0);if(page.name==='intake')capture.startCamera();if(page.name==='profile')void loadProfileFacts();break;}
    case 'filter':filter=value;render();break;
    case 'location':openOverlay('location');break;
    case 'locate':locateUser();break;
    case 'discovery-mode':if(['nearby','swipe','saved'].includes(value)){state.discoveryMode=value;filter='all';save();render();}break;
    case 'swipe-skip':swipePet(value,false);break;
    case 'swipe-like':swipePet(value,true);break;
    case 'undo-swipe':{
      const last=state.swipeHistory.pop();if(!last)break;
      state.passed=state.passed.filter(id=>id!==last.id);
      if(last.liked&&!last.wasFollowing)state.following=state.following.filter(id=>id!==last.id);
      save();render();toast('已撤回上一次选择');break;
    }
    case 'reset-deck':state.passed=[];state.swipeHistory=[];filter='all';save();render();break;
    case 'profile':navigate('profile',value);break;
    case 'chat':openChat(value);break;
    case 'follow':state.following=state.following.includes(value)?state.following.filter(id=>id!==value):[...state.following,value];save();render();break;
    case 'saved':filter='all';state.discoveryMode='saved';save();navigate('meet');break;
    case 'demo':openOverlay('demo');break;
    case 'chat-options':openOverlay('chat-options',value);break;
    case 'role':setRole(value);break;
    case 'close-modal':if(publishingFeedback)break;overlay=null;renderOverlay();break;
    case 'dismiss':if(!publishingFeedback&&event.target===target){overlay=null;renderOverlay();}break;
    case 'consent':consent(value);break;
    case 'memory':navigate('memory');break;
    case 'edit-memory':openOverlay('memory',value);break;
    case 'add-memory':openOverlay('memory');break;
    case 'delete-memory':state.memory=state.memory.filter(m=>m.id!==value);save();render();toast('记忆已删除，不再参与下一轮匹配');break;
    case 'suggestion':sendChat(value);break;
    case 'mute':{const muted=state.muted.includes(value);state.muted=muted?state.muted.filter(id=>id!==value):[...state.muted,value];save();overlay=null;render();toast(muted?'已恢复这位小伙伴的联系设置':'已暂停这位小伙伴的主动联系，你仍可主动聊天');break;}
    case 'apply':{const existing=currentApplication(value);navigate(existing?'progress':'apply',existing?.id||value);break;}
    case 'progress':navigate('progress',value);break;
    case 'withdraw':{const a=state.applications.find(a=>a.id===value);if(!a)break;try{const result=await accountApi.applicationStage(a.id,-1,a.version);Object.assign(a,result);render();toast('申请已撤回');}catch(e){toast(e.message);}break;}
    case 'intake':captureIntent={kind:'intake'};draft=state.draft?.photos?structuredClone(state.draft):{photos:[],description:'',sample:false};textFallback=false;await capture.reset();navigate('intake');break;
    case 'resume-camera':navigate('intake');break;
    case 'sample-intake':draft.photos=['./assets/orange.jpg'];capture.setVideo('./assets/pawletter-film.webm','预制视频');draft.sample=true;persistDraft();render();toast('已加入照片与视频，下一步录入语音');break;
    case 'start-camera':capture.startCamera();break;
    case 'flip-camera':capture.flipCamera();break;
    case 'capture-mode':captureMode=value;render();break;
    case 'shutter':
      if(captureMode==='video'){capture.recordVideo();break;}
      if(draft.photos.length>=5){toast('已拍满 5 张，可以删除一张再拍');break;}
      try{draft.photos.push(capture.photograph(document.querySelector('#camera-preview')));persistDraft();render();toast('已拍好一张，可以继续拍照或切换录像');}catch(e){toast(e.message);}break;
    case 'remove-photo':draft.photos.splice(Number(value),1);persistDraft();render();break;
    case 'remove-video':capture.clearVideo();break;
    case 'preview-photo':openOverlay('capture-photo',value);break;
    case 'preview-video':openOverlay('capture-video');break;
    case 'to-voice':if(!draft.photos.length&&!capture.media.videoUrl){toast('先拍一张照片或一段视频');break;}await capture.stopCamera();navigate('voice');break;
    case 'record':capture.recordVoice();break;
    case 'toggle-text':textFallback=!textFallback;render();break;
    case 'sample-voice':
      draft.description=captureIntent.kind==='observation'?'最近两周，它每天傍晚喜欢追逗猫棒，玩一会儿就去窗边睡觉。昨天换粮后出现软便，今天仍需观察；没有确认是过敏。':captureIntent.kind==='followup'?'今天它开始出来走走了，但吃得比平时少，我有点担心。希望救助者帮忙一起确认。':'它叫小满，是一只橘猫，大概一岁，已经绝育。刚见面比较慢热，熟悉以后愿意亲近人。与狗相处的情况还不清楚。';
      draft.sample=true;persistDraft();render();break;
    case 'analyze-intake':await analyzeCapture();break;
    case 'new-registration':{
      if(state.account){state.demoAdopters??=[];if(!state.demoAdopters.some(a=>a.id===state.account.id))state.demoAdopters.push(structuredClone(state.account));}
      state.account=null;delete state.registrationDraft;state.role='user';state.defaultExamplesRevision=1;
      registrationReturn=null;save();navigate('register');break;
    }
    case 'lifestyle':startLifestyle();break;
    case 'interview-voice-toggle':if(lifestyleSpeechBusy||voiceChat.state.holding||voiceChat.state.finishing||capture.media.voicePending)break;interviewVoiceOpen=!interviewVoiceOpen;render();document.querySelector(interviewVoiceOpen?'[data-action=interview-voice-toggle]':'#lifestyle-answer')?.focus();break;
    case 'lifestyle-restart':lifestyleOwner().lifestyleDraft=structuredClone(lifestyleOwner().lifestyle?.answers||{});interviewAnalysis=null;loadLifestyleStep(0);break;
    case 'lifestyle-transcribe':await transcribeLifestyle();break;
    case 'lifestyle-summary':await summarizeLifestyle();break;
    case 'lifestyle-edit':loadLifestyleStep(Number(value));break;
    case 'lifestyle-confirm':await confirmAccount();break;
    case 'lifestyle-skip':navigate(state.account?'mine':'register');break;

    case 'request-followup':openOverlay('request-followup',value);break;
    case 'respond-request':{
      const r=state.followupRequests.find(r=>r.id===value&&r.adopterId===state.account?.id&&r.status==='pending');
      if(!r||state.role!=='user')break;
      await capture.reset();draft={photos:[],description:'',sample:false};textFallback=false;pendingFeedback=null;
      captureIntent={kind:'followup',petId:r.petId,day:adoptionDay(state,r.petId),requestId:r.id};navigate(r.kind==='audio'?'voice':'intake');break;
    }
    case 'start-checkin':case 'voice-checkin':{
      if(!state.account){registrationReturn={name:'followup',id:value};navigate('register');break;}
      const p=activePet(state,value);if(state.role!=='user'||!currentApplication(value)||!p||p.status!=='adopted'){toast('需要先完成领养交接');break;}
      await capture.reset();draft={photos:[],description:'',sample:false};textFallback=false;pendingFeedback=null;
      captureIntent={kind:'followup',petId:value,day:adoptionDay(state,value)};navigate(action==='voice-checkin'?'voice':'intake');break;
    }
    case 'return-voice':navigate('voice');break;
    case 'submit-checkin':if(pendingFeedback)openOverlay('share-checkin');break;
    case 'send-private':case 'send-public':if(overlay?.type==='share-checkin')await submitCheckin(target,action==='send-public');break;
    case 'confirm':navigate('confirm',value);break;
    case 'edit-confirm':confirmEditing=true;render();break;
    case 'agent':navigate('agent',value);break;
    case 'film':openOverlay('film',value);break;
    case 'toggle-agent':{const p=activePet(state,value);if(p&&p.status!=='adopted'){p.active=!p.active;save();render();toast(p.active?'Agent 已启用，可参与匹配':'已暂停主动匹配');}break;}
    case 'toggle-status':{const p=activePet(state,value);if(p&&p.status!=='adopted'){p.status=p.status==='paused'?'available':'paused';save();render();}break;}
    case 'applications':openOverlay('applications');break;
    case 'application':navigate('application',value);break;
    case 'advance':if(advanceApplication(state,value)){save();render();toast('已更新，用户端进度同步变化');}break;
    case 'reject':{const a=state.applications.find(a=>a.id===value);if(a&&a.stage>=0&&a.stage<3){a.stage=-1;save();render();toast('申请已结束');}break;}
    case 'followup':navigate('followup',value);break;
    case 'reviews':openOverlay('reviews',value);break;
    case 'next-greeting':{const p=greet(state);save();overlay=null;state.role='user';save();navigate('messages');toast(p?`${p.name}发来新招呼`:state.consent!==true?'请先开启主动招呼':'本轮没有新的适配对象；可以修改偏好或录入新伙伴');break;}
    case 'demo-review':{
      const p=state.pets.find(p=>p.status==='available'&&p.confirmed&&p.active);
      if(!p){toast('没有正在开放领养的 Agent');break;}
      if(!state.reviews.some(r=>r.petId===p.id&&r.outcome==='no_reply'))reviewConversation(state,p.id,'no_reply');
      save();openOverlay('reviews',p.id);break;
    }
    case 'next-day':{const p=activePet(state,page.id)?.status==='adopted'?activePet(state,page.id):state.pets.find(p=>p.status==='adopted');if(!p){toast('先完成领养交接，即可推进到家时间');break;}const current=adoptionDay(state,p.id);p.adoptionDay=current===1?3:current===3?7:current===7?30:current+30;state.day=p.adoptionDay;save();navigate('followup',p.id);toast(`演示时间已切换为第 ${p.adoptionDay} 天`);break;}
    case 'reset':openOverlay('confirm-reset');break;
    case 'confirm-reset':if(storyMode){await switchStory(state.sampleStory);break;}await capture.reset();await clearMedia().catch(()=>{});localStorage.removeItem(STORY_STORAGE_KEY);state=freshState();initializeDiscovery(state);initializeCommunity(state);enrichCatalog(state);populateDefaultExamples(state);registrationReturn=null;draft={photos:[],description:'',sample:false};captureIntent={kind:'intake'};filter='all';save();navigate('meet');navigationStack=[];toast('已重置，可以从第一封来信重新开始');break;
  }
});
document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;const data=new FormData(form);
  if(form.id==='animal-search-form'){animalSearch=String(data.get('search')||'').trim();render();return;}
  if(form.id==='observation-text-form'){
    const text=String(data.get('text')||'').trim();if(!text)return;
    await archiveObservation(text,captureIntent.petId,observationResult?.batchId);return;
  }
  if(form.id==='lifestyle-answer-form'){await sendInterviewAnswer(String(data.get('answer')||'').trim());return;}
  if(form.id==='adopter-login-form'){
    if(authBusy)return;authBusy=true;form.querySelector('button').disabled=true;
    try{acceptAccount(await accountApi.login(String(data.get('username')||'').trim().toLowerCase(),String(data.get('password')||'')));resumeAccount();toast('登录成功');}catch(e){form.querySelector('.form-error').textContent=e.message;form.querySelector('button').disabled=false;}finally{authBusy=false;}return;
  }

  if(form.id==='followup-request-form'){
    try{const request=requestFollowup(state,{applicationId:form.dataset.application,kind:String(data.get('kind')),message:String(data.get('message')||''),dueDays:Number(data.get('dueDays'))});save();overlay=null;navigate('followup',request.petId);toast('回访邀请已记录');}
    catch(e){form.querySelector('.form-error').textContent=e.message;}return;
  }
  if(form.id==='register-form'){
    if(!form.checkValidity()){form.reportValidity();return;}
    const details=Object.fromEntries(['nickname','username','password','realName','phone','wechat','email'].map(k=>[k,String(data.get(k)||'').trim()]));details.password=String(data.get('password')||'');details.username=details.username.toLowerCase();
    if(!/^\+?[0-9 -]{7,20}$/.test(details.phone)){form.querySelector('#register-error').textContent='请检查手机号格式。';return;}
    registrationCredentials={...details,covenant:data.has('covenant'),privacy:data.has('privacy')};registrationKey=crypto.randomUUID();
    state.registrationDraft={nickname:details.nickname,lifestyleDraft:state.registrationDraft?.lifestyleDraft||{}};startLifestyle();return;
  }

  if(form.id==='station-request-form'){
    if(!state.stationRequests.length)state.stationRequests.push({id:crypto.randomUUID(),name:'新家救助小站',status:'pending',at:Date.now()});
    save();render();toast('申请已登记，未开通站点权限');return;
  }
  if(form.id==='station-switch-form'){const station=stationById(String(data.get('stationId')));if(station){state.activeStationId=station.id;setRole('rescue');}return;}
  if(form.matches('.rating-form')){
    if(!data.has('confirmRating'))return;
    try{addStationRating(state,{applicationId:form.dataset.application,score:data.get('score'),note:String(data.get('note')||'')});save();render();toast('评价已记录，星级同步到领养者个人主页');}
    catch(e){form.querySelector('.form-error').textContent=e.message;}return;
  }
  if(form.id==='location-form'){
    const location=cityLocations[String(data.get('city'))];if(!location)return;
    state.location={...location,source:'manual'};state.radius=Number(data.get('radius'));
    state.memory=state.memory.filter(m=>m.id!=='m-city');
    state.memory.push({id:'m-city',text:'所在城市：'+location.label,type:'condition',source:'用户手动选择',at:Date.now()});
    state.passed=[];save();overlay=null;render();toast('位置与附近范围已更新');return;
  }
  if(form.id==='chat-form') {sendChat(String(data.get('message')||''));return;}
  if(form.id==='memory-form') {
    const text=String(data.get('text')).trim();if(!text)return;
    const id=form.dataset.id;
    if(id){const m=state.memory.find(m=>m.id===id);if(m){m.text=text;m.type=data.get('type');m.source='用户主动修改';}}
    else state.memory.push({id:crypto.randomUUID(),text,type:data.get('type'),source:'用户主动补充',at:Date.now()});
    save();overlay=null;render();toast('记忆已更新');return;
  }
  if(form.id==='application-form'){
    if(!state.account){registrationGate('apply',page.id);return;}
    const note=String(data.get('conditions')||'').trim();if(!note)return;
    state.applicationDrafts??={};state.applicationDrafts[page.id]={note,updatedAt:Date.now()};applicationNote=note;save();
    applicationReview=true;render();window.scrollTo(0,0);return;
  }

  if(form.id==='application-confirm-form'){
    if(!state.account||applicationBusy||!data.has('shareProfile'))return;applicationBusy=true;applicationError='';render();
    try{const result=await accountApi.apply(page.id,{note:applicationNote,memories:state.memory.map(m=>m.text),shareProfile:true},applicationKey);state.applications.unshift(result);delete state.applicationDrafts?.[page.id];save();navigate('progress',result.id);toast(exampleMode?'示例申请已保存，没有发送给真实救助站。':'申请已交给负责救助站');}
    catch(e){applicationError=e.message;}finally{applicationBusy=false;render();}return;
  }
  if(form.id==='confirm-form') {
    const p=activePet(state,form.dataset.id);if(!p)return;
    for(const key of ['name','species','age','coat','character','health','unknown','needs'])p[key]=String(data.get(key)||'').trim()||'待确认';
    p.confirmed=true;save();navigate('agent',p.id);toast('档案已确认，可以预览和启用 Agent');return;
  }
  if(form.id==='agent-form') {const p=activePet(state,form.dataset.id);if(!p)return;p.mood=String(data.get('mood')).trim();p.intro=String(data.get('intro')).trim();save();toast('表达设定已保存');return;}
  if(form.matches('.reply-form')) {
    const f=state.followups.find(f=>f.id===form.dataset.feedback);const text=String(data.get('reply')).trim();if(!f||!text)return;
    f.reply=text;f.resolved=true;f.repliedAt=Date.now();addMessage(state,f.petId,'pet',`救助者回复了你的到家反馈：「${text}」`,{system:true});save();render();toast('已回复，用户端可以查看');return;
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='lifestyle-answer'){lifestyleText=event.target.value;return;}
  if(event.target.id!=='draft-description')return;
  draft.description=event.target.value;draft.sample=false;persistDraft();
  const submit=app.querySelector('[data-action="analyze-intake"]');
  if(submit)submit.disabled=!draft.description.trim()&&!capture.media.audioUrl&&!(captureIntent.kind==='followup'&&(draft.photos.length||capture.media.videoUrl));
});
document.addEventListener('change',async event=>{
  const input=event.target;
  if(input.id==='lifestyle-value'){lifestyleValue=input.value;return;}
  if(['photo-upload','native-photo','native-video'].includes(input.id)) {
    for(const file of input.files||[]) {
      if(file.type.startsWith('video/')) {
        if(file.size>40*1024*1024){toast('请选择小于 40MB 的视频');continue;}
        capture.setVideo(URL.createObjectURL(file),file.name);continue;
      }
      if(!file.type.startsWith('image/')){toast('请选择照片或视频');continue;}
      if(draft.photos.length>=5){toast('最多保留 5 张照片');break;}
      if(file.size>15*1024*1024){toast('请选择小于 15MB 的照片');continue;}
      try {
        const bitmap=await createImageBitmap(file);
        const ratio=Math.min(1,900/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
        draft.photos.push(canvas.toDataURL('image/jpeg',.78));
      }catch{toast('照片读取失败，请换一张 JPEG 或 PNG 图片');}
    }
    persistDraft();render();
  }
});
function persistDraft(){if(captureIntent.kind==='intake'){state.draft=structuredClone(draft);save();}}
function locateUser(){
  if(locating)return;
  if(!navigator.geolocation){locationError='此浏览器不支持定位，请手动选择城市。';renderOverlay();return;}
  locating=true;locationError='';renderOverlay();
  navigator.geolocation.getCurrentPosition(position=>{
    locating=false;
    state.location={label:'当前位置',latitude:position.coords.latitude,longitude:position.coords.longitude,source:'live'};
    state.memory=state.memory.filter(m=>m.id!=='m-city');state.passed=[];save();render();
    toast('已使用设备定位，附近展示的仍是站点');
  },error=>{
    locating=false;locationError=error.code===1?'没有获得定位权限，可以手动选择城市。':'暂时无法获取位置，请重试或手动选择城市。';
    if(overlay?.type==='location')renderOverlay();else toast(locationError);
  },{timeout:10000,maximumAge:60000,enableHighAccuracy:false});
}
function swipePet(id,liked){
  if(liked&&!state.account){registrationGate('swipe-like',id);return;}
  if(!id||state.passed.includes(id))return;
  state.swipeHistory.push({id,liked,wasFollowing:state.following.includes(id)});
  state.passed.push(id);
  if(liked&&!state.following.includes(id))state.following.push(id);
  save();render();
  toast(liked?'已加入喜欢，随时可以去打个招呼':'换一位，继续遇见');
}
document.addEventListener('pointerdown',event=>{
  const card=event.target.closest('#swipe-card');
  if(!card||event.target.closest('.save-button'))return;
  swipeGesture={card,x:event.clientX,y:event.clientY,id:card.dataset.pet,pointer:event.pointerId,dragging:false};
});
document.addEventListener('pointermove',event=>{
  if(!swipeGesture||event.pointerId!==swipeGesture.pointer)return;
  const g=swipeGesture,dx=event.clientX-g.x,dy=event.clientY-g.y;
  if(!g.dragging&&Math.abs(dy)>20&&Math.abs(dy)>Math.abs(dx)){swipeGesture=null;return;}
  if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){
    g.dragging=true;g.card.setPointerCapture(event.pointerId);
    g.card.style.transform=`translateX(${dx*.7}px) rotate(${dx/28}deg)`;
    g.card.style.setProperty('--like-opacity',String(Math.min(1,Math.max(0,dx/90))));
    g.card.style.setProperty('--skip-opacity',String(Math.min(1,Math.max(0,-dx/90))));
  }
});
function finishSwipe(event,cancelled=false){
  if(!swipeGesture)return;
  const g=swipeGesture;swipeGesture=null;
  g.card.style.transform='';g.card.style.setProperty('--like-opacity','0');g.card.style.setProperty('--skip-opacity','0');
  if(g.dragging)suppressClickUntil=Date.now()+350;
  const dx=event.clientX-g.x;
  if(!cancelled&&g.dragging&&Math.abs(dx)>70)swipePet(g.id,dx>0);
}
document.addEventListener('pointerup',event=>finishSwipe(event));
document.addEventListener('pointercancel',event=>finishSwipe(event,true));
async function analyzeCapture() {
  if(capture.media.voiceRecorder||capture.media.voicePending)return;
  const m=capture.media,feedback=captureIntent.kind==='followup',supplement=captureIntent.kind==='observation';
  if(!m.audioUrl&&!draft.description.trim()&&!(feedback&&(draft.photos.length||m.videoUrl))){toast('先说一段语音，或使用预设口述');return;}
  if(!feedback&&!supplement&&!draft.photos.length&&!m.videoUrl){toast('请先拍照或录一段视频');return;}
  await capture.stopCamera();await capture.stopVoice();
  analysisStep=0;navigate('analyzing');const epoch=++analysisEpoch;
  for(let i=0;i<4;i++){if(epoch!==analysisEpoch||page.name!=='analyzing')return;analysisStep=i;render();await new Promise(resolve=>setTimeout(resolve,380));}
  if(epoch!==analysisEpoch||page.name!=='analyzing')return;
  if(supplement){navigate('voice');await archiveObservation(draft.description);return;}
  if(feedback){
    const text=draft.description.trim()||(m.audioUrl?`已提交 ${m.audioSeconds} 秒语音介绍，尚未转写，请救助者听取原始录音。`:'已提交照片或视频，请救助者查看原始画面；尚未生成事实判断。');
    pendingFeedback={id:crypto.randomUUID(),petId:captureIntent.petId,day:captureIntent.day,requestId:captureIntent.requestId,text};
    navigate('feedback-review');return;
  }
  const id=crypto.randomUUID(),text=draft.description.trim();
  const name=text.match(/(?:它叫|名字叫|名字是)([^，,。！\s]{1,12})/)?.[1]||'待命名伙伴';
  const species=/是一只[^，。]{0,5}猫/.test(text)?'猫':/是一只[^，。]{0,5}狗/.test(text)?'狗':'待确认';
  const p={id,name,species,image:draft.photos[0]||'./assets/paw.svg',age:/一岁|1岁/.test(text)?'约 1 岁':'待确认',coat:/橘猫|橘色/.test(text)?'橘色':/狸花/.test(text)?'狸花':'待确认',sex:'待确认',character:/慢热/.test(text)?'慢热，具体相处表现请确认':'待确认',health:/未绝育|没绝育/.test(text)?'未绝育（据口述，待确认）':/已.{0,2}绝育/.test(text)?'已绝育（据口述，待确认）':'待确认',unknown:'图片/OCR、视频及真实录音未自动识别，未提供的事实请核实',needs:'由救助者补充确认',intro:`你好，我是${name}的 AI 分身。关于我的情况，可以一起看看救助者确认的档案。`,mood:'慢慢认识，认真相遇。',tags:['等待认识','新伙伴'],confirmed:false,active:false,status:'available',city:'杭州',station:'暖爪救助站',observations:text?[text]:['已上传素材，尚待人工确认'],sourceMedia:{photos:draft.photos.length,video:!!m.videoUrl,audio:!!m.audioUrl}};
  const station=stationById(state.activeStationId);p.stationId=station.id;p.station=station.name;p.city=station.city;
  try {
    p.intakeMedia=draft.photos.map(src=>({type:'photo',src}));
    if(m.videoUrl)p.intakeMedia.push({type:'video',...await storeMedia(m.videoUrl)});
    if(m.audioUrl)p.intakeMedia.push({type:'audio',...await storeMedia(m.audioUrl)});
  } catch {navigate('voice');toast('原始素材保存失败，请检查存储空间后重试');return;}
  if(epoch!==analysisEpoch||page.name!=='analyzing')return;
  state.pets.unshift(p);state.draft=null;save();navigate('confirm',id);toast('模拟档案已整理，未知项保留待确认');
}
async function submitCheckin(target,publicly=false) {
  if(!pendingFeedback||target.disabled||publishingFeedback||!state.account)return;
  const p=activePet(state,pendingFeedback.petId);
  if(state.role!=='user'||!currentApplication(p?.id)||!p||p.status!=='adopted'){toast('领养状态已变化，请重新查看');return;}
  const request=state.followupRequests.find(r=>r.id===pendingFeedback.requestId);
  if(request&&((request.kind==='photo'&&!draft.photos.length)||(request.kind==='video'&&!capture.media.videoUrl)||(request.kind==='audio'&&!capture.media.audioUrl))){toast('请补充站点希望收到的'+requestKindLabels[request.kind]+'，再提交这次回访');return;}
  publishingFeedback=true;overlayRoot.querySelectorAll('button').forEach(b=>b.disabled=true);target.disabled=true;target.textContent='正在保存素材…';
  try{
    const media=[...draft.photos.map(src=>({type:'photo',src}))];
    if(capture.media.videoUrl)media.push({type:'video',...await storeMedia(capture.media.videoUrl)});
    if(capture.media.audioUrl)media.push({type:'audio',...await storeMedia(capture.media.audioUrl)});
    const result=draft.description.trim()?summarizeFeedback(pendingFeedback.text):{attention:true,summary:'已收到原始素材，内容未自动识别，需人工查看或听取；不代表动物状态正常。'};
    const record={...pendingFeedback,...result,media,adopterId:state.account.id,stationId:stationFor(p).id,publication:{allowed:publicly,consentedAt:Date.now(),caption:'一起生活的小片段'},resolved:false,at:Date.now()};
    const requestsBefore=structuredClone(state.followupRequests);
    state.followups.push(record);completeFollowupRequest(state,record);
    if(!save()){state.followups.pop();state.followupRequests=requestsBefore;throw new Error('storage');}
    pendingFeedback=null;navigate('followup',p.id);toast(publicly?'已同步站点，并授权本条素材展示到主页':'已同步给站点，未在个人主页展示');
  }catch{renderOverlay();toast('素材保存失败，请检查浏览器存储空间后重试，记录尚未提交');}
  finally{publishingFeedback=false;}
}
document.addEventListener('pointerdown',event=>{
  const target=event.target.closest('#observation-hold');if(!target||target.disabled||event.button!==0)return;
  target.setPointerCapture?.(event.pointerId);beginObservationHold(event);
});
document.addEventListener('pointerup',()=>{if(observationHold)finishObservationHold();});
document.addEventListener('pointercancel',()=>{if(observationHold)finishObservationHold(true);});
document.addEventListener('contextmenu',event=>{if(event.target.closest('#observation-hold'))event.preventDefault();});
document.addEventListener('change',event=>{
  if(event.target.id==='observation-pet'&&!observationHold&&!observationBusy&&!observationFinishing){
    captureIntent.petId=event.target.value;observationResult=null;observationEditing=false;render();
  }
});
document.addEventListener('keydown',event=>{
  if(event.target.id==='observation-hold'&&(event.key===' '||event.key==='Enter')&&!event.repeat)beginObservationHold(event);
});
document.addEventListener('keyup',event=>{
  if(event.target.id==='observation-hold'&&(event.key===' '||event.key==='Enter')){event.preventDefault();finishObservationHold();}
});
window.addEventListener('blur',()=>{if(observationHold)finishObservationHold(true);});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&overlay&&!publishingFeedback){overlay=null;renderOverlay();}
  if(event.key==='Tab'&&overlay){
    const focusable=[...overlayRoot.querySelectorAll('button:not([disabled]), a[href], input, select, textarea, video[controls]')];
    if(!focusable.length)return;
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
window.addEventListener('beforeunload',capture.emergencyStop);
function updateViewport(){document.documentElement.style.setProperty('--chat-height',`${window.visualViewport?.height||window.innerHeight}px`);}
window.visualViewport?.addEventListener('resize',updateViewport);
window.addEventListener('resize',updateViewport);
updateViewport();
render();

const linkedStory=new URL(location.href).searchParams.get('story');
if(linkedStory==='station-day')location.replace('?mode=online&role=station');
if(authRestoring){accountApi.profile().then(profile=>{acceptAccount(profile);render();}).catch(()=>{accountApi.clear();toast('请重新登录以恢复你的资料。');}).finally(()=>{authRestoring=false;});}

async function switchStory(){toast("请使用你的领养者账号或救助站账号。");}

let voicePointer=null;
document.addEventListener('pointerdown',event=>{
 const button=event.target.closest('#interview-hold,#application-hold');if(!button||button.disabled||voicePointer!==null||event.button>0)return;
 if(exampleMode){event.preventDefault();toast('示例访谈可以使用预设回答或文字；真实语音请返回正式界面。');return;}
 event.preventDefault();voicePointer=event.pointerId;voiceChat.start(event.clientY);
});
document.addEventListener('pointermove',event=>{if(event.pointerId===voicePointer)voiceChat.move(event.clientY);});
document.addEventListener('pointerup',event=>{if(event.pointerId===voicePointer){voicePointer=null;voiceChat.end();}});
document.addEventListener('pointercancel',event=>{if(event.pointerId===voicePointer){voicePointer=null;voiceChat.end(true);}});
document.addEventListener('keydown',event=>{if(event.target.matches('#interview-hold,#application-hold')&&[' ','Enter'].includes(event.key)&&!event.repeat){event.preventDefault();if(exampleMode){toast('示例访谈请使用预设回答或文字。');return;}voiceChat.start(0);}if(event.key==='Escape'&&voiceChat.state.holding)voiceChat.end(true);});
document.addEventListener('keyup',event=>{if(event.target.matches('#interview-hold,#application-hold')&&[' ','Enter'].includes(event.key)){event.preventDefault();voiceChat.end();}});
document.addEventListener('input',event=>{if(event.target.id==='application-note')applicationNote=event.target.value;});
window.addEventListener('blur',()=>{voicePointer=null;if(voiceChat.state.holding)voiceChat.end(true);});

void loadCatalog();

async function loadApplications(ownerId){
 try{const result=await accountApi.applications();if(state.account?.id!==ownerId)return;state.applications=result.applications;if(['mine','public-profile','progress'].includes(page.name))render();}catch(e){if(state.account?.id===ownerId)toast('申请记录暂时无法加载，请稍后重试。');}
}
