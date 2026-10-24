import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createIntakeUI} from '../dist/intake-ui.js';

const clone=value=>structuredClone(value);
const draft=overrides=>({name:'',species:'cat',sex:'unknown',age:'约一岁',character:'',description:'AI 整理后的简介，入档前给救助者核对。',uncertainties:[],nextQuestion:'',ocrText:'',corrections:[],...overrides});
const accountA='station-a:staff-a';
const photo='data:image/jpeg;base64,Y2F0';
function savedDraft(overrides={}){return {version:2,key:'draft-test-key',temporaryName:'待命名 TEST01',text:'',media:[],commit:null,result:null,audio:'',...overrides};}
function memoryStore(){const values=new Map();return {values,async load(key){return values.has(key)?clone(values.get(key)):null;},async save(key,value){values.set(key,clone(value));},async remove(key){values.delete(key);}};}

async function harness(t,{draftIntake=async()=>draft(),commitIntake=async()=>({id:'new-pet'}),draftStore=memoryStore(),getDraftKey=()=>accountA,transcribe=async()=>({text:'这只橘猫还没有名字，左耳有缺口。'})}={}){
 const dom=new JSDOM('<main id="app"></main>',{url:'https://pawletter.invalid/?mode=online&role=station',pretendToBeVisual:true});
 const w=dom.window,root=w.document.querySelector('#app'),previous=new Map(),calls={draft:[],commit:[],done:[],network:[],speech:[]},originalFetch=globalThis.fetch;
 for(const [key,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData,
  fetch:async(...args)=>{if(String(args[0]).startsWith('blob:'))return originalFetch(...args);calls.network.push(args);throw new Error('Tests must not call a real service.');},
  FileReader:class {async readAsDataURL(blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onload();}},
 })){
  previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 w.HTMLElement.prototype.setPointerCapture=()=>{};
 let ui;
 const redraw=()=>{if(ui){root.innerHTML=ui.render();ui.bind();}};
 ui=createIntakeUI({api:{async draftIntake(payload){calls.draft.push(clone(payload));return draftIntake(payload,calls.draft.length);},async commitIntake(payload,key){calls.commit.push({payload:clone(payload),key});return commitIntake(payload,key,calls.commit.length);}},exampleMode:false,root,redraw,onDone:async value=>{calls.done.push(value);},draftStore,getDraftKey,speech:{transcribe:async url=>{calls.speech.push(url);return transcribe(url,calls.speech.length);},cancel(){}}});
 const q=selector=>root.querySelector(selector);
 const until=async(predicate,message='Expected interface state was not reached')=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),message);};
 const click=selector=>{const element=q(selector);assert.ok(element,`Missing ${selector}`);element.click();};
 const submit=()=>{const form=q('#intake-confirm');assert.ok(form,'Missing #intake-confirm');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 const type=value=>{const input=q('#intake-answer');assert.ok(input,'The text area must always be available');input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const restart=async()=>{await ui.reset();redraw();await until(()=>!ui.busy);};
 const organise=async()=>{const before=calls.draft.length;submit();await until(()=>!ui.busy&&q('.intake-review')&&!q('.intake-review.stale'));return calls.draft.length-before;};
 const confirm=async()=>{await organise();submit();};
 const edit=(field,value)=>{const input=q(`[data-review-field=${field}]`);assert.ok(input,`Missing review field ${field}`);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
 t.after(async()=>{await ui.stop();assert.deepEqual(calls.network,[],'No real network requests are allowed');dom.window.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 await restart();return {ui,root,w,q,calls,store:draftStore,until,click,submit,type,redraw,restart,organise,confirm,edit};
}

function recording(t,h){
 const previousRecorder=Object.getOwnPropertyDescriptor(globalThis,'MediaRecorder');
 class Recorder{
  static latest;
  static isTypeSupported(){return true;}
  constructor(){Recorder.latest=this;this.state='inactive';this.mimeType='audio/webm';}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable({data:new Blob(['recorded-audio'])});this.onstop();}
 }
 h.w.MediaRecorder=Recorder;Object.defineProperty(globalThis,'MediaRecorder',{value:Recorder,configurable:true,writable:true});
 Object.defineProperty(h.w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
 t.after(()=>{if(previousRecorder)Object.defineProperty(globalThis,'MediaRecorder',previousRecorder);else delete globalThis.MediaRecorder;});
 return {Recorder,async start(){h.click('#intake-record');await h.until(()=>Recorder.latest?.state==='recording');},async stop(){h.click('#intake-record');await h.until(()=>Recorder.latest?.state==='inactive');}};
}

test('entry exposes one editable record and one confirmation without an intermediate chat',async t=>{
 const h=await harness(t);
 assert.ok(h.q('#intake-answer'));assert.ok(h.q('#intake-record'));
 assert.equal(h.root.querySelectorAll('#intake-confirm').length,1);
 assert.equal(h.q('#intake-confirm button').disabled,true);
 assert.equal(h.q('#intake-send'),null);assert.equal(h.q('.intake-confirm-card'),null);assert.equal(h.q('.intake-review'),null);assert.equal(h.q('[name=published]'),null);
 assert.deepEqual(h.calls.draft,[]);assert.deepEqual(h.calls.commit,[]);
});

test('the first confirmation shows the organised record and only the second one archives what the card shows',async t=>{
 const h=await harness(t,{draftIntake:async()=>draft({nextQuestion:'年龄是估计的吗？',uncertainties:['年龄依据待确认']})});
 h.type('刚接回一只猫。');h.type('它叫法斗吗？不是，暂时没名字。\n体重 2.3kg，年龄大约一岁，尚未核实。');
 const finalText=h.q('#intake-answer').value;
 assert.equal(h.calls.draft.length,0,'Typing must not trigger analysis or save');
 assert.match(h.q('#intake-confirm button').textContent,/整理成档案/);
 assert.equal(await h.organise(),1);
 assert.equal(h.calls.commit.length,0,'Organising must not archive');
 assert.equal(h.calls.draft[0].text,finalText);assert.deepEqual(h.calls.draft[0].images,[]);assert.deepEqual(h.calls.draft[0].confirmedFields,{});
 assert.equal(h.q('[data-review-field=description]').value,draft().description);assert.equal(h.q('[data-review-field=age]').value,'约一岁');
 assert.equal(h.q('[data-review-choice=species][aria-checked=true]').dataset.value,'cat');
 assert.match(h.root.textContent,/年龄依据待确认/);assert.match(h.root.textContent,/年龄是估计的吗/);
 assert.match(h.q('#intake-confirm button').textContent,/确认入档/);
 h.edit('age','约一岁（送来人估计）');h.click('[data-review-choice=sex][data-value=female]');
 h.submit();await h.until(()=>h.calls.done.length===1);
 const payload=h.calls.commit[0].payload;
 assert.equal(payload.simple,undefined);assert.equal(payload.profile.description,draft().description);assert.equal(payload.text,finalText);
 assert.equal(payload.profile.age,'约一岁（送来人估计）');assert.equal(payload.profile.sex,'female');assert.equal(payload.profile.species,'cat');
 assert.equal(payload.published,false);assert.match(payload.name,/^待命名小猫 · \d+月\d+日 \d\d:\d\d$/);assert.deepEqual(payload.photos,[]);
 assert.equal(h.calls.draft.length,1);assert.equal(h.calls.commit.length,1);assert.equal(h.store.values.has(accountA),false);
});

test('changing the text after organising requires re-organising and keeps the fields the rescuer edited',async t=>{
 const h=await harness(t,{draftIntake:async(_payload,n)=>draft({name:n===1?'':'AI 新名字',age:n===1?'约一岁':'AI 不应覆盖手改年龄'})});
 h.type('橘猫，送来的人说大概一岁。');await h.organise();
 h.edit('name','桔子');h.edit('age','两岁左右');
 h.type('橘猫，送来的人说大概一岁。左耳有缺口。');
 assert.ok(h.q('.intake-review.stale'));assert.match(h.q('#intake-confirm button').textContent,/重新整理/);
 assert.equal(await h.organise(),1,'A stale card must be organised again instead of archived');
 assert.equal(h.calls.commit.length,0);
 assert.deepEqual(h.calls.draft[1].confirmedFields,{name:'桔子',age:'两岁左右'});assert.equal(h.calls.draft[1].latestText,'左耳有缺口。');
 h.submit();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.commit[0].payload.name,'AI 新名字','The mock ignores confirmed fields, so the archived name is what the card showed');
});

test('a blank organised description falls back to the rescuer text instead of saving an empty profile',async t=>{
 const h=await harness(t,{draftIntake:async()=>draft({description:'',species:'unknown'})});
 h.type('一只小狗，情况还不清楚。');await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.commit[0].payload.profile.description,'一只小狗，情况还不清楚。');assert.match(h.calls.commit[0].payload.name,/^待命名伙伴/);
});

test('a photo without text can be confirmed without forcing a name or question',async t=>{
 const store=memoryStore();store.values.set(accountA,savedDraft({media:[{id:'photo-1',kind:'photo',dataUrl:photo,name:'橘猫.jpg'}]}));
 const h=await harness(t,{draftStore:store,draftIntake:async()=>draft({species:'unknown',nextQuestion:'它叫什么名字？'})});
 assert.equal(h.q('#intake-answer').value,'');assert.equal(h.q('#intake-confirm button').disabled,false);
 await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.draft[0].images,[{kind:'photo',dataUrl:photo}]);assert.deepEqual(h.calls.commit[0].payload.photos,[photo]);
 assert.equal(h.calls.commit[0].payload.profile.description,draft().description,'Visible appearance organised from the photo is what the card showed');assert.equal(h.calls.commit[0].payload.text,'');assert.equal(h.calls.commit[0].payload.published,false);
});

test('material attachments remain private and are included in the archived record',async t=>{
 const store=memoryStore(),material={id:'doc-1',kind:'document',dataUrl:'data:application/pdf;base64,cGRm',name:'检查记录.pdf'};
 store.values.set(accountA,savedDraft({text:'送来的人说这是检查记录，具体内容尚未核实。',media:[material]}));
 const h=await harness(t,{draftStore:store});
 await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.commit[0].payload.published,false);
 assert.deepEqual(h.calls.commit[0].payload.documents,[{dataUrl:material.dataUrl,name:material.name}]);
 assert.deepEqual(h.calls.commit[0].payload.photos,[]);
});

