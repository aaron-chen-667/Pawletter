import {imageData,videoData,toDataURL} from './intake-media.js';
import {createCaptureController} from './capture.js';
import {createPressToTalk} from './press-to-talk.js';
import {createIntakeCamera} from './intake-camera.js';
import {errorMessage} from './online-flow.js';
import {composerIcons as icons,inputModeStore,renderComposer} from './intake-composer.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

// A pet-scoped collection stays editable until the rescuer confirms the whole session.
export function createDailyUI({root,redraw,exampleMode,analyse,createSender,speech,exampleText,onSaved}){
 let s=null,sender=null,active=false,epoch=0,recordingStarted=false,pets=[],mode='voice';
 const recent=[],drafts=new Map();
 const capture=createCaptureController({onChange:update,onError(message){if(s)s.error=message;update();}});
 const talk=createPressToTalk({capture,onChange:update,onSend:transcribe});
 const camera=createIntakeCamera({root,onCapture:async item=>{if(await addMedia([item])===false)throw Error(s?.error||'素材未能添加，请重试。');},onError:message=>{if(active&&s){s.error=message;redraw();}}});
 const pet=()=>pets.find(p=>p.id===s?.petId);
 const locked=()=>!!(s?.analysing||s?.saving||s?.frozen||s?.loading||s?.transcribing||talk.state.holding||talk.state.finishing||sender?.pending);
 const hasInput=()=>!!(s?.text?.trim()||s?.media.length);
 const started=()=>!!(hasInput()||s?.entries.length||s?.audio||s?.replacesId);
 const ready=()=>!locked()&&!s?.audio;
 const button=(label,action,cls='text-button',extra='')=>`<button type="button" class="${cls}" data-daily="${action}" ${locked()?'disabled':''} ${extra}>${label}</button>`;
 const avatar=(p,cls='daily-avatar')=>p?.profile?.photoUrl?`<img class="${cls}" src="${esc(p.profile.photoUrl)}" alt="">`:`<span class="${cls} initial" aria-hidden="true">${esc((p?.name||'?').replace(/^待命名/,'').slice(0,1))}</span>`;
 function select(id,correction=null){
  const key=correction?'correction:'+correction.id:id;
  if(!drafts.has(key))drafts.set(key,{key,petId:id,picking:false,entries:[],text:correction?.text||'',media:[],observedOn:correction?.observedOn||'',local:correction?.shared===false,replacesId:correction?.id||null,original:correction?.text||'',originalDate:correction?.observedOn||'',editing:null,sheet:false,panel:false,voiceReview:false,review:false,saving:false,frozen:false,loading:false,transcribing:false,saved:[],error:'',audio:'',analysing:false,sender:createSender()});
  s=drafts.get(key);sender=s.sender;
 }
 function open({pets:list,petId=null,correction=null}){
  stop();pets=list;epoch++;active=true;mode=inputModeStore.get()==='text'?'text':'voice';
  if(correction||petId)select(correction?.petId||petId,correction);
  else{s={picking:true};sender=null;}
 }
 function stop(){remember();active=false;epoch++;talk.cancel();speech.cancel?.();capture.emergencyStop();void camera.stop();}
 function title(){return s?.picking?'给谁补充？':s?.review?'确认补充':s?.replacesId?'更正这条记录':'补充';}
 function pickerView(){
  const tile=p=>`<button type="button" class="daily-pick" data-daily="pick" data-id="${esc(p.id)}">${avatar(p,'daily-pick-avatar')}<span>${esc(p.name)}</span></button>`;
  const recents=recent.map(id=>pets.find(p=>p.id===id)).filter(Boolean);
  return `<section class="daily-picker">${recents.length?`<h2>最近补充过</h2><div class="daily-pick-grid">${recents.map(tile).join('')}</div>`:''}<div class="daily-pick-grid">${pets.map(tile).join('')}</div></section>`;
 }
 function sheetView(){
  if(!s.sheet)return '';
  const options=[['','不指定日期'],...[0,1,2].map(n=>[daysAgo(n),['今天','昨天',`前天 · ${monthDay(daysAgo(2))}`][n]])];
  return `<div class="daily-sheet" role="dialog" aria-label="发生日期"><h2>发生日期</h2>${options.map(([day,label])=>`<button type="button" class="daily-sheet-option" data-daily="day" data-day="${day}" aria-pressed="${s.observedOn===day}">${label}${s.observedOn===day?icons.check:''}</button>`).join('')}<label class="daily-sheet-option">其他日期<input type="date" id="daily-date" max="${daysAgo(0)}" min="2000-01-01" value="${s.observedOn}"></label></div>`;
 }
 function thumbs(media,editable=false){
  return media.length?`<div class="daily-thumbs">${media.map(m=>`<div class="daily-thumb">${m.kind==='video'?`<video controls playsinline preload="metadata" src="${esc(m.dataUrl)}" ${m.frames?.[0]?`poster="${esc(m.frames[0])}"`:''} aria-label="补充的视频"></video>`:`<img src="${esc(m.dataUrl)}" alt="补充的照片">`}${editable?button(icons.close,'remove-media','daily-thumb-remove',`data-id="${esc(m.id)}" aria-label="移除这份素材"`):''}</div>`).join('')}</div>`:'';
 }
 function entriesView(){
  if(!s.entries.length)return s.replacesId?'':`<div class="intake-bubble ai daily-empty">关于${esc(pet()?.name)}，还有什么想补充的？</div>`;
  return s.entries.map((item,i)=>`<article class="daily-entry${s.editing===item.id?' editing':''}" data-entry="${esc(item.id)}"><div class="intake-bubble me">${item.text?`<p>${esc(item.text)}</p>`:''}${thumbs(item.media)}</div><footer><span>${[item.observedOn?esc(dayLabel(item.observedOn)):'',item.local?'仅本站':'',i<s.saved.length?'已保存':''].filter(Boolean).join(' · ')}</span><div>${button('编辑','edit-entry','text-button',`data-id="${esc(item.id)}" aria-label="编辑第 ${i+1} 条" ${i<s.saved.length?'disabled':''}`)}${!s.replacesId?button('移除','remove-entry','text-button',`data-id="${esc(item.id)}" aria-label="移除第 ${i+1} 条" ${i<s.saved.length?'disabled':''}`):''}</div></footer>${item.pending?'<div class="intake-bubble ai" role="status">Agent 正在理解这条补充…</div>':item.analysis?`<div class="intake-bubble ai daily-agent"><p>${esc(item.analysis.reply)}</p>${item.analysis.nextQuestion?`<p>${esc(item.analysis.nextQuestion)}</p>`:''}</div>`:`<div class="intake-bubble ai"><p>${esc(item.error||'这条内容有变动，需要重新解析。')}</p>${button('重新解析','retry-analysis','text-button',`data-id="${esc(item.id)}"`)}</div>`}</article>`).join('');
 }
 const dockState=()=>talk.state.holding||talk.state.finishing?'rec':mode==='text'?'text':hasInput()||s.audio||s.voiceReview||s.editing?'review':'idle';
 const addButton=()=>button(s.editing?'完成编辑':s.replacesId?'核对更正':'发送','add','intake-send',ready()&&hasInput()?'':'disabled');
 const attachmentButton=()=>s.replacesId?'<span class="intake-pill-space"></span>':button(s.panel?icons.close:icons.plus,'attachments','intake-icon-button',`aria-label="${s.panel?'收起':'更多入口'}" aria-expanded="${!!s.panel}"`);
 function optionsView(){
  return `<div class="daily-options">${button(s.observedOn?esc(dayLabel(s.observedOn)):'日期','sheet','intake-tag daily-date-chip',`aria-expanded="${s.sheet}" aria-label="发生日期：${s.observedOn?esc(dayLabel(s.observedOn)):'未指定'}"`)}${button('仅本站','local',`intake-tag${s.local?' on':''}`,`aria-pressed="${s.local}"`)}${s.loading?'<small role="status">正在读取附件…</small>':''}<span class="daily-spacer"></span>${(mode==='text'?hasInput():dockState()==='review')?attachmentButton():''}</div>`;
 }
 function dockView(){
  const state=dockState(),recording=state==='rec';
  const audio=s.audio?`<div class="intake-audio-recovery"><audio controls src="${esc(s.audio)}"></audio><div>${button('重试转写','retry-speech')}${button('移除录音','discard-audio')}</div></div>`:'';
  const answer=`<textarea id="daily-text" rows="1" maxlength="12000" aria-label="补充内容" placeholder="说说关于它的事…" ${locked()?'readonly':''}>${esc(recording?join(s.text,talk.state.live):s.text)}</textarea>`;
  const panel=s.panel&&!s.replacesId?`<div class="intake-panel">${button(`<span>${icons.album}</span>相册`,'album','intake-panel-item','aria-label="添加图片或视频"')}${button(`<span>${icons.camera}</span>拍摄`,'camera','intake-panel-item','aria-label="拍摄照片或视频"')}</div>`:'';
  const center=`<button type="button" id="daily-record" class="intake-talk-button${talk.state.holding?' recording':''}${state==='review'?' small':''}" aria-label="${talk.state.holding?'结束说话':exampleMode?'试一段示例口述':state==='review'?'接着说':'点击说话'}" aria-pressed="${talk.state.holding}" ${s.analysing||s.saving||s.frozen||s.loading||s.transcribing||talk.state.finishing||sender.pending||s.audio?'disabled':''}>${talk.state.holding?icons.stop:icons.mic}</button>`;
  const common={mode,state,className:'daily-dock daily-composer',attributes:'role="group" aria-label="补充内容输入区"',before:`${s.editing?'<small class="daily-editing-label">编辑这条补充</small>':''}<p class="online-error" id="daily-error" role="alert">${esc(s.error)}</p>${sheetView()}`,audio,preview:thumbs(s.media,true),answer,panel,footer:recording?'':optionsView()};
  if(mode==='text')return renderComposer({...common,left:button(icons.mic,'mode','intake-icon-button','aria-label="切换到语音"'),right:hasInput()?addButton():attachmentButton()});
  if(recording)return renderComposer({...common,caption:'<small id="daily-live" role="status"></small>',left:talk.state.holding?'<button type="button" class="intake-pill" data-daily="cancel-voice">取消</button>':'<span class="intake-pill-space"></span>',center,right:'<span class="intake-pill-space"></span>',hint:talk.state.finishing?'正在转写…':'再点一下结束'});
  return renderComposer({...common,caption:state==='review'?'<small>可以直接改</small>':'',left:button(icons.keyboard,'mode',state==='review'?'intake-pill':'intake-icon-button','aria-label="切换到打字"'),center,right:state==='review'?addButton():attachmentButton(),hint:state==='review'?'点麦克风可以接着说':exampleMode?'点一下试一段示例口述':'点一下开始说'});
 }
 function render(){
  if(!s)return '';
  if(s.picking)return pickerView();
  const p=pet();
  return `<section class="intake-chat-flow daily-flow"><div class="daily-top"><button type="button" class="daily-who" data-daily="change-pet" ${started()||locked()?'disabled':''} aria-label="当前伙伴：${esc(p?.name)}">${avatar(p)}<strong>${esc(p?.name)}</strong></button><span class="daily-spacer"></span>${s.review?button(s.replacesId?'继续编辑':'继续补充','continue'):!s.replacesId?`<button type="button" class="daily-finish" data-daily="review" ${ready()&&(hasInput()||s.entries.length)&&(!s.editing||hasInput())?'':'disabled'}>完成补充</button>`:''}</div><div class="intake-chat daily-body">${s.replacesId?`<p class="daily-original"><small>原来记的${s.originalDate?' · '+esc(dayLabel(s.originalDate)):''}</small><s>${esc(s.original)}</s></p>`:''}${entriesView()}</div>${s.review?`<div class="daily-review-actions"><p class="online-error" role="alert">${esc(s.error)}</p><button type="button" class="button primary full daily-save" data-daily="save" ${s.saving||s.analysing||!s.entries.length||s.entries.some(i=>!i.analysis)?'disabled':''}>${s.saving?'正在保存…':s.frozen?'重试保存':s.replacesId?'确认更正':`确认入档 · ${s.entries.length} 条`}</button></div>`:dockView()}<input hidden id="daily-album" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple></section>`;
 }
 function update(){
  if(!active||!s||s.picking)return;
  const dock=root.querySelector('.daily-dock'),state=dockState();
  if(dock&&dock.dataset.state!==state)dock.outerHTML=dockView();
  const live=root.querySelector('#daily-live');if(live)live.textContent=capture.media.voicePending?'请允许使用麦克风':talk.state.holding?`正在${talk.state.realtime?'听':'录音'} · ${capture.media.audioSeconds} 秒`:'正在转写…';
  if(state==='rec'){const caption=root.querySelector('#daily-text');if(caption)caption.value=join(s.text,talk.state.live);}
  if(mode==='text'){const right=root.querySelector('.intake-bar>[data-daily=add],.intake-bar>[data-daily=attachments]');if(right&&(right.dataset.daily==='add')!==hasInput())right.outerHTML=hasInput()?addButton():attachmentButton();}
  const options=root.querySelector('.daily-options');if(options)options.outerHTML=optionsView();
  const record=root.querySelector('#daily-record');if(record)record.disabled=s.analysing||s.saving||s.frozen||s.loading||s.transcribing||talk.state.finishing||sender.pending||!!s.audio;
  const text=root.querySelector('#daily-text');if(text)text.readOnly=locked();
  const who=root.querySelector('.daily-who');if(who)who.disabled=started()||locked();
  const add=root.querySelector('[data-daily=add]');if(add)add.disabled=!(ready()&&hasInput());
  const review=root.querySelector('[data-daily=review]');if(review)review.disabled=!(ready()&&(hasInput()||s.entries.length)&&(!s.editing||hasInput()));
  for(const el of root.querySelectorAll('[data-daily]'))if(!['save','add','review','change-pet','cancel-voice'].includes(el.dataset.daily))el.disabled=locked()||(['edit-entry','remove-entry'].includes(el.dataset.daily)&&s.entries.findIndex(item=>item.id===el.dataset.id)<s.saved.length);
  const error=root.querySelector('#daily-error');if(error)error.textContent=s.error;
  if(capture.media.voiceRecorder)recordingStarted=true;
  if(recordingStarted&&talk.state.holding&&!capture.media.voicePending&&!capture.media.voiceRecorder&&capture.media.audioUrl)void talk.end();
 }
 function remember(){const el=root.querySelector('#daily-text');if(el&&s&&!s.picking&&!locked())s.text=el.value;}
 function addEntry(){
  if(!ready()||!hasInput())return false;
  const item={id:s.editing||crypto.randomUUID(),text:s.text.trim(),media:s.media,observedOn:s.observedOn,local:s.local};
  if(s.editing){const index=s.entries.findIndex(old=>old.id===s.editing);s.entries=s.entries.map((old,i)=>i===index?item:i>index?{...old,analysis:null}:old);}else s.entries.push(item);
  s.text='';s.media=[];s.observedOn='';s.local=false;s.editing=null;s.sheet=false;s.panel=false;s.voiceReview=false;s.error='';return item;
 }
 async function analyseEntries(){
  const state=s,ticket=epoch;
  if(state.analysing)return false;
  state.analysing=true;state.error='';
  try{
   for(const item of state.entries){
    if(item.analysis)continue;
    item.pending=true;item.error='';redraw();
    const images=item.media.flatMap(m=>m.kind==='video'?(m.frames||[]).map(dataUrl=>({kind:'video',dataUrl})):[{kind:'photo',dataUrl:m.dataUrl}]).slice(0,5);
    // Bound context by both turns and characters, while preserving complete source turns.
    const history=[];let size=item.text.length;
    for(const previous of state.entries.slice(0,state.entries.indexOf(item)).reverse().slice(0,6)){
     const question=previous.analysis?.nextQuestion||'';if(size+previous.text.length+question.length>24000)break;
     size+=previous.text.length+question.length;history.unshift({text:previous.text,question,...(previous.observedOn?{observedOn:previous.observedOn}:{})});
    }
    try{
     const result=await analyse(state.petId,{text:item.text,images,history,...(item.observedOn?{observedOn:item.observedOn}:{}),...(state.replacesId?{replacesId:state.replacesId}:{})});
     if(ticket!==epoch||state!==s||!active)return false;
     if(!result?.reply)throw Error('AI_INVALID_RESPONSE');
     item.analysis=result;
    }catch(e){item.error=errorMessage(e);throw e;}
    finally{item.pending=false;}
   }
   return true;
  }catch(e){if(ticket===epoch&&state===s)state.error=errorMessage(e);return false;}
  finally{state.analysing=false;if(ticket===epoch&&state===s&&active){redraw();root.querySelector('.daily-body')?.lastElementChild?.scrollIntoView?.({block:'nearest'});}}
 }
 async function toggleRecording(){
  if(!active||!s||s.analysing||s.saving||s.frozen||s.loading||sender.pending||talk.state.finishing)return;
  if(talk.state.holding){await talk.end();return;}
  if(s.audio)return;remember();
  if(exampleMode){s.text=join(s.text,exampleText(pet()?.name));s.voiceReview=true;redraw();return;}
  s.error='';recordingStarted=false;await talk.start(0);
  if(active&&talk.state.holding&&!capture.media.voiceRecorder){await talk.end();if(!s.error)s.error='没有开始录音，请允许麦克风或直接输入文字。';redraw();}
 }
 async function transcribe(url){
  if(!active||exampleMode)return;const ticket=epoch,state=s;s.error='';
  try{
   const audio=url.startsWith('data:')?url:await toDataURL(await(await fetch(url)).blob());
   if(ticket!==epoch||state!==s)return;s.audio=audio;s.voiceReview=true;redraw();
   s.transcribing=true;update();const result=await speech.transcribe(audio);if(ticket!==epoch||state!==s||!result)return;
   if(result.error)s.error=result.error;else{s.text=join(s.text,result.text);s.audio='';}
  }catch{if(ticket===epoch&&state===s)s.error='这段录音未能转写，请重试或直接输入。';}
  finally{state.transcribing=false;if(ticket===epoch&&state===s&&active)redraw();}
 }
 async function addMedia(items){
  if(!active||!s||locked())return false;remember();const ticket=epoch,state=s;s.error='';s.loading=true;redraw();
  try{
   const added=[];
   for(const item of items){
    const file=item.file,kind=file?.type.startsWith('video/')||item.kind==='video'?'video':'photo';
    if([...s.media,...added].filter(m=>m.kind===kind).length>=(kind==='video'?1:3))throw Error(kind==='video'?'每条可添加一段视频，可以分条继续补充。':'每条最多添加 3 张照片，可以分条继续补充。');
    const data=kind==='video'?await videoData(file):{dataUrl:item.dataUrl||await imageData(file)};
    added.push({id:crypto.randomUUID(),kind,...data});
   }
   if(ticket!==epoch||state!==s)return false;s.media.push(...added);s.panel=false;s.voiceReview=true;return true;
  }catch(err){if(ticket===epoch&&state===s)s.error=err.message;return false;}
  finally{state.loading=false;if(ticket===epoch&&state===s&&active)redraw();}
 }
 async function save(){
  if(!s.review||s.saving||s.analysing||!s.entries.length||s.entries.some(i=>!i.analysis))return;
  const ticket=epoch,state=s;s.saving=true;s.frozen=true;s.error='';redraw();
  try{
   while(s.saved.length<s.entries.length){
    const item=s.entries[s.saved.length],video=item.media.find(m=>m.kind==='video');
    const result=await sender.send({petId:s.petId,text:item.text,shareWithAgent:!item.local,replacesId:s.replacesId||undefined,observedOn:item.observedOn||undefined,photos:item.media.filter(m=>m.kind==='photo').map(m=>m.dataUrl),...(video?{video:video.dataUrl}:{})});
    if(ticket!==epoch||state!==s)return;s.saved.push(result);
   }
   recent.splice(0,recent.length,...[s.petId,...recent.filter(id=>id!==s.petId)].slice(0,3));
   await onSaved({...s.saved.at(-1),ids:s.saved.map(r=>r.id)});drafts.delete(state.key);
  }catch(e){if(ticket===epoch&&state===s){s.frozen=sender.pending;s.error=(s.saved.length?`已保存 ${s.saved.length}/${s.entries.length} 条。`:'')+errorMessage(e);}}
  finally{state.saving=false;if(ticket===epoch&&state===s&&active)redraw();}
 }
 async function action(e){
  if(!active||!s)return;
  if(e.target.closest('#daily-record')){if(!e.target.closest('#daily-record').disabled)await toggleRecording();return;}
  if(e.target.closest('[data-daily=cancel-voice]')){talk.cancel();redraw();return;}
  const b=e.target.closest('[data-daily]');if(!b||b.disabled)return;const a=b.dataset.daily;
  if(a==='pick'){if(!pets.some(p=>p.id===b.dataset.id))return;select(b.dataset.id);redraw();return;}
  if(a==='save'){await save();return;}
  if(locked())return;remember();
  if(a==='change-pet'&&!started()){s={picking:true};sender=null;redraw();return;}
  if(a==='mode'){mode=mode==='voice'?'text':'voice';inputModeStore.set(mode);s.panel=false;s.voiceReview=hasInput();redraw();if(mode==='text')root.querySelector('#daily-text')?.focus();return;}
  if(a==='attachments'){s.panel=!s.panel;s.sheet=false;}
  if(a==='review'&&ready()&&(!s.editing||hasInput())){addEntry();if(s.entries.length&&await analyseEntries())s.review=true;else return;}
  if(a==='continue'){s.review=false;if(s.replacesId){const item=s.entries[0];s.text=item.text;s.media=[...item.media];s.observedOn=item.observedOn;s.local=item.local;s.editing=item.id;}}
  if(a==='retry-analysis'){await analyseEntries();return;}
  if(a==='add'){if(addEntry()){if(await analyseEntries()&&s.replacesId)s.review=true;}redraw();return;}
  if(a==='edit-entry'&&ready()){
   if(s.editing===b.dataset.id){root.querySelector('#daily-text')?.focus();return;}
   addEntry();const item=s.entries.find(row=>row.id===b.dataset.id);if(!item)return;
   s.text=item.text;s.media=[...item.media];s.observedOn=item.observedOn;s.local=item.local;s.editing=item.id;s.review=false;s.sheet=false;
  }
  if(a==='remove-entry'&&ready()){const index=s.entries.findIndex(row=>row.id===b.dataset.id);s.entries=s.entries.filter(row=>row.id!==b.dataset.id).map((row,i)=>i>=index?{...row,analysis:null}:row);if(s.editing===b.dataset.id){s.editing=null;s.text='';s.media=[];s.observedOn='';s.local=false;}if(!s.entries.length)s.review=false;}
  if(a==='sheet'){s.sheet=!s.sheet;s.panel=false;}
  if(a==='day'){s.observedOn=b.dataset.day;s.sheet=false;}
  if(a==='local')s.local=!s.local;
  if(a==='album'){root.querySelector('#daily-album').click();return;}
  if(a==='camera'){s.sheet=false;s.panel=false;redraw();await camera.open();return;}
  if(a==='remove-media')s.media=s.media.filter(m=>m.id!==b.dataset.id);
  if(a==='retry-speech'){await transcribe(s.audio);return;}
  if(a==='discard-audio'){s.audio='';s.error='';}
  redraw();
 }
 root.addEventListener('click',e=>{if(active)void action(e);});
 root.addEventListener('input',e=>{if(active&&s&&e.target.id==='daily-text'){s.text=e.target.value;if(mode==='voice')s.voiceReview=true;if(s.error&&!s.audio)s.error='';update();}});
 root.addEventListener('change',e=>{
  if(!active||!s)return;
  if(e.target.id==='daily-date'&&e.target.value>='2000-01-01'&&e.target.value<=daysAgo(0)){s.observedOn=e.target.value;s.sheet=false;redraw();}
  if(e.target.id==='daily-album'){void addMedia(Array.from(e.target.files||[]).map(file=>({file})));e.target.value='';}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){remember();if(talk.state.holding)void talk.end();void camera.stop();}});
 window.addEventListener('beforeunload',e=>{if([...drafts.values()].some(d=>d.text.trim()||d.media.length||d.entries.length||d.audio)){e.preventDefault();e.returnValue='';}});
 return {open,stop,render,title,bind:update,forget(){drafts.clear();recent.length=0;s=null;sender=null;},get blocking(){return !!(s?.analysing||s?.saving||s?.loading||s?.transcribing||talk.state.holding||talk.state.finishing||camera.active);},get started(){return !!s&&!s.picking&&started();}};
}
