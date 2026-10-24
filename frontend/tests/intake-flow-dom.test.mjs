import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createIntakeUI} from '../dist/intake-ui.js';

const clone=value=>structuredClone(value);
const dimensions=['species','age','sex','health','character','likes','habits','diet'];
const coverageWith=(state='covered',overrides={})=>({...Object.fromEntries(dimensions.map(d=>[d,state])),...overrides});
const draft=overrides=>({name:'',species:'cat',sex:'unknown',age:'约一岁',character:'',description:'橘色短毛猫。今天吃了少量罐头。',uncertainties:[],nextQuestion:'',nextDimension:'',coverage:coverageWith(),ocrText:'',corrections:[],...overrides});
const accountA='station-a:staff-a';
const photo='data:image/jpeg;base64,Y2F0';
function savedDraft(overrides={}){return {version:3,key:'draft-test-key',createdAt:'2026-10-24T06:30:00.000Z',turns:[],media:[],text:'',input:'',review:null,declined:[],commit:null,result:null,audio:'',...overrides};}
function memoryStore(){const values=new Map();return {values,async load(key){return values.has(key)?clone(values.get(key)):null;},async save(key,value){values.set(key,clone(value));},async remove(key){values.delete(key);}};}

async function harness(t,{draftIntake=async()=>draft(),commitIntake=async()=>({id:'new-pet'}),draftStore=memoryStore(),getDraftKey=()=>accountA,transcribe=async()=>({text:'这只橘猫还没有名字，左耳有缺口。'}),mode='text'}={}){
 const modes=[],confirmAnswer={value:true};
 const dom=new JSDOM('<main id="app"></main>',{url:'https://pawletter.invalid/?mode=online&role=station',pretendToBeVisual:true});
 const w=dom.window,root=w.document.querySelector('#app'),previous=new Map(),calls={draft:[],commit:[],done:[],network:[],speech:[]},originalFetch=globalThis.fetch;
 for(const [key,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData,confirm:()=>confirmAnswer.value,
  fetch:async(...args)=>{if(String(args[0]).startsWith('blob:'))return originalFetch(...args);calls.network.push(args);throw new Error('Tests must not call a real service.');},
  FileReader:class {async readAsDataURL(blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onload();}},
 })){
  previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 w.HTMLElement.prototype.setPointerCapture=()=>{};
 let ui;
 const redraw=()=>{if(ui){root.innerHTML=ui.render();ui.bind();}};
 ui=createIntakeUI({api:{async draftIntake(payload){calls.draft.push(clone(payload));return draftIntake(payload,calls.draft.length);},async commitIntake(payload,key){calls.commit.push({payload:clone(payload),key});return commitIntake(payload,key,calls.commit.length);}},exampleMode:false,root,redraw,onDone:async value=>{calls.done.push(value);},draftStore,getDraftKey,modeStore:{get:()=>mode,set:value=>modes.push(value)},speech:{transcribe:async url=>{calls.speech.push(url);return transcribe(url,calls.speech.length);},cancel(){}}});
 const q=selector=>root.querySelector(selector);
 const until=async(predicate,message='Expected interface state was not reached')=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),message);};
 const click=selector=>{const element=q(selector);assert.ok(element,`Missing ${selector}`);element.click();};
 const type=value=>{const input=q('#intake-answer');assert.ok(input,'The input box must always be available');input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const say=async value=>{const before=calls.draft.length;type(value);click('[data-intake=send]');await until(()=>calls.draft.length>before&&!ui.busy);};
 const archive=()=>{const form=q('#intake-confirm');assert.ok(form,'Missing #intake-confirm');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 const bubbles=role=>[...root.querySelectorAll(`.intake-bubble.${role}`)].map(b=>b.textContent.trim());
 const restart=async()=>{await ui.reset();redraw();await new Promise(resolve=>setTimeout(resolve,0));await until(()=>!ui.busy);};
 t.after(async()=>{await ui.stop();assert.deepEqual(calls.network,[],'No real network requests are allowed');dom.window.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 await restart();return {ui,root,w,q,calls,store:draftStore,until,click,type,say,archive,bubbles,redraw,restart,modes,confirmAnswer};
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

test('the conversation opens with a greeting, a chat input bar and nothing to archive yet',async t=>{
 const h=await harness(t);
 assert.deepEqual(h.bubbles('ai'),['先发张照片，或者说说它的情况吧。']);
 assert.ok(h.q('.intake-bar [data-intake=mode][aria-label=切换到语音]'));assert.ok(h.q('#intake-answer'));assert.ok(h.q('.intake-bar [data-intake=attachments]'));
 assert.equal(h.q('#intake-confirm'),null);assert.equal(h.q('.intake-review'),null);assert.equal(h.q('[name=published]'),null);
 assert.deepEqual(h.calls.draft,[]);assert.deepEqual(h.calls.commit,[]);
});

test('typing turns the plus into send, and sending posts the message and the AI reply without archiving',async t=>{
 const h=await harness(t,{draftIntake:async()=>draft({coverage:coverageWith('missing',{species:'covered',age:'covered'}),nextDimension:'sex',nextQuestion:'它是公的还是母的？'})});
 h.type('今天刚接回一只橘猫，大概一岁。');
 assert.ok(h.q('.intake-bar [data-intake=send]'));assert.equal(h.q('.intake-bar [data-intake=attachments]'),null);
 assert.equal(h.calls.draft.length,0,'Typing alone must not organise');
 h.click('[data-intake=send]');await h.until(()=>h.calls.draft.length===1&&!h.ui.busy);
 assert.deepEqual(h.bubbles('me'),['今天刚接回一只橘猫，大概一岁。']);
 assert.equal(h.bubbles('ai').at(-1),'记下了：猫、约一岁。它是公的还是母的？');
 assert.equal(h.q('#intake-answer').value,'');assert.ok(h.q('.intake-bar [data-intake=attachments]'));
 assert.equal(h.calls.draft[0].text,'今天刚接回一只橘猫，大概一岁。');assert.equal(Object.hasOwn(h.calls.draft[0],'declined'),false);
 assert.equal(h.q('.intake-progress').textContent,'档案 2/8');assert.equal(h.q('#intake-confirm'),null);assert.equal(h.calls.commit.length,0);
});

test('every dimension must be answered or marked unsure before archiving, and unsure replies are never re-asked',async t=>{
 const replies=[
  draft({coverage:coverageWith('covered',{sex:'missing',health:'missing'}),nextDimension:'sex',nextQuestion:'它是公的还是母的？'}),
  draft({sex:'male',coverage:coverageWith('covered',{health:'missing'}),nextDimension:'health',nextQuestion:'它身体怎么样？'}),
  draft({sex:'male',coverage:coverageWith('covered',{health:'unknown'})}),
 ];
 const h=await harness(t,{draftIntake:async(_payload,n)=>replies[n-1]});
 await h.say('橘猫，大概一岁。');
 h.click('.intake-progress');assert.match(h.q('.intake-card-left').textContent,/还差 公母、健康/);assert.equal(h.q('#intake-confirm'),null);
 await h.say('是只公猫。');assert.equal(h.bubbles('ai').at(-1),'记下了：公。它身体怎么样？');
 h.click('[data-intake=decline]');await h.until(()=>h.calls.draft.length===3&&!h.ui.busy);
 assert.deepEqual(h.calls.draft[2].declined,['health']);assert.equal(h.calls.draft[2].text,'橘猫，大概一岁。\n是只公猫。','An unsure reply is not part of the rescuer transcript');
 assert.ok(h.bubbles('me').includes('暂时不清楚'));assert.match(h.bubbles('ai').at(-1),/都记下了/);
 assert.equal(h.q('.intake-progress').textContent,'档案 8/8');assert.ok(h.q('#intake-confirm'));
 h.archive();await h.until(()=>h.calls.done.length===1);
 const payload=h.calls.commit[0].payload;
 assert.equal(payload.simple,undefined);assert.equal(payload.text,'橘猫，大概一岁。\n是只公猫。');assert.equal(payload.profile.sex,'male');assert.equal(payload.published,false);
 assert.match(payload.name,/^待命名小猫 · \d+月\d+日 \d\d:\d\d$/);assert.equal(h.store.values.has(accountA),false);
});

test('the card lists organised sentences by knowledge topic and archives exactly what was edited, removed and added',async t=>{
 const h=await harness(t,{draftIntake:async()=>draft({description:'平时喜欢玩逗猫棒。今天吃了少量罐头。左耳有缺口。'})});
 await h.say('橘猫，平时喜欢玩逗猫棒，今天吃了少量罐头，左耳有缺口。');
 const items=()=>[...h.root.querySelectorAll('.intake-item textarea')].map(i=>i.value);
 assert.deepEqual(items(),['平时喜欢玩逗猫棒。','今天吃了少量罐头。','左耳有缺口。']);
 assert.deepEqual([...h.root.querySelectorAll('.intake-topic')].filter(t=>t.querySelector('[data-item]')).map(t=>t.querySelector('h3').textContent),['喜好与互动','饮食与照护','其他观察']);
 const first=h.q('[data-item]');first.value='平时最爱追逗猫棒。';first.dispatchEvent(new h.w.Event('input',{bubbles:true}));
 const other=[...h.root.querySelectorAll('.intake-topic')].at(-1);other.querySelector('[data-intake=remove-item]').click();await h.until(()=>items().length===2);
 h.click('[data-intake=add-item][data-topic=health]');await h.until(()=>items().length===3);
 const added=h.q('[data-intake=add-item][data-topic=health]').closest('.intake-topic').querySelector('[data-item]');added.value='疫苗记录待核实';added.dispatchEvent(new h.w.Event('input',{bubbles:true}));
 const name=h.q('[data-review-field=name]');name.value='桔子';name.dispatchEvent(new h.w.Event('input',{bubbles:true}));
 h.click('[data-review-choice=sex][data-value=female]');
 h.archive();await h.until(()=>h.calls.done.length===1);
 const payload=h.calls.commit[0].payload;
 assert.equal(payload.name,'桔子');assert.equal(payload.profile.sex,'female');
 assert.equal(payload.profile.description,'平时最爱追逗猫棒。今天吃了少量罐头。疫苗记录待核实。');
});

test('card edits survive later answers while newly organised sentences are added',async t=>{
 const h=await harness(t,{draftIntake:async(payload,n)=>n===1?draft({description:'橘色短毛猫。'}):draft({name:'AI 名字',description:'橘色短毛猫。会用猫砂。'})});
 await h.say('橘色短毛猫。');
 const name=h.q('[data-review-field=name]');name.value='桔子';name.dispatchEvent(new h.w.Event('input',{bubbles:true}));
 const item=h.q('[data-item]');item.value='橘色短毛猫，左耳有缺口。';item.dispatchEvent(new h.w.Event('input',{bubbles:true}));
 await h.say('会用猫砂。');
 assert.deepEqual(h.calls.draft[1].confirmedFields,{name:'桔子'});assert.equal(h.calls.draft[1].latestText,'会用猫砂。');
 assert.equal(h.q('[data-review-field=name]').value,'桔子');
 assert.deepEqual([...h.root.querySelectorAll('[data-item]')].map(i=>i.value).sort(),['会用猫砂。','橘色短毛猫，左耳有缺口。'].sort());
});

test('a server without guided coverage still allows archiving after the first reply',async t=>{
 const h=await harness(t,{draftIntake:async()=>{const legacy=draft();delete legacy.coverage;delete legacy.nextDimension;return legacy;}});
 await h.say('橘猫。');
 assert.equal(h.q('.intake-progress'),null);assert.match(h.bubbles('ai').at(-1),/整理好了/);assert.ok(h.q('#intake-confirm'));
});

test('editing a sent message re-organises the corrected transcript',async t=>{
 const h=await harness(t);await h.say('它叫法斗。');
 h.click('.intake-bubble.me[data-intake=edit]');const editor=h.q('#intake-edit');assert.ok(editor);editor.value='暂时没有名字。';
 h.q('form[data-edit]').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
 await h.until(()=>h.calls.draft.length===2&&!h.ui.busy);
 assert.equal(h.calls.draft[1].text,'暂时没有名字。');assert.deepEqual(h.bubbles('me'),['暂时没有名字。']);
});

test('photos in the conversation are sent for analysis and archived privately',async t=>{
 const store=memoryStore();store.values.set(accountA,savedDraft({media:[{id:'photo-1',kind:'photo',dataUrl:photo,name:'橘猫.jpg'}],turns:[{id:'t1',role:'me',mediaIds:['photo-1']}]}));
 const h=await harness(t,{draftStore:store});
 assert.ok(h.q('.intake-bubble.media img'));
 assert.equal(h.calls.draft.length,1,'A photo left without a reply is organised when the page reopens');
 assert.deepEqual(h.calls.draft[0].images,[{kind:'photo',dataUrl:photo}]);
 h.archive();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.commit[0].payload.photos,[photo]);assert.equal(h.calls.commit[0].payload.published,false);
});

test('materials stay private and are archived with the record',async t=>{
 const store=memoryStore(),material={id:'doc-1',kind:'document',dataUrl:'data:application/pdf;base64,cGRm',name:'检查记录.pdf'};
 store.values.set(accountA,savedDraft({media:[material],turns:[{id:'t1',role:'me',mediaIds:['doc-1']}]}));
 const h=await harness(t,{draftStore:store});await h.say('送来的人说这是检查记录，具体内容尚未核实。');
 assert.deepEqual(h.calls.draft[0].images,[]);
 h.archive();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.commit[0].payload.documents,[{dataUrl:material.dataUrl,name:material.name}]);assert.deepEqual(h.calls.commit[0].payload.photos,[]);
});

test('voice mode opens with one big talk button between the keyboard and plus, and remembers switching to typing',async t=>{
 const h=await harness(t,{mode:'voice'});
 assert.ok(h.q('.intake-composer.voice[data-state=idle] .intake-talk-button#intake-record'));assert.equal(h.q('#intake-answer'),null);
 assert.ok(h.q('[data-intake=mode][aria-label=切换到打字]'));assert.ok(h.q('.intake-voice-row [data-intake=attachments]'));
 h.click('[data-intake=mode]');await h.until(()=>h.q('.intake-bar #intake-answer'));assert.deepEqual(h.modes,['text']);
 h.click('[data-intake=mode]');await h.until(()=>h.q('.intake-composer.voice'));assert.deepEqual(h.modes,['text','voice']);
});

test('speaking shows a large caption, then the words stay editable and nothing is sent until send',async t=>{
 const h=await harness(t,{mode:'voice'}),mic=recording(t,h);
 await mic.start();assert.ok(h.q('.intake-composer[data-state=rec] .intake-caption #intake-answer'));assert.ok(h.q('[data-voice=cancel]'));
 await mic.stop();await h.until(()=>h.calls.speech.length===1&&!h.ui.busy&&h.q('[data-state=review]'));
 assert.equal(h.calls.draft.length,0);assert.match(h.calls.speech[0],/^data:audio\/webm;base64,/);
 assert.equal(h.q('#intake-answer').value,'这只橘猫还没有名字，左耳有缺口。');assert.equal(h.q('#intake-answer').readOnly,false);assert.deepEqual(h.bubbles('me'),[]);
 h.type('更正：它叫桔子，右耳有缺口。');h.click('[data-intake=send]');await h.until(()=>h.calls.draft.length===1&&!h.ui.busy);
 assert.equal(h.calls.draft[0].text,'更正：它叫桔子，右耳有缺口。');assert.ok(h.q('[data-state=idle]'),'After sending the big button returns');
});

test('talking again appends to the reviewed words, cancel restores them, and redo starts over',async t=>{
 let n=0;const h=await harness(t,{mode:'voice',transcribe:async()=>({text:['第一段。','第二段。','重新说的一段。'][n++]})}),mic=recording(t,h);
 await mic.start();await mic.stop();await h.until(()=>h.q('[data-state=review]')&&!h.ui.busy);
 await mic.start();await mic.stop();await h.until(()=>h.calls.speech.length===2&&h.q('[data-state=review]')&&!h.ui.busy);
 assert.equal(h.q('#intake-answer').value,'第一段。\n第二段。');
 await mic.start();h.click('[data-voice=cancel]');await h.until(()=>h.q('[data-state=review]'));
 assert.equal(h.q('#intake-answer').value,'第一段。\n第二段。');assert.equal(h.calls.speech.length,2,'A cancelled recording is never transcribed');
 h.click('[data-intake=redo]');await h.until(()=>mic.Recorder.latest?.state==='recording');await mic.stop();await h.until(()=>h.calls.speech.length===3&&h.q('[data-state=review]')&&!h.ui.busy);
 assert.equal(h.q('#intake-answer').value,'重新说的一段。');assert.equal(h.calls.draft.length,0);
});

test('live captions grow in the caption and the final transcription replaces only the spoken part',async t=>{
 const h=await harness(t,{mode:'voice',transcribe:async()=>({text:'正式转写：它叫桔子，右耳有缺口。'})}),mic=recording(t,h);
 class Recognition{static latest;constructor(){Recognition.latest=this;}start(){}abort(){}}
 h.w.SpeechRecognition=Recognition;
 await mic.start();Recognition.latest.onresult({results:[[{transcript:'中间转写：它叫橘子。'}]]});
 assert.equal(h.q('#intake-answer').value,'中间转写：它叫橘子。');
 await mic.stop();await h.until(()=>h.calls.speech.length===1&&!h.ui.busy&&h.q('[data-state=review]'));
 assert.equal(h.q('#intake-answer').value,'正式转写：它叫桔子，右耳有缺口。');assert.equal(h.calls.draft.length,0);
});

test('failed transcription keeps playable audio and retries the same recording into the caption',async t=>{
 const h=await harness(t,{mode:'voice',transcribe:async(_url,n)=>n===1?{error:'语音服务暂时不可用，录音已保留。'}:{text:'这只猫今天刚到。'}}),mic=recording(t,h);
 await mic.start();await mic.stop();await h.until(()=>h.calls.speech.length===1&&!h.ui.busy);
 assert.match(h.root.textContent,/语音服务暂时不可用/);assert.equal(h.q('audio').getAttribute('src'),h.calls.speech[0]);
 h.click('[data-intake=retry-speech]');await h.until(()=>h.calls.speech.length===2&&!h.ui.busy);
 assert.equal(h.calls.speech[1],h.calls.speech[0]);assert.equal(h.q('#intake-answer').value,'这只猫今天刚到。');assert.equal(h.q('audio'),null);assert.equal(h.calls.draft.length,0);
});

test('an organising failure keeps the conversation and can be retried',async t=>{
 const h=await harness(t,{draftIntake:async(_payload,n)=>{if(n===1)throw Error('Unavailable');return draft();}});
 h.type('橘猫，左耳缺了一个角。');h.click('[data-intake=send]');await h.until(()=>h.calls.draft.length===1&&!h.ui.busy);
 assert.deepEqual(h.bubbles('me'),['橘猫，左耳缺了一个角。']);assert.match(h.root.textContent,/暂时没能整理/);
 h.click('[data-intake=retry-organise]');await h.until(()=>h.calls.draft.length===2&&!h.ui.busy);assert.ok(h.q('#intake-confirm'));
});

test('a double send while busy performs one analysis',async t=>{
 const store=memoryStore(),save=store.save;store.save=async(key,value)=>{await new Promise(resolve=>setTimeout(resolve,20));await save(key,value);};
 const h=await harness(t,{draftStore:store});h.type('橘猫，左耳缺了一个角。');const send=h.q('[data-intake=send]');send.click();send.click();
 await h.until(()=>h.calls.draft.length===1&&!h.ui.busy);assert.deepEqual(h.bubbles('me'),['橘猫，左耳缺了一个角。']);
});

test('an uncertain save retries the identical payload and idempotency key after account changes',async t=>{
 let account=accountA;
 const h=await harness(t,{getDraftKey:()=>account,commitIntake:async(_payload,_key,n)=>{if(n===1)throw new Error('Connection lost after server accepted request');return {id:'saved-once'};}});
 await h.say('橘色短毛猫，左耳有一个小缺口。');h.archive();await h.until(()=>h.calls.commit.length===1&&!h.ui.busy);
 assert.equal(h.calls.done.length,0);assert.match(h.root.textContent,/重试/);
 await h.ui.stop();account='station-b:staff-b';await h.restart();await h.ui.stop();account=accountA;await h.restart();
 h.archive();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.draft.length,1);assert.equal(h.calls.commit.length,2);assert.deepEqual(h.calls.commit[1],h.calls.commit[0]);
});

test('leaving restores each account conversation and attachments without mixing them',async t=>{
 let account=accountA;const store=memoryStore();store.values.set(accountA,savedDraft({media:[{id:'photo-a',kind:'photo',dataUrl:photo,name:'本站橘猫.jpg'}],turns:[{id:'t1',role:'me',mediaIds:['photo-a']}]}));
 const h=await harness(t,{getDraftKey:()=>account,draftStore:store});await h.say('本站第一只橘猫。');await h.ui.stop();
 account='station-b:staff-b';await h.restart();assert.equal(h.root.querySelectorAll('.intake-bubble.me').length,0);h.type('另一站的白色小狗。');await h.ui.stop();
 account=accountA;await h.restart();assert.ok(h.bubbles('me').includes('本站第一只橘猫。'));assert.ok(h.q('.intake-bubble.media img'));assert.doesNotMatch(h.root.textContent,/另一站的白色小狗/);
});

test('earlier single-page drafts become one message without losing text or media',async t=>{
 const store=memoryStore();store.values.set(accountA,{version:2,key:'old-key',temporaryName:'待命名 TEST01',text:'手动核对后的记录：三岁。',media:[{id:'old-photo',kind:'photo',dataUrl:photo,name:'旧照片'}],commit:null,result:null,audio:''});
 const h=await harness(t,{draftStore:store});
 assert.deepEqual(h.bubbles('me'),['手动核对后的记录：三岁。']);
 await h.say('补充：今天下午刚到。');
 assert.equal(h.calls.draft.at(-1).text,'手动核对后的记录：三岁。\n补充：今天下午刚到。');assert.deepEqual(h.calls.draft.at(-1).images,[{kind:'photo',dataUrl:photo}]);
 h.archive();await h.until(()=>h.calls.done.length===1);assert.equal(h.calls.commit[0].key,'old-key');assert.deepEqual(h.calls.commit[0].payload.photos,[photo]);
});

test('legacy unacknowledged commits retry their exact request instead of re-organising',async t=>{
 const store=memoryStore(),commit={name:'旧档案',profile:{species:'cat',description:'旧版确认记录。'},published:false,text:'旧版来源文字。',photos:[photo]};
 store.values.set(accountA,{version:1,key:'old-commit-key',temporaryName:'旧档案',turns:[{role:'user',text:'不能重新生成这份请求'}],answer:'',media:[],commit,result:null,draft:draft()});
 const h=await harness(t,{draftStore:store});h.archive();await h.until(()=>h.calls.done.length===1);
 assert.equal(h.calls.draft.length,0);assert.deepEqual(h.calls.commit,[{payload:commit,key:'old-commit-key'}]);
});

test('legacy commits with a result open without another commit',async t=>{
 const store=memoryStore();store.values.set(accountA,{version:1,key:'old-commit-key',turns:[],answer:'',media:[],commit:{name:'旧档案'},result:{id:'already-created'},draft:draft()});
 const h=await harness(t,{draftStore:store});h.archive();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.done,[{id:'already-created'}]);assert.equal(h.calls.commit.length,0);assert.equal(store.values.has(accountA),false);
});