test('a PDF on its own can be archived without inventing a description or sending it as an image',async t=>{
 const store=memoryStore(),material={id:'doc-only',kind:'document',dataUrl:'data:application/pdf;base64,cGRm',name:'交接记录.pdf'};
 store.values.set(accountA,savedDraft({media:[material]}));
 const h=await harness(t,{draftStore:store});await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.draft.length,0);assert.equal(h.calls.commit[0].payload.profile.description,'');assert.equal(h.calls.commit[0].payload.profile.species,'unknown');assert.deepEqual(h.calls.commit[0].payload.documents,[{dataUrl:material.dataUrl,name:material.name}]);
});

test('an uncertain save retries the identical immutable payload and idempotency key after account changes',async t=>{
 let account=accountA;
 const h=await harness(t,{getDraftKey:()=>account,commitIntake:async(_payload,_key,n)=>{if(n===1)throw new Error('Connection lost after server accepted request');return {id:'saved-once'};}});
 h.type('橘色短毛猫，左耳有一个小缺口，还没有名字。');await h.confirm();await h.until(()=>h.calls.commit.length===1&&!h.ui.busy);
 assert.equal(h.calls.done.length,0);assert.match(h.root.textContent,/重试/);
 await h.ui.stop();account='station-b:staff-b';await h.restart();await h.ui.stop();account=accountA;await h.restart();
 h.submit();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.draft.length,1,'An uncertain commit must not generate a new payload');assert.equal(h.calls.commit.length,2);assert.ok(h.calls.commit[0].key);assert.deepEqual(h.calls.commit[1],h.calls.commit[0]);
});

