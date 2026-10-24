import {imageData,videoData,toDataURL} from './intake-media.js';
import {createCaptureController} from './capture.js';
import {createPressToTalk} from './press-to-talk.js';
import {createIntakeCamera} from './intake-camera.js';
import {errorMessage} from './online-flow.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg=body=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const icons={
 mic:svg('<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>'),
 stop:svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
 plus:svg('<path d="M12 5v14M5 12h14"/>'),
 close:svg('<path d="M6 6l12 12M18 6 6 18"/>'),
 keyboard:svg('<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
 album:svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 4-6 5 7"/>'),
 camera:svg('<path d="m8 5 2-2h4l2 2h4a2 2 0 0 1 2 2v12H2V7a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="4"/>'),
 chevron:svg('<path d="m6 9 6 6 6-6"/>'),
 check:svg('<path d="m5 12 5 5 9-10"/>'),
};
const join=(a,b)=>[a,b].filter(Boolean).join('\n');
const pad=n=>String(n).padStart(2,'0');
const dayOf=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return dayOf(d);};
// "今天 / 昨天 / 前天", otherwise the calendar day; shared with the pet page timeline.
const monthDay=day=>{const [,m,d]=day.split('-').map(Number);return `${m}月${d}日`;};
export function dayLabel(day){
 if(!day)return '';
 const offset=[0,1,2].find(n=>daysAgo(n)===day);return offset===undefined?monthDay(day):['今天','昨天','前天'][offset];
}

