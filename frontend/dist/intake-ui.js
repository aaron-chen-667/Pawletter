import {imageData,videoData,toDataURL} from './intake-media.js';
import {createCaptureController} from './capture.js';
import {createPressToTalk} from './press-to-talk.js';
import {createOnboardingSpeech} from './onboarding-speech.js';
import {createIntakeDraftStore} from './intake-draft-store.js';
import {createIntakeCamera} from './intake-camera.js';
import {knowledgeTopics,topicOf} from './pet-knowledge.js';
import {composerIcons as icons,inputModeStore as localModeStore,renderComposer} from './intake-composer.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const join=(a,b)=>[a,b].filter(Boolean).join('\n');
// Example mode only: a canned answer for whichever dimension the conversation is asking about.
const exampleAnswers={first:'今天刚接回一只橘猫，还没有名字。年龄大概一岁，送来的人估计的。人靠近时会躲，刚吃了点罐头。',sex:'是只公猫。',health:'身上没看到伤，疫苗和驱虫都还没做，也没绝育。',character:'送来的人说它平时挺黏人，就是怕生，熟了会蹭人。',likes:'喜欢追逗猫棒，摸下巴会呼噜。',habits:'会用猫砂，白天睡得多，晚上比较闹。',diet:'吃猫粮和罐头，喝水正常。'};
const maxText=4000,greeting='先发张照片，或者说说它的情况吧。';
const speciesLabels={cat:'猫',dog:'狗',unknown:'不确定'},sexLabels={male:'公',female:'母',unknown:'不确定'};
const fieldLimits={name:80,age:80,character:500,description:4000};
// Same dimensions and asking order as the server organiser: profile fields first, then knowledge topics.
const dimensionLabels={species:'种类',age:'年龄',sex:'公母',health:'健康',character:'性格',likes:'喜好',habits:'习惯',diet:'饮食'};
export function temporaryName(species,at=new Date()){
 const d=new Date(at),pad=n=>String(n).padStart(2,'0');
 return `待命名${species==='cat'?'小猫':species==='dog'?'小狗':'伙伴'} · ${d.getMonth()+1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// The organiser reads only what the rescuer actually said; "unsure" replies travel as declined dimensions.
const transcriptOf=turns=>turns.filter(t=>t.role==='me'&&!t.kind&&t.text).map(t=>t.text).join('\n');
// The card lists the organised record sentence by sentence under the same topics the knowledge base uses.
// Same defaults the knowledge worker applies: hedged words are pending, health and one-off moments are observations.
const certaintyOf=(text,topic)=>/可能|怀疑|不确定|待核实|不清楚|待确认/.test(text)?'pending':topic==='health'||!/一直|每天|通常|平时|长期|每次|习惯/.test(text)?'observation':'ongoing';
const certaintyLabels={ongoing:'长期',observation:'这次',pending:'待确认'},nextCertainty={ongoing:'observation',observation:'pending',pending:'ongoing'};
const itemsFrom=text=>text.split(/(?<=[。！？；\n])/).map(t=>t.trim()).filter(Boolean).map(text=>{const topic=topicOf(text);return {id:crypto.randomUUID(),topic,text,certainty:certaintyOf(text,topic),shared:true};});
const sharedItems=items=>items.filter(i=>i.shared!==false);
const descriptionOf=items=>knowledgeTopics.flatMap(q=>items.filter(i=>i.topic===q.key&&i.text.trim()).map(i=>i.text.trim().replace(/[^。！？；]$/,'$&。'))).join('');

export function createIntakeUI({api,exampleMode,root,redraw,onDone,canWrite=()=>true,getDraftKey=()=>exampleMode?'example':'station',draftStore=createIntakeDraftStore(),speech=createOnboardingSpeech(),modeStore=localModeStore}){
 let s,owner,epoch=0,active=false,recordingStarted=false,preview=null,resume=false,mode=modeStore.get()==='text'?'text':'voice';
 const capture=createCaptureController({onChange:updateRecording,onError(message){if(s)s.error=message;updateRecording();}});
 const talk=createPressToTalk({capture,onChange:updateRecording,onSend:transcribe});
 const camera=createIntakeCamera({root,onCapture:async item=>{if(await addMedia([item])===false)throw Error(s?.error||'素材未能添加，请重试。');},onError:message=>{if(active&&s){s.error=message;redraw();}}});
 function empty(){return {version:3,key:crypto.randomUUID(),createdAt:new Date().toISOString(),turns:[],media:[],text:'',input:'',audio:'',voiceBase:'',audioText:'',review:null,declined:[],commit:null,result:null,busy:false,error:''};}
 const basisOf=state=>`${state.text}\u0000${state.media.map(m=>m.id).join(',')}`;
 const reviewFresh=()=>!!s?.review&&s.review.basis===basisOf(s);
 const missing=()=>{const c=s.review?.coverage||{};return Object.keys(dimensionLabels).filter(d=>Object.keys(c).length&&c[d]==='missing');};
 // A record can be archived once every dimension has an answer or an explicit "unsure".
 const complete=()=>reviewFresh()&&!missing().length;
 const confirmLabel=()=>s.busy?s.commit?'正在入档…':'正在整理…':s.result?'打开已建立的档案':s.commit?'重试入档':'确认入档';
 function restore(saved){
  if(saved?.version===3)return {...empty(),...saved,busy:false,panel:false,editing:null};
  // Earlier single-page drafts become one message so nothing the rescuer wrote is lost.
  const legacy=saved?.version===2?{text:saved.text||'',rest:saved}:saved?.version===1?{text:join(saved.overrides?.description??saved.draft?.description??saved.turns?.filter(t=>t.role==='user').map(t=>t.text).join('\n')??'',saved.answer),rest:{key:saved.key,media:saved.media||[],audio:saved.audio||'',commit:saved.commit||null,result:saved.result||null}}:null;
  if(!legacy)return empty();
  const turns=legacy.text?[{id:crypto.randomUUID(),role:'me',text:legacy.text}]:[];
  return {...empty(),...legacy.rest,version:3,turns,text:transcriptOf(turns),input:'',review:null,busy:false};
 }
 function persist(current=s,key=owner){
  if(!current||!key)return Promise.resolve();
  return draftStore.save(key,{...current,busy:false,error:'',panel:false,editing:null}).then(()=>{if(s===current)s.storageError='';}).catch(()=>{
   if(s===current){s.storageError='草稿暂未保存到本机，请暂时不要关闭页面。';const el=root.querySelector('#intake-storage-error');if(active&&el)el.textContent=s.storageError;}
  });
 }
 function remember(){const el=root.querySelector('#intake-answer');if(el&&s&&!talk.state.holding&&!talk.state.finishing)s.input=el.value;}
 async function reset(){
  stop();const ticket=++epoch,key=getDraftKey();if(!key)return;
  if(owner!==key){owner=key;s=null;}
  if(!s){try{const saved=await draftStore.load(key);if(ticket!==epoch)return;s=restore(saved);}catch{if(ticket!==epoch)return;s=empty();s.storageError='草稿存储不可用，请暂时不要关闭页面。';}}
  s={...s,busy:false};active=true;resume=true;
 }
 function stop(){if(active&&s){remember();void persist();}active=false;epoch++;talk.cancel();speech.cancel();capture.emergencyStop();void camera.stop();preview?.close();preview?.remove();preview=null;}
 const locked=()=>!!s?.busy||talk.state.holding||talk.state.finishing;
 const hasContent=state=>!!state.text.trim()||state.media.length>0;
 const canSave=()=>s&&(!!s.commit||complete()&&descriptionOf(sharedItems(s.review.items)).length<=fieldLimits.description)&&!locked()&&!s.audio;
 function button(label,action,cls='text-button',extra=''){return `<button type="button" class="${cls}" data-intake="${action}" ${locked()||s.commit?'disabled':''} ${extra}>${label}</button>`;}
 function mediaBubble(t){
  const items=t.mediaIds.map(id=>s.media.find(m=>m.id===id)).filter(Boolean);
  if(!items.length)return `<div class="intake-bubble me muted">素材已移除</div>`;
  return `<div class="intake-bubble me media">${items.map(m=>`<button type="button" class="intake-bubble-media" data-intake="preview" data-id="${esc(m.id)}" aria-label="查看${esc(m.name||'素材')}">${m.kind==='document'?`<span class="intake-document-icon">${icons.file}</span><span>${esc(m.name||'材料')}</span>`:`<img src="${esc(m.kind==='video'?m.frames?.[0]:m.dataUrl)}" alt="${m.kind==='video'?'视频封面':'伙伴照片'}">${m.kind==='video'?'<span class="intake-video-mark">▶</span>':''}`}</button>`).join('')}</div>`;
 }
 function turnView(t,last){
  if(t.role==='ai')return `<div class="intake-bubble ai">${esc(t.text)}</div>${last&&t.dimension&&!s.commit?button('暂时不清楚','decline','intake-decline'):''}`;
  if(t.mediaIds)return mediaBubble(t);
  if(t.kind==='decline')return `<div class="intake-bubble me">暂时不清楚</div>`;
  if(s.editing===t.id)return `<form class="intake-bubble me editing" data-edit="${esc(t.id)}"><textarea id="intake-edit" rows="3" maxlength="${maxText}" aria-label="修改这条回答">${esc(t.text)}</textarea><div><button type="button" class="text-button" data-intake="cancel-edit">取消</button><button class="text-button strong">保存</button></div></form>`;
  return `<button type="button" class="intake-bubble me" data-intake="edit" data-id="${esc(t.id)}" aria-label="修改：${esc(t.text)}" ${locked()||s.commit?'disabled':''}>${esc(t.text)}</button>`;
 }
 function cardView(){
  const r=s.review;if(!r&&!s.commit)return '';
  const left=missing(),show=s.commit||complete()||s.cardOpen;if(!show)return '';
  const f=r?.fields||{},off=locked()||!!s.commit;
  const choices=(field,label,labels)=>`<div class="intake-review-row"><span>${label}</span><div class="intake-segment" role="radiogroup" aria-label="${label}">${Object.entries(labels).map(([value,text])=>`<button type="button" role="radio" aria-checked="${f[field]===value}" data-review-choice="${field}" data-value="${value}" ${off?'disabled':''}>${text}</button>`).join('')}</div></div>`;
  const input=(field,label,placeholder)=>`<label class="intake-review-row"><span>${label}</span><input data-review-field="${field}" value="${esc(f[field])}" placeholder="${esc(placeholder)}" maxlength="${fieldLimits[field]}" ${off?'readonly':''}></label>`;
  const topics=r?knowledgeTopics.map(q=>{const items=r.items.filter(i=>i.topic===q.key);if(q.key==='other'&&!items.length)return '';return `<div class="intake-topic"><h3>${q.label}</h3>${items.length?items.map(i=>{const certainty=i.certainty||certaintyOf(i.text,i.topic),local=i.shared===false;return `<div class="intake-item${local?' local':''}"><div class="intake-item-main"><textarea data-item="${esc(i.id)}" rows="1" maxlength="1000" aria-label="${q.label}" ${off?'readonly':''}>${esc(i.text)}</textarea>${button(icons.close,'remove-item','intake-item-remove',`data-id="${esc(i.id)}" aria-label="删除这条"`)}</div><div class="intake-item-tags">${button(certaintyLabels[certainty],'item-certainty','intake-tag',`data-id="${esc(i.id)}" aria-label="${certaintyLabels[certainty]}，点一下切换长期、这次或待确认"`)}${button('仅本站','item-local',`intake-tag${local?' on':''}`,`data-id="${esc(i.id)}" aria-pressed="${local}"`)}</div></div>`;}).join(''):'<p class="intake-topic-empty">还没有</p>'}${button('＋ 添加一条','add-item','intake-item-add',`data-topic="${q.key}"`)}</div>`;}).join(''):'';
  const fields=r?`${input('name','名字',temporaryName(f.species,s.createdAt))}${choices('species','种类',speciesLabels)}${choices('sex','性别',sexLabels)}${input('age','年龄','未知')}${input('character','长期性格','未知')}${topics}${r.uncertainties.length?`<ul class="intake-review-notes" aria-label="待确认">${r.uncertainties.map(u=>`<li>${esc(u)}</li>`).join('')}</ul>`:''}`:'';
  const length=r?descriptionOf(sharedItems(r.items)).length:0,tooLong=length>fieldLimits.description;
  const footer=s.commit||complete()?`${length>3500?`<p class="intake-card-left${tooLong?' over':''}">对外内容 ${length} / ${fieldLimits.description} 字${tooLong?'，请删减或把部分设为仅本站':''}</p>`:''}<form id="intake-confirm"><button class="button primary full" ${canSave()?'':'disabled'}>${confirmLabel()}</button></form>`:`<p class="intake-card-left">还差 ${left.map(d=>dimensionLabels[d]).join('、')}，回答或点「暂时不清楚」后就能入档。</p>`;
  return `<section class="intake-review" aria-labelledby="intake-review-title"><header><h2 id="intake-review-title">档案</h2><span>每项都能直接修改</span></header>${fields}${footer}</section>`;
 }
 function progressView(){
  const c=s.review?.coverage||{},total=Object.keys(dimensionLabels).length;
  if(!s.review||!Object.keys(c).length)return '';
  const done=total-missing().length;
  return `<button type="button" class="intake-progress${done===total?' done':''}" data-intake="toggle-card" aria-expanded="${!!s.cardOpen}">档案 ${done}/${total}</button>`;
 }
 function render(){
  if(!s)return '<p role="status">正在恢复草稿…</p>';
  const turns=[{id:'greeting',role:'ai',text:greeting},...s.turns];
  const lastAi=turns.map(t=>t.role).lastIndexOf('ai');
  return `<section class="intake-chat-flow"><div class="intake-chat-top">${s.turns.length&&!s.commit?button('重新开始','restart','intake-restart'):''}${progressView()}</div><div class="intake-chat" aria-live="polite">${turns.map((t,i)=>turnView(t,i===lastAi&&i===turns.length-1)).join('')}${s.busy&&!s.commit?'<div class="intake-bubble ai pending">正在整理…</div>':''}${s.error?`<div class="intake-chat-error"><p class="online-error" id="intake-error" role="alert">${esc(s.error)}</p>${!s.commit&&hasContent(s)&&!reviewFresh()&&!s.audio?button('重新整理','retry-organise'):''}</div>`:'<p class="online-error" id="intake-error" role="alert"></p>'}${cardView()}<p class="online-error" id="intake-storage-error" role="status">${esc(s.storageError||'')}</p></div>
${composerView()}
<input hidden id="intake-album" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple><input hidden id="intake-document" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></section>`;
 }
 // Voice mode shows one big talk button; its layout follows idle, recording and review of the spoken text.
 const dockState=()=>talk.state.holding||talk.state.finishing?'rec':s.input.trim()||s.audio?'review':'idle';
 function composerView(){
  const working=locked(),audio=s.audio?`<div class="intake-audio-recovery"><audio controls src="${esc(s.audio)}"></audio><div>${button('重试转写','retry-speech')}${button('移除录音','discard-audio')}</div></div>`:'';
  const panel=s.panel&&!s.commit?`<div class="intake-panel">${button(`<span>${icons.album}</span>相册`,'album','intake-panel-item')}${button(`<span>${icons.camera}</span>拍摄`,'camera','intake-panel-item')}${button(`<span>${icons.file}</span>文件`,'document','intake-panel-item')}${button(`<span>${icons.unsure}</span>不清楚`,'decline','intake-panel-item',s.review?.nextDimension?'':'hidden')}${exampleMode?button(`<span>${icons.album}</span>示例照片`,'sample','intake-panel-item'):''}</div>`:'';
  const plus=button(s.panel?icons.close:icons.plus,'attachments','intake-icon-button',`aria-label="${s.panel?'收起':'更多入口'}" aria-expanded="${!!s.panel}"`);
  const answer=(extra='')=>`<textarea id="intake-answer" rows="1" maxlength="${maxText}" aria-label="说说它的情况" placeholder="${s.review?'还想补充或更正…':'说说它的情况…'}" ${working||s.commit||extra?'readonly':''}>${esc(s.input)}</textarea>`;
  if(mode==='text')return renderComposer({mode,audio,answer:answer(),left:button(icons.mic,'mode','intake-icon-button','aria-label="切换到语音"'),right:s.input.trim()?button('发送','send','intake-send'):plus,panel});
  const state=dockState(),talkLabel=talk.state.holding?'结束说话':exampleMode?'试一段示例口述':state==='review'?'接着说':'点击说话';
  const talkButton=`<button type="button" id="intake-record" class="intake-talk-button${talk.state.holding?' recording':''}${state==='review'?' small':''}" aria-label="${talkLabel}" aria-pressed="${talk.state.holding}" ${s.busy||talk.state.finishing||s.commit||s.audio?'disabled':''}>${talk.state.holding?icons.stop:icons.mic}</button>`;
  if(state==='rec')return renderComposer({mode,state,caption:'<small id="intake-live" role="status"></small>',answer:answer('live'),left:talk.state.holding?'<button type="button" class="intake-pill" data-voice="cancel">取消</button>':'<span class="intake-pill-space"></span>',center:talkButton,right:'<span class="intake-pill-space"></span>',hint:talk.state.finishing?'正在转写…':'再点一下结束'});
  if(state==='review')return renderComposer({mode,state,audio,caption:'<small>可以直接改</small>',answer:answer(),left:button(`${icons.redo}<span>重说</span>`,'redo','intake-pill'),center:talkButton,right:button('发送','send','intake-send'),hint:'点麦克风可以接着说'});
  return renderComposer({mode,state,audio,left:button(icons.keyboard,'mode','intake-icon-button','aria-label="切换到打字"'),center:talkButton,right:plus,hint:exampleMode?'点一下试一段示例口述':'点一下开始说',panel});
 }
 function updateControls(){
  const input=root.querySelector('#intake-answer');if(input)input.readOnly=locked()||!!s.commit;
  const save=root.querySelector('#intake-confirm button');if(save){save.disabled=!canSave();save.textContent=confirmLabel();}
  for(const b of root.querySelectorAll('[data-intake],[data-review-choice]'))b.disabled=locked()||!!s.commit;
  for(const field of root.querySelectorAll('[data-review-field],[data-item]'))field.readOnly=locked()||!!s.commit;
  // The right-hand control turns into "send" as soon as there is something to send, like a chat app.
  const right=root.querySelector('.intake-bar>[data-intake=send],.intake-bar>[data-intake=attachments]'),sending=!!s.input.trim();
  if(right&&(right.dataset.intake==='send')!==sending){right.outerHTML=sending?button('发送','send','intake-send'):button(icons.plus,'attachments','intake-icon-button','aria-label="更多入口" aria-expanded="false"');s.panel=false;root.querySelector('.intake-panel')?.remove();}
 }
 function updateRecording(){
  if(!active||!s)return;
  const dock=root.querySelector('.intake-composer.voice');if(dock&&dock.dataset.state!==dockState())dock.outerHTML=composerView();
  const el=root.querySelector('#intake-record'),live=root.querySelector('#intake-live');
  if(el){el.classList.toggle('recording',talk.state.holding);el.disabled=s.busy||talk.state.finishing||!!s.commit||!!s.audio;el.setAttribute('aria-pressed',String(talk.state.holding));el.innerHTML=talk.state.holding?icons.stop:icons.mic;}
  if(live)live.textContent=capture.media.voicePending?'请允许使用麦克风':talk.state.holding?`正在${talk.state.realtime?'听':'录音'} · ${capture.media.audioSeconds} 秒${talk.state.realtime?'':' · 结束后转写'}`:talk.state.finishing?'正在转写…':'';
  // Live captions grow inside the input box while the rescuer is speaking.
  if(talk.state.holding&&talk.state.live){const value=join(s.voiceBase,talk.state.live);if(s.input!==value){s.input=value;const input=root.querySelector('#intake-answer');if(input){input.value=value;input.scrollTop=input.scrollHeight;}void persist();}}
  const error=root.querySelector('#intake-error');if(error)error.textContent=s.error||'';updateControls();
  if(capture.media.voiceRecorder)recordingStarted=true;
  if(recordingStarted&&talk.state.holding&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)void talk.end();
 }
 async function toggleRecording(){
  if(!active||!s||s.busy||s.commit||talk.state.finishing)return;
  if(talk.state.holding){await talk.end();return;}
  if(s.audio)return;remember();
  if(exampleMode){const answer=exampleAnswers[s.review?.nextDimension]||Object.values(exampleAnswers).find(t=>!s.text.includes(t)&&!s.input.includes(t));if(!answer)return;s.input=join(s.input,answer);await persist();redraw();return;}
  s.voiceBase=s.input;s.audioText='';s.error='';recordingStarted=false;
  await talk.start(0);
  if(active&&talk.state.holding&&!capture.media.voiceRecorder){await talk.end();if(!s.error)s.error='没有开始录音，请允许麦克风或直接输入文字。';redraw();}
 }
 // Speech fills the input box; the rescuer reviews it and decides when to send.
 async function transcribe(url){
  if(!active||exampleMode)return;const ticket=epoch,state=s;
  const retry=url===s.audio,previous=retry?s.audioText:s.input;
  s.busy=true;s.error='';
  try{
   const audio=url.startsWith('data:')?url:await toDataURL(await(await fetch(url)).blob());
   if(!active||ticket!==epoch||state!==s)return;s.audio=audio;if(!retry)s.audioText=previous;await persist();if(!active||ticket!==epoch)return;redraw();
   const result=await speech.transcribe(audio);if(!active||ticket!==epoch||state!==s||!result)return;
   if(result.error)s.error=result.error;
   else {s.input=s.input===s.audioText?join(s.voiceBase,result.text):join(s.input,result.text);s.audio='';s.audioText='';s.voiceBase='';}
  }catch{if(ticket===epoch&&state===s)s.error='这段录音未能转写，请重试或直接输入。';}
  finally{if(ticket===epoch&&state===s){s.busy=false;await persist();if(active)redraw();}}
 }
 async function addMedia(items){
  if(!active||!s||!canWrite()||locked()||s.commit)return;remember();const ticket=epoch,state=s;s.busy=true;s.error='';s.panel=false;redraw();
  let added=[];
  try{
   for(const item of items){
    const file=item.file,kind=item.kind||(file?.type.startsWith('video/')?'video':'photo');
    const count=[...s.media,...added].filter(m=>m.kind===kind).length;
    if(count>=(kind==='video'?1:3))throw Error(kind==='video'?'本次可添加一段视频。':kind==='document'?'最多添加 3 份材料。':'最多添加 3 张照片。');
    let data;
    if(kind==='document'){
     if(file.size>5*1024*1024)throw Error('每份材料请控制在 5 MB 以内。');
     if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw Error('材料支持 PDF、JPEG、PNG 和 WebP。');
     data={dataUrl:await toDataURL(file),...(file.type==='application/pdf'?{}:{analysisData:await imageData(file)})};
    }else data=kind==='video'?await videoData(file):{dataUrl:item.dataUrl||await imageData(file)};
    const media={id:crypto.randomUUID(),kind,name:(file?.name||item.name||(kind==='photo'?'伙伴照片':'刚拍摄的视频')).slice(0,160),...data};
    if(new TextEncoder().encode(JSON.stringify([...s.media,...added,media])).length>18*1024*1024)throw Error('本次素材总量较大，请移除部分素材后再添加。');
    added.push(media);
   }
   if(ticket!==epoch||state!==s)return false;
   s.media.push(...added);s.turns.push({id:crypto.randomUUID(),role:'me',mediaIds:added.map(m=>m.id)});
  }catch(err){if(ticket===epoch&&state===s)s.error=err.message;added=[];return false;}
  finally{if(ticket===epoch&&state===s){s.busy=false;await persist();if(active)redraw();}}
  await organiseNow();return true;
 }
 function showPreview(id){
  const m=s.media.find(m=>m.id===id);if(!m)return;
  preview?.remove();preview=document.createElement('dialog');preview.className='intake-preview-dialog';
  preview.innerHTML=`<header><strong>${esc(m.name||'素材')}</strong><button type="button" aria-label="关闭预览">×</button></header>${m.kind==='video'?`<video controls autoplay playsinline src="${esc(m.dataUrl)}"></video>`:m.kind==='document'&&m.dataUrl.startsWith('data:application/pdf')?`<object data="${esc(m.dataUrl)}" type="application/pdf"><a href="${esc(m.dataUrl)}" download="${esc(m.name||'材料.pdf')}">下载查看 PDF</a></object>`:`<img src="${esc(m.dataUrl)}" alt="${esc(m.name||'素材')}">`}${s.commit?'':'<footer><button type="button" class="text-button danger" data-remove>移除这份素材</button></footer>'}`;
  document.body.append(preview);const dialog=preview;
  dialog.querySelector('header button').onclick=()=>dialog.close();
  const remove=dialog.querySelector('[data-remove]');if(remove)remove.onclick=()=>{dialog.close();void removeMedia(id);};
  dialog.onclose=()=>{dialog.remove();if(preview===dialog)preview=null;};dialog.showModal();
 }
 async function removeMedia(id){
  if(!active||!s||!canWrite()||locked()||s.commit)return;
  s.media=s.media.filter(m=>m.id!==id);for(const t of s.turns)if(t.mediaIds)t.mediaIds=t.mediaIds.filter(m=>m!==id);
  await persist();redraw();if(hasContent(s))await organiseNow();
 }
 async function send(){
  remember();const text=s.input.trim();if(!text||locked()||s.commit)return;
  // Clear the box before awaiting so a second tap cannot resend the same words.
  const box=root.querySelector('#intake-answer');if(box)box.value='';
  if(s.text.length+text.length>maxText){s.error='内容较长，请精简后再发送。';redraw();return;}
  s.turns.push({id:crypto.randomUUID(),role:'me',text});s.text=transcriptOf(s.turns);s.input='';s.panel=false;
  await persist();redraw();await organiseNow();
 }
 async function decline(){
  const d=s.review?.nextDimension;if(!d)return;
  if(!s.declined.includes(d))s.declined.push(d);s.turns.push({id:crypto.randomUUID(),role:'me',kind:'decline',dimension:d});s.review.basis='';s.panel=false;
  await persist();await organiseNow();
 }
 async function action(e){
  if(!active||!s||!canWrite())return;
  const choice=e.target.closest('[data-review-choice]');
  if(choice&&s?.review&&!choice.disabled&&!locked()&&!s.commit){const field=choice.dataset.reviewChoice;s.review.fields[field]=choice.dataset.value;markEdited(field);await persist();redraw();return;}
  if(!active||!s)return;
  const record=e.target.closest('#intake-record');if(record){if(!record.disabled)await toggleRecording();return;}
  if(e.target.closest('[data-voice=cancel]')){talk.cancel();s.input=s.voiceBase;s.voiceBase='';await persist();redraw();return;}
  const b=e.target.closest('[data-intake]');if(!b||b.disabled)return;const a=b.dataset.intake;
  if(a==='preview'){showPreview(b.dataset.id);return;}
  if(a==='toggle-card'){s.cardOpen=!s.cardOpen;redraw();if(s.cardOpen)root.querySelector('.intake-review')?.scrollIntoView?.({block:'start',behavior:'smooth'});return;}
  if(locked()||s.commit)return;remember();
  if(a==='album'||a==='document'){root.querySelector('#intake-'+a).click();return;}
  if(a==='camera'){s.panel=false;await persist();redraw();await camera.open();return;}
  if(a==='send'){await send();return;}
  if(a==='mode'){mode=mode==='voice'?'text':'voice';modeStore.set(mode);s.panel=false;await persist();redraw();if(mode==='text')root.querySelector('#intake-answer')?.focus();return;}
  if(a==='redo'){s.input='';s.audio='';s.audioText='';s.voiceBase='';s.error='';await persist();redraw();await toggleRecording();return;}
  if(a==='decline'){await decline();return;}
  if(a==='retry-organise'){await organiseNow();return;}
  if(a==='retry-speech'){await transcribe(s.audio);return;}
  if(a==='edit'){s.editing=b.dataset.id;redraw();root.querySelector('#intake-edit')?.focus();return;}
  if(a==='cancel-edit'){s.editing=null;redraw();return;}
  if(a==='add-item'&&s.review){const item={id:crypto.randomUUID(),topic:b.dataset.topic,text:''};s.review.items.push(item);markEdited('items');await persist();redraw();root.querySelector(`[data-item="${item.id}"]`)?.focus();return;}
  if(a==='item-certainty'||a==='item-local'){const item=s.review?.items.find(i=>i.id===b.dataset.id);if(item){if(a==='item-local')item.shared=item.shared===false;else item.certainty=nextCertainty[item.certainty||certaintyOf(item.text,item.topic)];markEdited('items');}}
  if(a==='restart'){if(!confirm('清空这次的对话和素材，重新开始？'))return;epoch++;s=empty();await persist();redraw();return;}
  if(a==='remove-item'&&s.review){s.review.items=s.review.items.filter(i=>i.id!==b.dataset.id);markEdited('items');}
  if(a==='attachments')s.panel=!s.panel;
  if(a==='discard-audio'){s.audio='';s.audioText='';s.voiceBase='';s.error='';}
  if(a==='sample'&&exampleMode){try{const response=await fetch('./assets/orange.jpg');if(!response.ok)throw Error('示例照片暂不可用');await addMedia([{kind:'photo',file:await response.blob(),name:'示例照片'}]);}catch(err){s.error=err.message;redraw();}return;}
  await persist();redraw();
 }
 async function saveEdit(form){
  const t=s.turns.find(t=>t.id===form.dataset.edit),text=form.querySelector('#intake-edit').value.trim();
  if(!t||locked()||s.commit)return;s.editing=null;
  if(!text||text===t.text){redraw();return;}
  t.text=text;s.text=transcriptOf(s.turns);await persist();redraw();await organiseNow();
 }
 function markEdited(field){if(!s.review.edited.includes(field))s.review.edited.push(field);}
 // The AI reply acknowledges what was newly understood, then asks about the next missing dimension.
 function replyFor(prior,r){
  const before=prior?.coverage||{},f=r.fields;
  const said=Object.keys(dimensionLabels).filter(d=>r.coverage[d]==='covered'&&before[d]!=='covered').map(d=>d==='species'?speciesLabels[f.species]:d==='sex'?sexLabels[f.sex]:d==='age'&&f.age?f.age:dimensionLabels[d]);
  const ack=said.length?`记下了：${said.join('、')}。`:'';
  if(r.nextQuestion)return ack+r.nextQuestion;
  return Object.keys(r.coverage).length?`${ack||'好的。'}都记下了，核对一下档案，没问题就入档。`:`${ack}整理好了，核对一下档案就可以入档。`;
 }
 async function organise(saving,ticket){
  const images=saving.media.filter(m=>m.kind!=='video'&&!m.dataUrl.startsWith('data:application/pdf')).slice(0,5).map(m=>({kind:m.kind,dataUrl:m.analysisData||m.dataUrl}));
  for(const m of saving.media.filter(m=>m.kind==='video'))for(const dataUrl of m.frames.slice(0,5-images.length))images.push({kind:'video',dataUrl});
  const prior=saving.review,confirmedFields=prior?Object.fromEntries(prior.edited.filter(field=>field in prior.fields).map(field=>[field,prior.fields[field]])):{};
  const latestText=prior&&saving.text.startsWith(prior.text)?saving.text.slice(prior.text.length).trim().slice(0,4000):'';
  // declined is only sent once used, so servers without guided intake keep accepting the request.
  const d=saving.text.trim()||images.length?await api.draftIntake({text:saving.text,images,confirmedFields,latestText,...(saving.declined.length?{declined:saving.declined}:{})}):{};
  if(!active||epoch!==ticket||s!==saving)return false;
  const corrected=new Set((d.corrections||[]).map(c=>c.field));
  saving.review={basis:basisOf(saving),text:saving.text,fields:{name:d.name||'',species:d.species||'unknown',sex:d.sex||'unknown',age:d.age||'',description:d.description||'',character:d.character||''},edited:prior?prior.edited.filter(field=>!corrected.has(field)):[],uncertainties:d.uncertainties||[],nextQuestion:d.nextQuestion||'',nextDimension:d.nextDimension||'',coverage:d.coverage||{},ocrText:d.ocrText||''};
  for(const field of saving.review.edited)if(field in prior.fields)saving.review.fields[field]=prior.fields[field];
  // Items the rescuer already edited stay as written; newly organised sentences are added after them.
  // Sentences the organiser produced before are remembered, so a rescuer's rewrite or deletion is not undone.
  const organised=itemsFrom(saving.review.fields.description),seen=prior?.seen||[];
  saving.review.items=prior?.edited.includes('items')?[...prior.items,...organised.filter(i=>!seen.includes(i.text)&&!prior.items.some(p=>p.text===i.text))]:organised;
  saving.review.seen=[...new Set([...seen,...organised.map(i=>i.text)])];
  saving.turns.push({id:crypto.randomUUID(),role:'ai',text:replyFor(prior,saving.review),dimension:saving.review.nextDimension});
  return true;
 }
 async function organiseNow(){
  if(!active||!s||s.commit||locked()||!hasContent(s))return;
  const saving=s,savingOwner=owner,ticket=epoch;s.busy=true;s.error='';redraw();await persist();
  try{if(!await organise(saving,ticket))return;}
  catch{if(s!==saving||owner!==savingOwner||epoch!==ticket)return;saving.error='暂时没能整理，内容都还在，可以重新整理。';}
  saving.busy=false;await persist(saving,savingOwner);if(active&&s===saving)redraw();
 }
 async function submit(e){
  if(!active||!canWrite())return;
  if(e.target.dataset?.edit){e.preventDefault();e.stopImmediatePropagation();await saveEdit(e.target);return;}
  if(e.target.id!=='intake-confirm')return;e.preventDefault();e.stopImmediatePropagation();if(locked()||!canSave())return;
  const saving=s,savingOwner=owner,ticket=epoch;s.busy=true;s.error='';s.panel=false;redraw();await persist();
  try{
   if(!saving.commit){
    // A guided server stores the card's notes as reviewed; older servers receive the description only.
    const notes=Object.keys(saving.review.coverage).length?saving.review.items.filter(i=>i.text.trim()).map(i=>({topic:i.topic,quote:i.text.trim(),certainty:i.certainty||certaintyOf(i.text,i.topic),shared:i.shared!==false})):[];
    const f=saving.review.fields,photos=saving.media.filter(m=>m.kind==='photo').map(m=>m.dataUrl),video=saving.media.find(m=>m.kind==='video');
    saving.commit={name:f.name.trim()||temporaryName(f.species,saving.createdAt),profile:{species:f.species,description:notes.length?descriptionOf(sharedItems(saving.review.items)):descriptionOf(saving.review.items)||saving.text.trim(),age:f.age.trim(),character:f.character.trim(),sex:f.sex},published:false,text:saving.text,ocrText:saving.review.ocrText,photos:photos.length?photos:video?[video.frames[0]]:[],documents:saving.media.filter(m=>m.kind==='document').map(({name,dataUrl})=>({name:name||'材料图片',dataUrl})),...(video?{video:video.dataUrl}:{}),...(notes.length?{notes}:{})};
    if(new TextEncoder().encode(JSON.stringify(saving.commit)).length>20*1024*1024){saving.commit=null;throw Error('素材总量超过限制，请移除部分素材后重试。');}
    await persist();if(!active||epoch!==ticket||s!==saving)return;redraw();
   }
   saving.result||=await api.commitIntake(saving.commit,saving.key);
   if(s!==saving||owner!==savingOwner||epoch!==ticket){
    const stored=await draftStore.load(savingOwner);
    if(stored?.key===saving.key&&stored.commit&&!stored.result)await draftStore.save(savingOwner,{...stored,result:saving.result});
    if(owner===savingOwner&&s?.key===saving.key&&s.commit){s.result=saving.result;if(active)redraw();}
    return;
   }
   await persist(saving,savingOwner);
   await onDone(saving.result);await draftStore.remove(savingOwner);if(s===saving){s=null;active=false;}
  }catch(err){
   if(s!==saving||owner!==savingOwner||epoch!==ticket)return;
   if(err.message==='EXAMPLE_STORAGE_FULL'){saving.commit=null;saving.error='本机示例存储空间不足，内容仍保留在草稿。请移除部分素材后重试。';}
   else if(saving.commit&&['INVALID_DOCUMENT','INVALID_MEDIA','INVALID_INPUT','EMPTY_INTAKE','FST_ERR_CTP_BODY_TOO_LARGE'].includes(err.message)){saving.commit=null;saving.error=err.message==='INVALID_DOCUMENT'?'材料无法读取，请移除后重新选择 PDF 或图片。':'素材或文字未能通过检查，请调整后重试。';}
   else saving.error=saving.result?'档案已建立，暂时无法打开，请重试。':saving.commit?'保存结果尚未确认，内容已保留。请重试，不会重复建档。':err.message?.includes('素材总量')?err.message:'暂时未能入档，内容已保留，请重试。';
   saving.busy=false;await persist(saving,savingOwner);if(active&&s===saving)redraw();
  }
 }
 function bind(){
  if(!active||!s)return;
  // A rescuer who left while the AI was replying gets that reply when they come back.
  if(resume){resume=false;if(!s.commit&&!s.audio&&!s.error&&hasContent(s)&&!reviewFresh())queueMicrotask(()=>void organiseNow());}
  const chat=root.querySelector('.intake-chat');if(chat&&!s.cardOpen&&!s.editing)chat.scrollTop=chat.scrollHeight;
  updateRecording();
 }
 root.addEventListener('click',e=>{if(active)void action(e);});
 root.addEventListener('change',e=>{if(!active||!s||e.target.type!=='file'||!['intake-album','intake-document'].includes(e.target.id))return;const kind=e.target.id==='intake-document'?'document':undefined;void addMedia(Array.from(e.target.files||[]).map(file=>({file,kind})));e.target.value='';});
 root.addEventListener('submit',submit,true);
 root.addEventListener('keydown',e=>{if(active&&s&&e.target.id==='intake-answer'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}});
 root.addEventListener('input',e=>{
  const field=e.target.dataset?.reviewField;
  if(field&&active&&s?.review&&!locked()&&!s.commit){s.review.fields[field]=e.target.value;markEdited(field);void persist();return;}
  const item=e.target.dataset?.item&&s?.review?.items.find(i=>i.id===e.target.dataset.item);
  if(item&&active&&!locked()&&!s.commit){item.text=e.target.value;markEdited('items');void persist();return;}
  if(!active||!s||e.target.id!=='intake-answer'||locked()||s.commit)return;remember();if(s.error&&!s.audio)s.error='';void persist();updateControls();const error=root.querySelector('#intake-error');if(error)error.textContent=s.error;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){remember();void persist();if(talk.state.holding)void talk.end();void camera.stop();}});
 window.addEventListener('pagehide',stop);
 // Leaving is only blocked while archiving, recording or capturing; an unfinished AI reply resumes on return.
 return {render,bind,reset,stop,get busy(){return locked()||camera.active;},get blocking(){return (!!s?.busy&&!!s?.commit)||talk.state.holding||talk.state.finishing||camera.active;}};
}