test('leaving restores each account text and attachments without mixing them',async t=>{
 let account=accountA;const store=memoryStore();store.values.set(accountA,savedDraft({media:[{id:'photo-a',kind:'photo',dataUrl:photo,name:'本站橘猫.jpg'}]}));
 const h=await harness(t,{getDraftKey:()=>account,draftStore:store});h.type('本站第一只橘猫，左耳有小缺口。');await h.ui.stop();
 account='station-b:staff-b';await h.restart();assert.equal(h.q('#intake-answer').value,'');assert.doesNotMatch(h.root.textContent,/本站橘猫/);h.type('另一站的白色小狗。');await h.ui.stop();
 account=accountA;await h.restart();assert.equal(h.q('#intake-answer').value,'本站第一只橘猫，左耳有小缺口。');assert.equal(h.store.values.get(account).media[0].dataUrl,photo);assert.doesNotMatch(h.root.textContent,/另一站的白色小狗/);
});

test('legacy drafts preserve manually corrected text, unsent additions and media during migration',async t=>{
 const store=memoryStore();store.values.set(accountA,{version:1,key:'old-key',temporaryName:'待命名 OLD001',turns:[{role:'user',text:'一只猫，估计一岁。'},{role:'assistant',text:'年龄是怎么知道的？'}],draft:draft({description:'手动核对后的记录：三岁。'}),overrides:{description:'手动核对后的记录：三岁。',age:'三岁'},answer:'补充：今天下午刚到。',media:[{id:'old-photo',kind:'photo',dataUrl:photo,sent:false}],commit:null,result:null});
 const h=await harness(t,{draftStore:store});
 assert.match(h.q('#intake-answer').value,/手动核对后的记录：三岁/);assert.match(h.q('#intake-answer').value,/补充：今天下午刚到/);assert.doesNotMatch(h.q('#intake-answer').value,/年龄是怎么知道的/);
 const finalText=h.q('#intake-answer').value;await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.commit[0].key,'old-key');assert.equal(h.calls.commit[0].payload.text,finalText);assert.equal(h.calls.commit[0].payload.profile.description,draft().description);assert.deepEqual(h.calls.commit[0].payload.photos,[photo]);
});