test('a late transcript cannot append private speech into another account draft',async t=>{
 let account=accountA,finishSpeech;const response=new Promise(resolve=>{finishSpeech=resolve;});
 const h=await harness(t,{mode:'voice',getDraftKey:()=>account,transcribe:()=>response}),mic=recording(t,h);
 await mic.start();await mic.stop();await h.until(()=>h.calls.speech.length===1);await h.ui.stop();account='station-b:staff-b';await h.restart();
 finishSpeech({text:'旧账号的猫叫旧橘子。'});await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.q('#intake-answer'),null,'Account B is still idle');assert.equal(h.calls.draft.length,0);assert.doesNotMatch(h.root.textContent,/旧橘子/);
 assert.doesNotMatch(JSON.stringify(h.store.values.get('station-b:staff-b')||{}),/旧橘子/);
});

test('leaving while the AI replies is allowed, a late reply is dropped and the reply resumes on return',async t=>{
 let finishFirst;const first=new Promise(resolve=>{finishFirst=resolve;});
 const h=await harness(t,{draftIntake:async(_payload,n)=>n===1?first:draft({name:'当前名字'})});
 h.type('原先的记录。');h.click('[data-intake=send]');await h.until(()=>h.calls.draft.length===1);
 assert.equal(h.ui.busy,true);assert.equal(h.ui.blocking,false,'Organising must not trap the rescuer on the page');
 await h.ui.stop();await h.restart();
 assert.equal(h.calls.draft.length,2);assert.equal(h.q('[data-review-field=name]').value,'当前名字');
 finishFirst(draft({name:'过期名字'}));await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.bubbles('ai').length,2);assert.equal(h.q('[data-review-field=name]').value,'当前名字');
});

