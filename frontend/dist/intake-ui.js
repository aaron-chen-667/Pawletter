import {imageData,videoData,toDataURL} from './intake-media.js';
import {createCaptureController} from './capture.js';
import {createPressToTalk} from './press-to-talk.js';
import {createOnboardingSpeech} from './onboarding-speech.js';
import {createIntakeDraftStore} from './intake-draft-store.js';
import {createIntakeCamera} from './intake-camera.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg=body=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const icons={
 mic:svg('<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>'),
 plus:svg('<path d="M12 5v14M5 12h14"/>'),
 album:svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 4-6 5 7"/>'),
 camera:svg('<path d="m8 5 2-2h4l2 2h4a2 2 0 0 1 2 2v12H2V7a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="4"/>'),
 file:svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
 stop:svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
};
const join=(a,b)=>[a,b].filter(Boolean).join('\n');
// Example mode only: a canned answer for whichever dimension the guide is asking about.
const exampleAnswers={first:'今天刚接回一只橘猫，还没有名字。年龄大概一岁，送来的人估计的。人靠近时会躲，刚吃了点罐头。',sex:'是只公猫。',health:'身上没看到伤，疫苗和驱虫都还没做，也没绝育。',character:'送来的人说它平时挺黏人，就是怕生，熟了会蹭人。',likes:'喜欢追逗猫棒，摸下巴会呼噜。',habits:'会用猫砂，白天睡得多，晚上比较闹。',diet:'吃猫粮和罐头，喝水正常。'};
const maxText=4000;
const speciesLabels={cat:'猫',dog:'狗',unknown:'不确定'},sexLabels={male:'公',female:'母',unknown:'不确定'};
const fieldLimits={name:80,age:80,character:500,description:4000};
// Same dimensions and asking order as the server organiser: profile fields first, then knowledge topics.
const dimensionLabels={species:'种类',age:'年龄',sex:'公母',health:'健康',character:'性格',likes:'喜好',habits:'习惯',diet:'饮食'};
export function temporaryName(species,at=new Date()){
 const d=new Date(at),pad=n=>String(n).padStart(2,'0');
 return `待命名${species==='cat'?'小猫':species==='dog'?'小狗':'伙伴'} · ${d.getMonth()+1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function createIntakeUI({api,exampleMode,root,redraw,onDone,getDraftKey=()=>exampleMode?'example':'station',draftStore=createIntakeDraftStore(),speech=createOnboardingSpeech()}){
 let s,owner,epoch=0,active=false,recordingStarted=false,organiseAfterSpeech=false,scrollTop=0,preview=null;
 const capture=createCaptureController({onChange:updateRecording,onError(message){if(s)s.error=message;updateRecording();}});
 const talk=createPressToTalk({capture,onChange:updateRecording,onSend:transcribe});
 const camera=createIntakeCamera({root,onCapture:async item=>{if(await addMedia([item])===false)throw Error(s?.error||'素材未能添加，请重试。');},onError:message=>{if(active&&s){s.error=message;redraw();}}});
 function empty(){return {version:2,key:crypto.randomUUID(),createdAt:new Date().toISOString(),media:[],text:'',audio:'',voiceBase:'',audioText:'',review:null,declined:[],commit:null,result:null,busy:false,error:''};}
 // The review card is only valid for the exact text and media it was organised from.
 const basisOf=state=>`${state.text}\u0000${state.media.map(m=>m.id).join(',')}`;
 const reviewFresh=()=>!!s?.review&&s.review.basis===basisOf(s);
 const confirmLabel=()=>s.busy?s.commit?'正在入档…':'正在整理…':s.result?'打开已建立的档案':s.commit?'重试入档':reviewFresh()?'确认入档':s.review?'重新整理':'整理成档案';
 function restore(saved){
  if(saved?.version===2)return {...empty(),...saved,busy:false,menu:false};
  if(saved?.version===1){
   const recorded=saved.overrides?.description??saved.draft?.description??saved.turns?.filter(t=>t.role==='user').map(t=>t.text).join('\n')??'';
   return {...empty(),key:saved.key,media:saved.media||[],text:join(recorded,saved.answer),audio:saved.audio||'',voiceBase:join(recorded,saved.answer),commit:saved.commit||null,result:saved.result||null};
  }
  return empty();
 }
 function persist(current=s,key=owner){
  if(!current||!key)return Promise.resolve();
  return draftStore.save(key,{...current,busy:false,error:'',menu:false}).then(()=>{if(s===current)s.storageError='';}).catch(()=>{
   if(s===current){s.storageError='草稿暂未保存到本机，请暂时不要关闭页面。';const el=root.querySelector('#intake-storage-error');if(active&&el)el.textContent=s.storageError;}
  });
 }
 function remember(){const el=root.querySelector('#intake-answer');if(el&&s&&!talk.state.holding&&!talk.state.finishing)s.text=el.value;}
 async function reset(){
  stop();const ticket=++epoch,key=getDraftKey();if(!key)return;
  if(owner!==key){owner=key;s=null;}
  if(!s){try{const saved=await draftStore.load(key);if(ticket!==epoch)return;s=restore(saved);}catch{if(ticket!==epoch)return;s=empty();s.storageError='草稿存储不可用，请暂时不要关闭页面。';}}
  s={...s,busy:false};active=true;scrollTop=0;
 }
 function stop(){if(active&&s){remember();void persist();}active=false;organiseAfterSpeech=false;epoch++;talk.cancel();speech.cancel();capture.emergencyStop();void camera.stop();preview?.close();preview?.remove();preview=null;}
 const locked=()=>!!s?.busy||talk.state.holding||talk.state.finishing;
 const canSave=()=>s&&(!!s.commit||!!s.text.trim()||s.media.length>0)&&!locked()&&!s.audio&&s.text.length<=maxText;
 function button(label,action,cls='text-button',extra=''){return `<button type="button" class="${cls}" data-intake="${action}" ${locked()||s.commit?'disabled':''} ${extra}>${label}</button>`;}
 function mediaView(){
  if(!s.media.length)return `<button type="button" class="intake-add-empty" data-intake="attachments" aria-expanded="${!!s.menu}" ${locked()||s.commit?'disabled':''}><span class="intake-add-symbol">${icons.plus}</span><span>添加素材</span></button>`;
  return `<div class="intake-material-grid">${s.media.map(m=>`<div class="intake-material-item">${button(m.kind==='document'?`<span class="intake-document-icon">${icons.file}</span><span>${esc(m.name||'材料图片')}</span>`:`<img src="${esc(m.kind==='video'?m.frames?.[0]:m.dataUrl)}" alt="${m.kind==='video'?'视频封面':'伙伴照片'}">${m.kind==='video'?'<span class="intake-video-mark">▶</span>':''}`,'preview','intake-material-preview',`data-id="${esc(m.id)}" aria-label="查看${esc(m.name||'素材')}"`)}${button('×','remove-media','intake-material-remove',`data-id="${esc(m.id)}" aria-label="移除${esc(m.name||'素材')}"`)}</div>`).join('')}${button(icons.plus,'attachments','intake-add-tile',`aria-label="继续添加素材" aria-expanded="${!!s.menu}"`)}</div>`;
 }
 function reviewView(){
  if(!s.review)return '';
  const r=s.review,f=r.fields,off=locked()||!!s.commit,stale=!reviewFresh()&&!s.commit;
  const choices=(field,label,labels)=>`<div class="intake-review-row"><span>${label}</span><div class="intake-segment" role="radiogroup" aria-label="${label}">${Object.entries(labels).map(([value,text])=>`<button type="button" role="radio" aria-checked="${f[field]===value}" data-review-choice="${field}" data-value="${value}" ${off?'disabled':''}>${text}</button>`).join('')}</div></div>`;
  const input=(field,label,placeholder)=>`<label class="intake-review-row"><span>${label}</span><input data-review-field="${field}" value="${esc(f[field])}" placeholder="${esc(placeholder)}" maxlength="${fieldLimits[field]}" ${off?'readonly':''}></label>`;
  return `<section class="intake-review${stale?' stale':''}" aria-labelledby="intake-review-title"><header><h2 id="intake-review-title">将要入档的内容</h2><span id="intake-review-state">${stale?'上方有改动，请重新整理':'可以直接修改'}</span></header>${input('name','名字',temporaryName(f.species,s.createdAt))}${choices('species','种类',speciesLabels)}${choices('sex','性别',sexLabels)}${input('age','年龄','未知')}<label class="intake-review-row stacked"><span>简介</span><textarea data-review-field="description" rows="4" maxlength="${fieldLimits.description}" placeholder="还没有可整理的介绍" ${off?'readonly':''}>${esc(f.description)}</textarea></label>${input('character','长期性格','未知')}${r.uncertainties.length?`<ul class="intake-review-notes" aria-label="待确认">${r.uncertainties.map(u=>`<li>${esc(u)}</li>`).join('')}</ul>`:''}</section>`;
 }
 function guideView(){
  const r=s.review;if(!r||s.commit)return '';
  const coverage=r.coverage||{},chips=Object.entries(dimensionLabels).map(([key,label])=>{const state=coverage[key]||'missing';return `<li class="${state}${key===r.nextDimension?' current':''}">${state==='covered'?'✓ ':''}${label}${state==='unknown'?' · 不清楚':''}</li>`;}).join('');
  const prompt=r.nextQuestion?`<p class="intake-guide-question"><span>想再了解一点</span>${esc(r.nextQuestion)}</p>${r.nextDimension?button('暂时不清楚','decline','intake-decline'):''}`:`<p class="intake-guide-question done">主要情况都记下了，核对下面的档案就可以入档。</p>`;
  return `<section class="intake-guide${reviewFresh()?'':' stale'}" aria-label="AI 引导补充"><ol class="intake-coverage" aria-label="已了解的情况">${chips}</ol>${prompt}</section>`;
 }
 function render(){
  if(!s)return '<p role="status">正在恢复草稿…</p>';
  const old=root.querySelector('.intake-entry-scroll');if(old)scrollTop=old.scrollTop;
  const working=locked(),label=confirmLabel();
  return `<section class="intake-simple-flow"><div class="intake-entry-scroll"><div class="intake-materials">${mediaView()}${s.menu&&!s.commit?`<div class="intake-source-menu">${button(`${icons.album}<span>相册</span>`,'album')}${button(`${icons.camera}<span>拍照 / 录像</span>`,'camera')}${button(`${icons.file}<span>文件</span>`,'document')}</div>${exampleMode?button('添加示例照片','sample','intake-sample-link'):''}`:''}</div><div class="intake-writing"><textarea id="intake-answer" rows="7" maxlength="${maxText}" aria-label="伙伴情况" placeholder="说说它的情况，\n也可以直接输入…" ${working||s.commit?'readonly':''}>${esc(s.text)}</textarea><div class="intake-writing-footer"><span id="intake-live" role="status"></span><span id="intake-count">${s.text.length>3500?`${s.text.length} / ${maxText}`:''}</span></div></div>${guideView()}<div class="intake-record-area"><button type="button" id="intake-record" class="intake-record-button" aria-label="${exampleMode?'试一段示例口述':'点击说话'}" aria-pressed="false" ${working||s.commit||s.audio?'disabled':''}>${icons.mic}</button><span id="intake-record-label">${exampleMode?'试一段示例口述':'点击说话'}</span></div>${reviewView()}${s.audio?`<div class="intake-audio-recovery"><audio controls src="${esc(s.audio)}"></audio><div>${button('重试转写','retry-speech')}${button('移除录音','discard-audio')}</div></div>`:''}<p class="online-error" id="intake-error" role="alert">${esc(s.error)}</p><p class="online-error" id="intake-storage-error" role="status">${esc(s.storageError||'')}</p></div><form id="intake-confirm" class="intake-save-dock"><button class="button primary full" ${canSave()?'':'disabled'}>${label}<span aria-hidden="true">↗</span></button></form><input hidden id="intake-album" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple><input hidden id="intake-document" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></section>`;
 }
 function updateControls(){
  const input=root.querySelector('#intake-answer');if(input)input.readOnly=locked()||!!s.commit;
  const save=root.querySelector('#intake-confirm button');if(save){save.disabled=!canSave();save.firstChild.textContent=confirmLabel();}
  for(const b of root.querySelectorAll('[data-intake],[data-review-choice]'))b.disabled=locked()||!!s.commit;
  for(const field of root.querySelectorAll('[data-review-field]'))field.readOnly=locked()||!!s.commit;
  const card=root.querySelector('.intake-review'),stale=!!s.review&&!reviewFresh()&&!s.commit;
  root.querySelector('.intake-guide')?.classList.toggle('stale',stale);
  if(card){card.classList.toggle('stale',stale);root.querySelector('#intake-review-state').textContent=stale?'上方有改动，请重新整理':'可以直接修改';}
  const count=root.querySelector('#intake-count');if(count)count.textContent=s.text.length>3500?`${s.text.length} / ${maxText}`:'';
 }
 function updateRecording(){
  if(!active||!s)return;
  const el=root.querySelector('#intake-record'),label=root.querySelector('#intake-record-label'),live=root.querySelector('#intake-live');
  if(el){el.classList.toggle('recording',talk.state.holding);el.disabled=s.busy||talk.state.finishing||!!s.commit||!!s.audio;el.setAttribute('aria-pressed',String(talk.state.holding));el.setAttribute('aria-label',talk.state.holding?'结束说话':exampleMode?'试一段示例口述':'点击说话');el.innerHTML=talk.state.holding?icons.stop:icons.mic;}
  if(label)label.textContent=talk.state.holding?'点击结束':talk.state.finishing?'正在转写…':exampleMode?'试一段示例口述':'点击说话';
  if(live)live.textContent=capture.media.voicePending?'请允许使用麦克风':talk.state.holding?`正在${talk.state.realtime?'听':'录音'} · ${capture.media.audioSeconds} 秒${talk.state.realtime?'':' · 结束后转写'}`:talk.state.finishing?'正在整理这段话…':'';
  if(talk.state.holding&&talk.state.live){const value=join(s.voiceBase,talk.state.live);if(s.text!==value){s.text=value;const input=root.querySelector('#intake-answer');if(input){input.value=value;input.scrollTop=input.scrollHeight;}void persist();}}
  const error=root.querySelector('#intake-error');if(error)error.textContent=s.error||'';updateControls();
  if(capture.media.voiceRecorder)recordingStarted=true;
  if(recordingStarted&&talk.state.holding&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)void talk.end();
  if(organiseAfterSpeech&&!locked()){organiseAfterSpeech=false;void organiseNow();}
 }
 async function toggleRecording(){
  if(!active||!s||s.busy||s.commit||talk.state.finishing)return;
  if(talk.state.holding){await talk.end();return;}
  if(s.audio)return;remember();
  if(exampleMode){const answer=exampleAnswers[s.review?.nextDimension]||Object.values(exampleAnswers).find(t=>!s.text.includes(t));if(!answer)return;s.text=join(s.text,answer);await persist();redraw();await organiseNow();return;}
  s.voiceBase=s.text;s.audioText='';s.error='';recordingStarted=false;
  await talk.start(0);
  if(active&&talk.state.holding&&!capture.media.voiceRecorder){await talk.end();if(!s.error)s.error='没有开始录音，请允许麦克风或直接输入文字。';redraw();}
 }
 async function transcribe(url){
  if(!active||exampleMode)return;const ticket=epoch,state=s;
  const retry=url===s.audio,previous=retry?s.audioText:s.text;let heard=false;
  s.busy=true;s.error='';
  try{
   const audio=url.startsWith('data:')?url:await toDataURL(await(await fetch(url)).blob());
   if(!active||ticket!==epoch||state!==s)return;s.audio=audio;if(!retry)s.audioText=previous;await persist();if(!active||ticket!==epoch)return;redraw();
   const result=await speech.transcribe(audio);if(!active||ticket!==epoch||state!==s||!result)return;
   if(result.error)s.error=result.error;
   else {s.text=s.text===s.audioText?join(s.voiceBase,result.text):join(s.text,result.text);s.audio='';s.audioText='';s.voiceBase='';heard=true;if(s.text.length>maxText)s.error='文字较长，请精简到 4000 字以内再入档。';}
  }catch{if(ticket===epoch&&state===s)s.error='这段录音未能转写，请重试或用文字继续。';}
  finally{if(ticket===epoch&&state===s){s.busy=false;await persist();if(active)redraw();}}
  // Finishing a spoken answer lets the AI organise it and ask about the next missing dimension,
  // once the recorder has released its finishing state (see updateRecording).
  if(heard&&!s.error&&ticket===epoch&&state===s){organiseAfterSpeech=true;updateRecording();}
 }
 async function addMedia(items){
  if(!active||!s||locked()||s.commit)return;remember();const ticket=epoch,state=s;s.busy=true;s.error='';s.menu=false;redraw();
  try{
   const added=[];
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
   if(ticket===epoch&&state===s){s.media.push(...added);return true;}
  }catch(err){if(ticket===epoch&&state===s)s.error=err.message;return false;}
  finally{if(ticket===epoch&&state===s){s.busy=false;await persist();if(active)redraw();}}
 }
 function showPreview(id){
  const m=s.media.find(m=>m.id===id);if(!m)return;
  preview?.remove();preview=document.createElement('dialog');preview.className='intake-preview-dialog';
  preview.innerHTML=`<header><strong>${esc(m.name||'素材')}</strong><button type="button" aria-label="关闭预览">×</button></header>${m.kind==='video'?`<video controls autoplay playsinline src="${esc(m.dataUrl)}"></video>`:m.kind==='document'&&m.dataUrl.startsWith('data:application/pdf')?`<object data="${esc(m.dataUrl)}" type="application/pdf"><a href="${esc(m.dataUrl)}" download="${esc(m.name||'材料.pdf')}">下载查看 PDF</a></object>`:`<img src="${esc(m.dataUrl)}" alt="${esc(m.name||'素材')}">`}`;
  document.body.append(preview);const dialog=preview;dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>{dialog.remove();if(preview===dialog)preview=null;};dialog.showModal();
 }
 async function action(e){
  const choice=e.target.closest('[data-review-choice]');
  if(choice&&s?.review&&!choice.disabled&&!locked()&&!s.commit){const field=choice.dataset.reviewChoice;s.review.fields[field]=choice.dataset.value;markEdited(field);await persist();redraw();return;}
  const b=e.target.closest('[data-intake]');if(!active||!s||!b||b.disabled||locked()||s.commit)return;remember();const a=b.dataset.intake;
  if(a==='album'||a==='document'){root.querySelector('#intake-'+a).click();return;}
  if(a==='camera'){s.menu=false;await persist();redraw();await camera.open();return;}
  if(a==='preview'){showPreview(b.dataset.id);return;}
  if(a==='retry-speech'){await transcribe(s.audio);return;}
  if(a==='decline'){const d=s.review?.nextDimension;if(d&&!s.declined.includes(d))s.declined.push(d);s.review.basis='';await organiseNow();return;}
  if(a==='attachments')s.menu=!s.menu;
  if(a==='remove-media')s.media=s.media.filter(m=>m.id!==b.dataset.id);
  if(a==='discard-audio'){s.audio='';s.audioText='';s.voiceBase='';s.error='';}
  if(a==='sample'&&exampleMode){try{const response=await fetch('./assets/orange.jpg');if(!response.ok)throw Error('示例照片暂不可用');await addMedia([{kind:'photo',file:await response.blob(),name:'示例照片'}]);}catch(err){s.error=err.message;redraw();}return;}
  await persist();redraw();
 }
 function markEdited(field){if(!s.review.edited.includes(field))s.review.edited.push(field);}
 // First confirmation organises the record into an editable card; only a fresh card can be archived.
 async function organise(saving,ticket){
  const images=saving.media.filter(m=>m.kind!=='video'&&!m.dataUrl.startsWith('data:application/pdf')).slice(0,5).map(m=>({kind:m.kind,dataUrl:m.analysisData||m.dataUrl}));
  for(const m of saving.media.filter(m=>m.kind==='video'))for(const dataUrl of m.frames.slice(0,5-images.length))images.push({kind:'video',dataUrl});
  const prior=saving.review,confirmedFields=prior?Object.fromEntries(prior.edited.map(field=>[field,prior.fields[field]])):{};
  const latestText=prior&&saving.text.startsWith(prior.text)?saving.text.slice(prior.text.length).trim().slice(0,4000):'';
  // declined is only sent once used, so servers without guided intake keep accepting the request.
  const d=saving.text.trim()||images.length?await api.draftIntake({text:saving.text,images,confirmedFields,latestText,...(saving.declined.length?{declined:saving.declined}:{})}):{};
  if(!active||epoch!==ticket||s!==saving)return false;
  const corrected=new Set((d.corrections||[]).map(c=>c.field));
  saving.review={basis:basisOf(saving),text:saving.text,fields:{name:d.name||'',species:d.species||'unknown',sex:d.sex||'unknown',age:d.age||'',description:d.description||'',character:d.character||''},edited:prior?prior.edited.filter(field=>!corrected.has(field)):[],uncertainties:d.uncertainties||[],nextQuestion:d.nextQuestion||'',nextDimension:d.nextDimension||'',coverage:d.coverage||{},ocrText:d.ocrText||''};
  return true;
 }
 async function organiseNow(){
  if(!active||!s||s.commit||!canSave())return;
  const saving=s,savingOwner=owner,ticket=epoch;s.busy=true;s.error='';s.menu=false;redraw();await persist();
  try{if(!await organise(saving,ticket))return;}
  catch{if(s!==saving||owner!==savingOwner||epoch!==ticket)return;saving.error='暂时未能整理，内容已保留，请重试。';}
  saving.busy=false;await persist(saving,savingOwner);
  if(active&&s===saving){redraw();root.querySelector(saving.error?'#intake-error':'.intake-guide')?.scrollIntoView?.({block:'center',behavior:'smooth'});}
 }
 async function submit(e){
  if(!active||e.target.id!=='intake-confirm')return;e.preventDefault();e.stopImmediatePropagation();if(locked())return;remember();
  if(!canSave()){if(s.text.length>maxText){s.error='文字较长，请精简到 4000 字以内再入档。';redraw();}return;}
  if(!s.commit&&!reviewFresh()){await organiseNow();return;}
  const saving=s,savingOwner=owner,ticket=epoch;s.busy=true;s.error='';s.menu=false;redraw();await persist();
  try{
   if(!saving.commit){
    const f=saving.review.fields,photos=saving.media.filter(m=>m.kind==='photo').map(m=>m.dataUrl),video=saving.media.find(m=>m.kind==='video');
    saving.commit={name:f.name.trim()||temporaryName(f.species,saving.createdAt),profile:{species:f.species,description:f.description.trim()||saving.text.trim(),age:f.age.trim(),character:f.character.trim(),sex:f.sex},published:false,text:saving.text,ocrText:saving.review.ocrText,photos:photos.length?photos:video?[video.frames[0]]:[],documents:saving.media.filter(m=>m.kind==='document').map(({name,dataUrl})=>({name:name||'材料图片',dataUrl})),...(video?{video:video.dataUrl}:{})};
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
   if(err.message==='EXAMPLE_STORAGE_FULL'){saving.commit=null;saving.error='本机示例存储空间不足，内容仍保留在草稿。请减少素材后重试。';}
   else if(saving.commit&&['INVALID_DOCUMENT','INVALID_MEDIA','INVALID_INPUT','EMPTY_INTAKE','FST_ERR_CTP_BODY_TOO_LARGE'].includes(err.message)){saving.commit=null;saving.error=err.message==='INVALID_DOCUMENT'?'材料无法读取，请移除后重新选择 PDF 或图片。':'素材或文字未能通过检查，请调整后重试。';}
   else saving.error=saving.result?'档案已建立，暂时无法打开，请重试。':saving.commit?'保存结果尚未确认，内容已保留。请重试，不会重复建档。':err.message?.includes('素材总量')?err.message:'暂时未能整理入档，内容已保留，请重试。';
   saving.busy=false;await persist(saving,savingOwner);if(active&&s===saving)redraw();
  }
 }
 function bind(){
  if(!active||!s)return;const scroll=root.querySelector('.intake-entry-scroll');if(scroll)scroll.scrollTop=scrollTop;
  const record=root.querySelector('#intake-record');if(record)record.onclick=()=>void toggleRecording();updateRecording();
 }
 root.addEventListener('click',e=>{if(active)void action(e);});
 root.addEventListener('change',e=>{if(!active||!s||e.target.type!=='file'||!['intake-album','intake-document'].includes(e.target.id))return;const kind=e.target.id==='intake-document'?'document':undefined;void addMedia(Array.from(e.target.files||[]).map(file=>({file,kind})));});
 root.addEventListener('submit',submit,true);
 root.addEventListener('input',e=>{
  const field=e.target.dataset?.reviewField;
  if(field&&active&&s?.review&&!locked()&&!s.commit){s.review.fields[field]=e.target.value;markEdited(field);void persist();return;}
  if(!active||!s||e.target.id!=='intake-answer'||locked()||s.commit)return;remember();if(s.error&&s.text.length<=maxText&&!s.audio)s.error='';void persist();updateControls();const error=root.querySelector('#intake-error');if(error)error.textContent=s.error;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){remember();void persist();if(talk.state.holding)void talk.end();void camera.stop();}});
 window.addEventListener('pagehide',stop);
 return {render,bind,reset,stop,get busy(){return locked()||camera.active;}};
}