test('legacy uncertain commits retain their exact request and already-created result',async t=>{
 const store=memoryStore(),commit={name:'旧档案',profile:{species:'cat',description:'旧版确认记录。'},published:false,text:'旧版来源文字。',photos:[photo]};
 store.values.set(accountA,{version:1,key:'old-commit-key',temporaryName:'旧档案',turns:[],answer:'',media:[],commit,result:{id:'already-created'},draft:draft()});
 const h=await harness(t,{draftStore:store});h.submit();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.done,[{id:'already-created'}]);assert.equal(h.calls.commit.length,0);assert.equal(h.calls.draft.length,0);assert.equal(store.values.has(accountA),false);
});

test('legacy unacknowledged commits retry their existing request instead of re-analyzing the draft',async t=>{
 const store=memoryStore(),commit={name:'旧档案',profile:{species:'cat',description:'旧版确认记录。'},published:false,text:'旧版来源文字。',photos:[photo]};
 store.values.set(accountA,{version:1,key:'old-commit-key',temporaryName:'旧档案',turns:[{role:'user',text:'不能重新生成这份请求'}],answer:'',media:[],commit,result:null,draft:draft()});
 const h=await harness(t,{draftStore:store});h.submit();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.draft.length,0);assert.deepEqual(h.calls.commit,[{payload:commit,key:'old-commit-key'}]);
});

test('analysis failure retains editable input and a subsequent confirmation can retry',async t=>{
 const h=await harness(t,{draftIntake:async(_payload,n)=>{if(n===1)throw Error('Unavailable');return draft();}}),text='今天接来一只橘色短毛猫，左耳缺了一个角。';
 h.type(text);h.submit();await h.until(()=>h.calls.draft.length===1&&!h.ui.busy);
 assert.equal(h.q('#intake-answer').value,text);assert.equal(h.q('#intake-answer').disabled,false);assert.equal(h.calls.commit.length,0);
 const corrected=text+' 它的名字是桔子。';h.type(corrected);await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.draft.length,2);assert.equal(h.calls.draft[1].text,corrected);assert.equal(h.calls.commit[0].payload.text,corrected);
});

test('example quota failure preserves the draft and permits removing media before retrying',async t=>{
 const store=memoryStore();store.values.set(accountA,savedDraft({text:'需要保留的用户原文。',media:[{id:'large-photo',kind:'photo',name:'大照片.jpg',dataUrl:photo}]}));
 const h=await harness(t,{draftStore:store,commitIntake:async(_body,_key,n)=>{if(n===1)throw Error('EXAMPLE_STORAGE_FULL');return {id:'saved-after-removing-media'};}});
 await h.confirm();await h.until(()=>h.calls.commit.length===1&&!h.ui.busy);
 assert.equal(h.calls.done.length,0);assert.equal(h.q('#intake-answer').value,'需要保留的用户原文。');assert.equal(h.q('#intake-answer').readOnly,false);assert.equal(store.values.get(accountA).commit,null);assert.equal(store.values.get(accountA).media.length,1);
 h.click('[data-intake=remove-media]');await h.until(()=>!h.q('[data-intake=remove-media]'));await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.commit[1].payload.photos,[]);assert.equal(h.calls.commit[1].payload.text,'需要保留的用户原文。');
});