test('a delayed commit merges only its result into the latest stored draft',async t=>{
 let finishCommit;const response=new Promise(resolve=>{finishCommit=resolve;});
 const h=await harness(t,{commitIntake:()=>response});await h.say('已提交的原始文字。');h.archive();await h.until(()=>h.calls.commit.length===1);await h.ui.stop();await h.restart();
 const latest=clone(h.store.values.get(accountA));latest.input='较新的未发送文字。';
 await h.store.save(accountA,latest);finishCommit({id:'saved-before-reopen'});await h.until(()=>h.store.values.get(accountA)?.result?.id==='saved-before-reopen');
 assert.equal(h.store.values.get(accountA).input,latest.input);assert.equal(h.calls.done.length,0);assert.equal(h.calls.commit.length,1);
});

test('a commit completed after an account switch stays with its original owner',async t=>{
 let account=accountA,finishCommit;const response=new Promise(resolve=>{finishCommit=resolve;});
 const h=await harness(t,{getDraftKey:()=>account,commitIntake:()=>response});await h.say('A站的私有记录。');h.archive();await h.until(()=>h.calls.commit.length===1);
 await h.ui.stop();account='station-b:staff-b';await h.restart();h.type('B站正在录入。');finishCommit({id:'saved-a'});await h.until(()=>h.store.values.get(accountA)?.result?.id==='saved-a');
 assert.equal(h.q('#intake-answer').value,'B站正在录入。');assert.equal(h.calls.done.length,0);
 await h.ui.stop();account=accountA;await h.restart();h.archive();await h.until(()=>h.calls.done.length===1);
 assert.deepEqual(h.calls.done,[{id:'saved-a'}]);assert.equal(h.calls.commit.length,1);
});