// One daily record for one partner: words, photos and a video saved together, dated by when it happened.
export function createDailyUI({root,redraw,exampleMode,sender,speech,exampleText,onSaved}){
 let s=null,active=false,epoch=0,recordingStarted=false,pets=[];
 const recent=[];
 const capture=createCaptureController({onChange:update,onError(message){if(s)s.error=message;update();}});
 const talk=createPressToTalk({capture,onChange:update,onSend:transcribe});
 const camera=createIntakeCamera({root,onCapture:async item=>{if(await addMedia([item])===false)throw Error(s?.error||'素材未能添加，请重试。');},onError:message=>{if(active&&s){s.error=message;redraw();}}});
 const pet=()=>pets.find(p=>p.id===s?.petId);
 const locked=()=>!!s?.saving||talk.state.holding||talk.state.finishing||sender.pending;
 const button=(label,action,cls='text-button',extra='')=>`<button type="button" class="${cls}" data-daily="${action}" ${locked()?'disabled':''} ${extra}>${label}</button>`;
 const avatar=(p,cls='daily-avatar')=>p?.profile?.photoUrl?`<img class="${cls}" src="${esc(p.profile.photoUrl)}" alt="">`:`<span class="${cls} initial" aria-hidden="true">${esc((p?.name||'?').replace(/^待命名/,'').slice(0,1))}</span>`;
 const started=()=>!!(s.text.trim()||s.media.length||s.replacesId);

 function open({pets:list,petId=null,correction=null}){
  stop();pets=list;epoch++;active=true;
  s={petId:correction?.petId||petId||null,picking:!petId&&!correction,text:correction?.text||'',media:[],observedOn:correction?.observedOn||daysAgo(0),local:correction?correction.shared===false:false,replacesId:correction?.id||null,original:correction?.text||'',sheet:false,panel:false,saving:false,error:'',audio:'',voiceBase:''};
 }
 function stop(){active=false;epoch++;talk.cancel();speech.cancel?.();capture.emergencyStop();void camera.stop();}
 function title(){return s?.replacesId?'更正这条记录':s?.picking?'给谁补充？':'补充日常';}

 function pickerView(){
  const tile=p=>`<button type="button" class="daily-pick" data-daily="pick" data-id="${esc(p.id)}">${avatar(p,'daily-pick-avatar')}<span>${esc(p.name)}</span></button>`;
  const recents=recent.map(id=>pets.find(p=>p.id===id)).filter(Boolean);
  return `<section class="daily-picker">${recents.length?`<h2>最近记录过</h2><div class="daily-pick-grid">${recents.map(tile).join('')}</div>`:''}<h2>${recents.length?'全部伙伴':'选择这次记录的伙伴'}</h2><div class="daily-pick-grid">${pets.map(tile).join('')}</div></section>`;
 }
 function sheetView(){
  if(!s.sheet)return '';
  const options=[0,1,2].map(n=>[daysAgo(n),['今天','昨天',`前天 · ${monthDay(daysAgo(2))}`][n]]);
  const custom=!options.some(([day])=>day===s.observedOn);
  return `<div class="daily-sheet" role="dialog" aria-label="这件事发生在"><h2>这件事发生在</h2>${options.map(([day,label])=>`<button type="button" class="daily-sheet-option" data-daily="day" data-day="${day}" aria-pressed="${s.observedOn===day}">${label}${s.observedOn===day?icons.check:''}</button>`).join('')}<label class="daily-sheet-option">选其他日期<input type="date" id="daily-date" max="${daysAgo(0)}" min="2000-01-01" value="${custom?s.observedOn:''}"></label><p>录入时间仍记为现在</p></div>`;
 }
 function cardView(){
  const p=pet(),thumbs=s.media.map(m=>`<div class="daily-thumb">${m.kind==='video'?`<img src="${esc(m.frames?.[0])}" alt="视频封面"><span class="intake-video-mark">▶</span>`:`<img src="${esc(m.dataUrl)}" alt="照片">`}${button(icons.close,'remove-media','daily-thumb-remove',`data-id="${esc(m.id)}" aria-label="移除这份素材"`)}</div>`).join('');
  return `<section class="daily-entry${s.replacesId?' correcting':''}">${s.replacesId?`<p class="daily-original"><small>原来记的（${esc(dayLabel(s.observedOn))}）</small><s>${esc(s.original)}</s></p><small class="daily-change-label">改成</small>`:`<header><strong>${esc(p?.name||'')} · ${esc(dayLabel(s.observedOn))}</strong>${button('仅本站','local',`intake-tag${s.local?' on':''}`,`aria-pressed="${s.local}"`)}</header>`}<textarea id="daily-text" rows="3" maxlength="4000" aria-label="这条日常" placeholder="说说它今天的变化，或直接输入…" ${locked()?'readonly':''}>${esc(s.text)}</textarea>${thumbs?`<div class="daily-thumbs">${thumbs}</div>`:''}</section>`;
 }
 function dockView(){
  const recording=talk.state.holding||talk.state.finishing;
  const talkButton=`<button type="button" id="daily-record" class="intake-talk-button${talk.state.holding?' recording':''}" aria-label="${talk.state.holding?'结束说话':exampleMode?'试一段示例口述':'点击说话'}" aria-pressed="${talk.state.holding}" ${s.saving||talk.state.finishing||sender.pending||s.audio?'disabled':''}>${talk.state.holding?icons.stop:icons.mic}</button>`;
  const audio=s.audio?`<div class="intake-audio-recovery"><audio controls src="${esc(s.audio)}"></audio><div>${button('重试转写','retry-speech')}${button('移除录音','discard-audio')}</div></div>`:'';
  if(recording)return `<div class="intake-composer voice daily-dock" data-state="rec"><div class="intake-caption"><small id="daily-live" role="status"></small><p id="daily-caption">${esc(talk.state.live||'')}</p></div><div class="intake-voice-row">${talk.state.holding?'<button type="button" class="intake-pill" data-daily="cancel-voice">取消</button>':'<span class="intake-pill-space"></span>'}${talkButton}<span class="intake-pill-space"></span></div><p class="intake-voice-hint">${talk.state.finishing?'正在转写…':'再点一下结束'}</p></div>`;
  const panel=s.panel?`<div class="intake-panel">${button(`<span>${icons.album}</span>相册`,'album','intake-panel-item')}${button(`<span>${icons.camera}</span>拍摄`,'camera','intake-panel-item')}${exampleMode?button(`<span>${icons.album}</span>示例照片`,'sample-photo','intake-panel-item'):''}</div>`:'';
  return `<div class="intake-composer voice daily-dock" data-state="idle">${audio}<div class="intake-voice-row">${button(icons.keyboard,'type','intake-icon-button','aria-label="打字输入"')}${talkButton}${s.replacesId?'<span class="intake-pill-space"></span>':button(s.panel?icons.close:icons.plus,'panel','intake-icon-button',`aria-label="${s.panel?'收起':'添加照片或视频'}" aria-expanded="${s.panel}"`)}</div><p class="intake-voice-hint">${exampleMode?'点一下试一段示例口述':'点一下开始说'}</p>${panel}</div>`;
 }
 function render(){
  if(!s)return '';
  if(s.picking)return pickerView();
  const p=pet(),canSave=!!s.text.trim()&&!s.saving&&!talk.state.holding&&!talk.state.finishing&&!s.audio;
  return `<section class="intake-chat-flow daily-flow"><div class="daily-top">${p?`<button type="button" class="daily-who" data-daily="change-pet" ${started()||locked()?'disabled':''} aria-label="当前伙伴：${esc(p.name)}">${avatar(p)}<strong>${esc(p.name)}</strong></button>`:''}<span class="daily-spacer"></span>${button(`${esc(dayLabel(s.observedOn))}${icons.chevron}`,'sheet',`daily-date-chip${s.sheet?' open':''}`,`aria-expanded="${s.sheet}" aria-label="发生时间：${esc(dayLabel(s.observedOn))}，点一下调整"`)}</div><div class="intake-chat daily-body">${cardView()}<p class="online-error" id="daily-error" role="alert">${esc(s.error)}</p><button type="button" class="button primary full daily-save" data-daily="save" ${canSave||sender.pending?'':'disabled'}>${s.saving?'正在保存…':sender.pending?'重试保存':s.replacesId?'保存更正':'保存这条日常'}</button>${s.replacesId?'<p class="online-note">保存后原记录失效，保留更正关系。</p>':''}</div>${sheetView()}${dockView()}<input hidden id="daily-album" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple></section>`;
 }
 function update(){
  if(!active||!s||s.picking)return;
  const dock=root.querySelector('.daily-dock'),state=talk.state.holding||talk.state.finishing?'rec':'idle';
  if(dock&&dock.dataset.state!==state)dock.outerHTML=dockView();
  const live=root.querySelector('#daily-live');if(live)live.textContent=capture.media.voicePending?'请允许使用麦克风':talk.state.holding?`正在${talk.state.realtime?'听':'录音'} · ${capture.media.audioSeconds} 秒`:talk.state.finishing?'正在转写…':'';
  const caption=root.querySelector('#daily-caption');if(caption)caption.textContent=talk.state.live||'';
  const record=root.querySelector('#daily-record');if(record)record.disabled=s.saving||talk.state.finishing||sender.pending||!!s.audio;
  const text=root.querySelector('#daily-text');if(text)text.readOnly=locked();
  const who=root.querySelector('.daily-who');if(who)who.disabled=started()||locked();
  const save=root.querySelector('[data-daily=save]');if(save)save.disabled=!(s.text.trim()&&!locked()&&!s.audio)&&!sender.pending;
  const error=root.querySelector('#daily-error');if(error)error.textContent=s.error;
  if(capture.media.voiceRecorder)recordingStarted=true;
  if(recordingStarted&&talk.state.holding&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)void talk.end();
 }
 function remember(){const el=root.querySelector('#daily-text');if(el&&s&&!locked())s.text=el.value;}
 async function toggleRecording(){
  if(!active||!s||s.saving||sender.pending||talk.state.finishing)return;
  if(talk.state.holding){await talk.end();return;}
  if(s.audio)return;remember();
  if(exampleMode){s.text=join(s.text,exampleText(pet()?.name));redraw();return;}
  s.error='';recordingStarted=false;await talk.start(0);
  if(active&&talk.state.holding&&!capture.media.voiceRecorder){await talk.end();if(!s.error)s.error='没有开始录音，请允许麦克风或直接输入文字。';redraw();}
 }
 // Spoken words are appended to the entry, where they stay editable before saving.
 async function transcribe(url){
  if(!active||exampleMode)return;const ticket=epoch,state=s;
  s.error='';
  try{
   const audio=url.startsWith('data:')?url:await toDataURL(await(await fetch(url)).blob());
   if(ticket!==epoch||state!==s)return;s.audio=audio;redraw();
   const result=await speech.transcribe(audio);if(ticket!==epoch||state!==s||!result)return;
   if(result.error)s.error=result.error;else{s.text=join(s.text,result.text);s.audio='';}
  }catch{if(ticket===epoch&&state===s)s.error='这段录音未能转写，请重试或直接输入。';}
  if(ticket===epoch&&state===s&&active)redraw();
 }
 async function addMedia(items){
  if(!active||!s||locked())return false;remember();const ticket=epoch,state=s;s.error='';s.panel=false;
  try{
   const added=[];
   for(const item of items){
    const file=item.file,kind=file?.type.startsWith('video/')||item.kind==='video'?'video':'photo';
    if([...s.media,...added].filter(m=>m.kind===kind).length>=(kind==='video'?1:3))throw Error(kind==='video'?'一条日常可以带一段视频。':'一条日常最多带 3 张照片。');
    const data=kind==='video'?await videoData(file):{dataUrl:item.dataUrl||await imageData(file)};
    added.push({id:crypto.randomUUID(),kind,...data});
   }
   if(ticket!==epoch||state!==s)return false;s.media.push(...added);return true;
  }catch(err){if(ticket===epoch&&state===s)s.error=err.message;return false;}
  finally{if(ticket===epoch&&state===s&&active)redraw();}
 }
 async function save(){
  remember();if(!s.text.trim()&&!sender.pending)return;
  const ticket=epoch,state=s;s.saving=true;s.error='';redraw();
  try{
   const video=s.media.find(m=>m.kind==='video');
   const result=await sender.send({petId:s.petId,text:s.text,shareWithAgent:!s.local,replacesId:s.replacesId||undefined,observedOn:s.observedOn,photos:s.media.filter(m=>m.kind==='photo').map(m=>m.dataUrl),...(video?{video:video.dataUrl}:{})});
   if(ticket!==epoch||state!==s)return;
   recent.splice(0,recent.length,...[s.petId,...recent.filter(id=>id!==s.petId)].slice(0,3));
   active=false;await onSaved(result);
  }catch(e){if(ticket===epoch&&state===s){s.saving=false;s.error=errorMessage(e);redraw();}}
 }
 async function action(e){
  if(!active||!s)return;
  if(e.target.closest('#daily-record')){if(!e.target.closest('#daily-record').disabled)await toggleRecording();return;}
  if(e.target.closest('[data-daily=cancel-voice]')){talk.cancel();redraw();return;}
  const b=e.target.closest('[data-daily]');if(!b||b.disabled)return;const a=b.dataset.daily;
  if(a==='pick'){s.petId=b.dataset.id;s.picking=false;redraw();return;}
  if(a==='save'){await save();return;}
  if(locked())return;remember();
  if(a==='change-pet'&&!started()){s.picking=true;s.sheet=false;s.panel=false;}
  if(a==='sheet'){s.sheet=!s.sheet;s.panel=false;}
  if(a==='day'){s.observedOn=b.dataset.day;s.sheet=false;}
  if(a==='local')s.local=!s.local;
  if(a==='type'){s.sheet=false;s.panel=false;redraw();root.querySelector('#daily-text')?.focus();return;}
  if(a==='panel'){s.panel=!s.panel;s.sheet=false;}
  if(a==='album'){root.querySelector('#daily-album').click();return;}
  if(a==='camera'){s.panel=false;redraw();await camera.open();return;}
  if(a==='sample-photo'&&exampleMode){try{const response=await fetch('./assets/orange.jpg');if(!response.ok)throw Error('示例照片暂不可用');await addMedia([{kind:'photo',file:await response.blob()}]);}catch(err){s.error=err.message;redraw();}return;}
  if(a==='remove-media')s.media=s.media.filter(m=>m.id!==b.dataset.id);
  if(a==='retry-speech'){await transcribe(s.audio);return;}
  if(a==='discard-audio'){s.audio='';s.error='';}
  redraw();
 }
 root.addEventListener('click',e=>{if(active)void action(e);});
 root.addEventListener('input',e=>{if(active&&s&&e.target.id==='daily-text'){s.text=e.target.value;if(s.error&&!s.audio)s.error='';update();}});
 root.addEventListener('change',e=>{
  if(!active||!s)return;
  if(e.target.id==='daily-date'&&e.target.value&&e.target.value<=daysAgo(0)){s.observedOn=e.target.value;s.sheet=false;redraw();}
  if(e.target.id==='daily-album'){void addMedia(Array.from(e.target.files||[]).map(file=>({file})));e.target.value='';}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){remember();if(talk.state.holding)void talk.end();void camera.stop();}});
 return {open,stop,render,title,bind:update,forget(){recent.length=0;},get blocking(){return !!s?.saving||talk.state.holding||talk.state.finishing||camera.active;},get started(){return !!s&&active&&started();}};
}