test('a double confirmation while persistence is pending performs one analysis and one save',async t=>{
 const store=memoryStore(),save=store.save;store.save=async(key,value)=>{await new Promise(resolve=>setTimeout(resolve,20));await save(key,value);};
 const h=await harness(t,{draftStore:store});h.type('橘猫，左耳缺了一个角。');h.submit();h.submit();await h.until(()=>h.q('.intake-review')&&!h.ui.busy);
 assert.equal(h.calls.draft.length,1);assert.equal(h.calls.commit.length,0);
 h.submit();h.submit();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.draft.length,1);assert.equal(h.calls.commit.length,1);
});

test('tapping the microphone transcribes, organises the answer without saving and leaves the transcript editable',async t=>{
 const h=await harness(t),mic=recording(t,h);h.type('已有手打文字。');
 await mic.start();assert.equal(h.ui.busy,true);assert.equal(h.q('#intake-confirm button').disabled,true);
 await mic.stop();await h.until(()=>h.calls.speech.length===1&&h.calls.draft.length===1&&!h.ui.busy);
 assert.ok(h.q('.intake-review'),'A finished spoken answer is organised so the guide can ask the next question');assert.equal(h.calls.commit.length,0);assert.match(h.calls.speech[0],/^data:audio\/webm;base64,/);
 assert.match(h.q('#intake-answer').value,/已有手打文字/);assert.match(h.q('#intake-answer').value,/这只橘猫还没有名字/);
 const corrected='已有手打文字。\n更正：它叫桔子，右耳有缺口。';h.type(corrected);await h.confirm();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.commit[0].payload.text,corrected);assert.equal(h.calls.commit[0].payload.profile.description,draft().description);
});

test('live recognition appears in the same text area and final transcription replaces only the new spoken segment',async t=>{
 const h=await harness(t,{transcribe:async()=>({text:'正式转写：它叫桔子，右耳有缺口。'})}),mic=recording(t,h);
 class Recognition{static latest;constructor(){Recognition.latest=this;}start(){}abort(){}}
 h.w.SpeechRecognition=Recognition;
 h.type('用户之前手动改好的文字。');await mic.start();
 Recognition.latest.onresult({results:[[{transcript:'中间转写：它叫橘子。'}]]});
 assert.equal(h.q('#intake-answer').value,'用户之前手动改好的文字。\n中间转写：它叫橘子。');
 assert.equal(h.calls.draft.length,0);assert.equal(h.calls.commit.length,0);
 await mic.stop();await h.until(()=>h.calls.speech.length===1&&!h.ui.busy);
 assert.equal(h.q('#intake-answer').value,'用户之前手动改好的文字。\n正式转写：它叫桔子，右耳有缺口。');
 assert.doesNotMatch(h.q('#intake-answer').value,/中间转写/);
});

test('failed transcription retains playable audio and retries the same recording without auto-saving',async t=>{
 const h=await harness(t,{transcribe:async(_url,n)=>n===1?{error:'语音服务暂时不可用，录音已保留。'}:{text:'这只猫今天刚到，左耳有缺口。'}}),mic=recording(t,h);
 await mic.start();await mic.stop();await h.until(()=>h.calls.speech.length===1&&!h.ui.busy);
 assert.equal(h.calls.draft.length,0);assert.match(h.root.textContent,/语音服务暂时不可用/);assert.equal(h.q('audio').getAttribute('src'),h.calls.speech[0]);
 h.click('[data-intake=retry-speech]');await h.until(()=>h.calls.speech.length===2&&!h.ui.busy);
 assert.equal(h.calls.speech[1],h.calls.speech[0]);assert.match(h.q('#intake-answer').value,/这只猫今天刚到/);assert.equal(h.calls.commit.length,0);assert.equal(h.q('audio'),null);
});