test('example storage failure keeps the conversation and allows another attempt',async t=>{
 const h=await harness(t,{commitIntake:async(_body,_key,n)=>{if(n===1)throw Error('EXAMPLE_STORAGE_FULL');return {id:'saved-after-retry'};}});
 await h.say('需要保留的用户原文。');h.archive();await h.until(()=>h.calls.commit.length===1&&!h.ui.busy);
 assert.equal(h.calls.done.length,0);assert.deepEqual(h.bubbles('me'),['需要保留的用户原文。']);assert.equal(h.store.values.get(accountA).commit,null);
 h.archive();await h.until(()=>h.calls.done.length===1);assert.equal(h.calls.commit[1].payload.text,'需要保留的用户原文。');
});

test('restart asks first, then clears the conversation and media for a new partner',async t=>{
 const store=memoryStore();store.values.set(accountA,savedDraft({media:[{id:'photo-1',kind:'photo',dataUrl:photo,name:'橘猫.jpg'}],turns:[{id:'t1',role:'me',mediaIds:['photo-1']}]}));
 const h=await harness(t,{draftStore:store});await h.say('第一只橘猫。');
 h.confirmAnswer.value=false;h.click('[data-intake=restart]');await new Promise(resolve=>setTimeout(resolve,10));assert.ok(h.bubbles('me').includes('第一只橘猫。'));
 h.confirmAnswer.value=true;h.click('[data-intake=restart]');await h.until(()=>!h.q('.intake-bubble.me'));
 assert.deepEqual(h.bubbles('ai'),['先发张照片，或者说说它的情况吧。']);assert.equal(h.q('[data-intake=restart]'),null);
 await h.until(()=>h.store.values.get(accountA)?.turns.length===0);const stored=h.store.values.get(accountA);assert.deepEqual(stored.media,[]);assert.notEqual(stored.key,'draft-test-key');
});

test('each card note carries its long-term or one-off tag and station-only notes stay out of the public profile',async t=>{
 const h=await harness(t,{draftIntake:async()=>draft({description:'平时喜欢玩逗猫棒。今天吃了少量罐头。送来的人电话已存交接表。'})});
 await h.say('平时喜欢玩逗猫棒，今天吃了少量罐头，送来的人电话已存交接表。');
 const tags=()=>[...h.root.querySelectorAll('.intake-item [data-intake=item-certainty]')].map(b=>b.textContent);
 assert.deepEqual(tags(),['长期','这次','这次']);
 h.click('.intake-item:nth-of-type(1) [data-intake=item-certainty]');await h.until(()=>tags()[0]==='这次');
 const items=[...h.root.querySelectorAll('.intake-item')],last=items.at(-1);last.querySelector('[data-intake=item-local]').click();
 await h.until(()=>h.root.querySelectorAll('.intake-item.local').length===1);
 h.archive();await h.until(()=>h.calls.done.length===1);
 const payload=h.calls.commit[0].payload;
 assert.deepEqual(payload.notes,[{topic:'likes',quote:'平时喜欢玩逗猫棒。',certainty:'observation',shared:true},{topic:'diet',quote:'今天吃了少量罐头。',certainty:'observation',shared:true},{topic:'other',quote:'送来的人电话已存交接表。',certainty:'observation',shared:false}]);
 assert.equal(payload.profile.description,'平时喜欢玩逗猫棒。今天吃了少量罐头。');
});

test('a server without guided coverage receives the description only',async t=>{
 const h=await harness(t,{draftIntake:async()=>{const legacy=draft();delete legacy.coverage;return legacy;}});
 await h.say('橘猫。');h.archive();await h.until(()=>h.calls.done.length===1);
 assert.equal(Object.hasOwn(h.calls.commit[0].payload,'notes'),false);assert.equal(h.calls.commit[0].payload.profile.description,'今天吃了少量罐头。橘色短毛猫。','Card order: knowledge topics first, other observations last');
});

test('public content over the profile limit cannot be archived until shortened',async t=>{
 const long='它'.repeat(990)+'。';
 const h=await harness(t,{draftIntake:async()=>draft({description:Array(5).fill(long).join('')})});
 await h.say('很长的记录。');
 assert.match(h.q('.intake-card-left.over').textContent,/请删减/);assert.equal(h.q('#intake-confirm button').disabled,true);
 h.root.querySelector('.intake-item [data-intake=item-local]').click();await h.until(()=>!h.q('.intake-card-left.over'));
 assert.equal(h.q('#intake-confirm button').disabled,false);
});