test('editing text after transcription failure is preserved when the recording is retried',async t=>{
 const h=await harness(t,{transcribe:async(_url,n)=>n===1?{error:'转写暂时失败'}:{text:'重试得到的补充。'}}),mic=recording(t,h);
 h.type('原来的文字。');await mic.start();await mic.stop();await h.until(()=>h.calls.speech.length===1&&!h.ui.busy);
 h.type('用户重新核对并改好的文字。');h.click('[data-intake=retry-speech]');await h.until(()=>h.calls.speech.length===2&&!h.ui.busy);
 assert.equal(h.q('#intake-answer').value,'用户重新核对并改好的文字。\n重试得到的补充。');assert.equal(h.calls.commit.length,0);
});

test('a late transcript cannot append private speech into another account draft',async t=>{
 let account=accountA,finishSpeech;const response=new Promise(resolve=>{finishSpeech=resolve;});
 const h=await harness(t,{getDraftKey:()=>account,transcribe:()=>response}),mic=recording(t,h);
 await mic.start();await mic.stop();await h.until(()=>h.calls.speech.length===1);await h.ui.stop();account='station-b:staff-b';await h.restart();h.type('新账号的白色小狗。');
 finishSpeech({text:'旧账号的猫叫旧橘子。'});await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.q('#intake-answer').value,'新账号的白色小狗。');assert.equal(h.calls.draft.length,0);assert.equal(h.calls.commit.length,0);assert.doesNotMatch(h.root.textContent,/旧橘子/);
});

test('a late analysis cannot replace or unlock a new confirmation after restoring the draft',async t=>{
 let finishFirst,finishSecond;const first=new Promise(resolve=>{finishFirst=resolve;}),second=new Promise(resolve=>{finishSecond=resolve;});
 const h=await harness(t,{draftIntake:async(_payload,n)=>n===1?first:second});h.type('原先的记录。');h.submit();await h.until(()=>h.calls.draft.length===1);await h.ui.stop();await h.restart();h.type('我重新确认的记录。');h.submit();await h.until(()=>h.calls.draft.length===2);
 finishFirst(draft({name:'过期名字'}));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(h.ui.busy,true);assert.equal(h.calls.commit.length,0);
 finishSecond(draft({name:'当前名字'}));await h.until(()=>h.q('.intake-review')&&!h.ui.busy);assert.equal(h.q('[data-review-field=name]').value,'当前名字');assert.equal(h.calls.commit.length,0);
 h.submit();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.commit.length,1);assert.equal(h.calls.commit[0].payload.name,'当前名字');assert.equal(h.calls.commit[0].payload.text,'我重新确认的记录。');
});

test('an old analysis rejection cannot overwrite the newer same-account draft in local storage',async t=>{
 let rejectAnalysis;const response=new Promise((_resolve,reject)=>{rejectAnalysis=reject;});
 const h=await harness(t,{draftIntake:()=>response});h.type('提交前的旧文字。');h.submit();await h.until(()=>h.calls.draft.length===1);
 await h.ui.stop();await h.restart();const newerText='重新进入后，用户已经核对并修改的新文字。';h.type(newerText);
 await h.until(()=>h.store.values.get(accountA)?.text===newerText);
 rejectAnalysis(Error('The old request failed after the draft was reopened'));await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(h.q('#intake-answer').value,newerText);assert.equal(h.store.values.get(accountA).text,newerText,'Late errors must not persist their obsolete snapshot over the newer draft');
 assert.equal(h.ui.busy,false);assert.equal(h.calls.commit.length,0);
});

test('a delayed commit merges only its result into the latest matching stored draft',async t=>{
 let finishCommit;const response=new Promise(resolve=>{finishCommit=resolve;});
 const h=await harness(t,{commitIntake:()=>response});h.type('已提交的原始文字。');await h.confirm();await h.until(()=>h.calls.commit.length===1);await h.ui.stop();await h.restart();
 const latest=clone(h.store.values.get(accountA));latest.text='另一次恢复已经保留的较新草稿文字。';latest.media=[{id:'later-material',kind:'document',name:'后来补存的材料.pdf',dataUrl:'data:application/pdf;base64,cGRm'}];
 await h.store.save(accountA,latest);finishCommit({id:'saved-before-reopen'});await h.until(()=>h.store.values.get(accountA)?.result?.id==='saved-before-reopen');
 const stored=h.store.values.get(accountA);assert.equal(stored.text,latest.text);assert.deepEqual(stored.media,latest.media);assert.deepEqual(stored.commit,latest.commit);assert.equal(stored.key,latest.key);
 assert.equal(h.calls.done.length,0,'An obsolete request must not navigate the restored UI');assert.equal(h.calls.commit.length,1);
});

test('a late same-account commit result survives leaving again and opens without another commit',async t=>{
 let finishCommit;const response=new Promise(resolve=>{finishCommit=resolve;});
 const h=await harness(t,{commitIntake:()=>response});h.type('同一账号已提交的记录。');await h.confirm();await h.until(()=>h.calls.commit.length===1);await h.ui.stop();await h.restart();
 finishCommit({id:'same-owner-created'});await h.until(()=>h.store.values.get(accountA)?.result?.id==='same-owner-created');
 await h.ui.stop();assert.equal(h.store.values.get(accountA).result?.id,'same-owner-created','Leaving the restored UI must not overwrite the confirmed result with null');
 await h.restart();h.submit();await h.until(()=>h.calls.done.length===1);assert.deepEqual(h.calls.done,[{id:'same-owner-created'}]);assert.equal(h.calls.commit.length,1);
});

test('a commit completed after an account switch stays with its original owner and is not duplicated',async t=>{
 let account=accountA,finishCommit;const response=new Promise(resolve=>{finishCommit=resolve;});
 const h=await harness(t,{getDraftKey:()=>account,commitIntake:()=>response});h.type('A站的私有记录。');await h.confirm();await h.until(()=>h.calls.commit.length===1);
 await h.ui.stop();account='station-b:staff-b';await h.restart();h.type('B站正在录入。');finishCommit({id:'saved-a'});await h.until(()=>h.store.values.get(accountA)?.result?.id==='saved-a');
 assert.equal(h.q('#intake-answer').value,'B站正在录入。');assert.equal(h.calls.done.length,0);assert.equal(h.calls.commit.length,1);
 await h.ui.stop();account=accountA;await h.restart();h.submit();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.done,[{id:'saved-a'}]);assert.equal(h.calls.commit.length,1);
});

test('overlong text stays editable and can be shortened before retrying confirmation',async t=>{
 const h=await harness(t);h.type('猫'.repeat(4001));h.submit();await h.until(()=>!h.ui.busy);
 assert.equal(h.calls.draft.length,0);assert.equal(h.calls.commit.length,0);assert.equal(h.q('#intake-answer').disabled,false);
 const text='它左耳有一个缺口。';h.type(text);await h.confirm();await h.until(()=>h.calls.done.length===1);assert.equal(h.calls.commit[0].payload.text,text);
});

test('the guide shows each dimension, asks one missing item and never asks a skipped one again',async t=>{
 const coverage={species:'covered',age:'covered',sex:'missing',health:'missing',character:'missing',likes:'missing',habits:'missing',diet:'missing'};
 const h=await harness(t,{draftIntake:async payload=>payload.declined?.includes('sex')?draft({coverage:{...coverage,sex:'unknown'},nextDimension:'health',nextQuestion:'它身体怎么样？'}):draft({coverage,nextDimension:'sex',nextQuestion:'它是公的还是母的？'})});
 h.type('橘猫，大概一岁。');await h.organise();
 assert.equal(Object.hasOwn(h.calls.draft[0],'declined'),false,'Servers without guided intake must keep accepting the request');
 assert.equal(h.root.querySelectorAll('.intake-coverage li').length,8);assert.equal(h.root.querySelectorAll('.intake-coverage li.covered').length,2);
 assert.match(h.q('.intake-guide').textContent,/它是公的还是母的/);assert.ok(h.q('.intake-coverage li.current'));
 h.click('[data-intake=decline]');await h.until(()=>h.calls.draft.length===2&&!h.ui.busy);
 assert.deepEqual(h.calls.draft[1].declined,['sex']);assert.match(h.q('.intake-guide').textContent,/它身体怎么样/);assert.match(h.q('.intake-coverage').textContent,/公母 · 不清楚/);
 assert.equal(h.calls.commit.length,0);
 h.submit();await h.until(()=>h.calls.done.length===1);assert.equal(h.calls.draft.length,2,'Archiving is allowed before every dimension is answered');
});
