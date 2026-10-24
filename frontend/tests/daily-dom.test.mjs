import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const pad=n=>String(n).padStart(2,'0');
const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
let run=0;

async function page(t,{transcribe=async()=>({text:'今天食欲正常。'}),loseSecondResponse=false,rejectSecondOnce=false,analyse=async()=>({reply:"已理解这条补充，确认后入档。",nextQuestion:""})}={}){
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online&role=station',pretendToBeVisual:true}),w=dom.window,originalFetch=globalThis.fetch;
 const pets=[{id:'pet-1',name:'橘子',stationId:'s1',profile:{species:'cat'},published:false},{id:'pet-2',name:'阿灰',stationId:'s1',profile:{species:'cat'},published:false}];
 const calls={saves:[],speech:0,processed:[],analyses:[]};let rows=[],lost=false,rejected=false;const accepted=new Map();
 const jpeg='data:image/jpeg;base64,/9j/2Q==';
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=>jpeg;
 class Image{naturalWidth=100;naturalHeight=100;set src(value){queueMicrotask(()=>this.onload());}}
 class Recorder{static isTypeSupported(){return true;}constructor(){Recorder.latest=this;this.state='inactive';this.mimeType='audio/wav';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['RIFF0000WAVE'])});this.onstop();}}
 w.MediaRecorder=Recorder;w.HTMLElement.prototype.setPointerCapture=()=>{};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
 const fetcher=async(url,options={})=>{
  if(/^(blob|data):/.test(String(url)))return originalFetch(url,options);
  const path=new URL(url).pathname,body=typeof options.body==='string'?JSON.parse(options.body):undefined;
  if(path.endsWith('/login'))return Response.json({token:'test',user:{id:'staff',role:'station',stationId:'s1'}});
  if(path==='/v1/stations')return Response.json({stations:[{id:'s1',name:'测试救助站'}]});
  if(path==='/v1/pets')return Response.json({pets});
  if(path==='/v1/applications')return Response.json({applications:[]});
  if(path==='/v1/followups')return Response.json({followups:[]});
  if(path.endsWith('/observations/analyze')){calls.analyses.push({path,body});try{return Response.json(await analyse(body,calls.analyses.length));}catch{return Response.json({error:'AI_UNAVAILABLE'},{status:502});}}
  if(path.endsWith('/transcribe')){calls.speech++;try{return Response.json(await transcribe(calls.speech));}catch(e){throw e;}}
  if(path.endsWith('/observations')&&options.method==='POST'){
   const key=options.headers['Idempotency-Key'];calls.saves.push({path,body,key});if(accepted.has(key))return Response.json({id:accepted.get(key),duplicate:true});if(rejectSecondOnce&&accepted.size===1&&!rejected){rejected=true;return Response.json({error:'INVALID_INPUT'},{status:400});}const id='obs-'+(accepted.size+1);accepted.set(key,id);
   if(body.replacesId)rows=rows.map(r=>r.id===body.replacesId?{...r,status:'withdrawn'}:r);
   rows=[{id,pet_id:path.split('/')[3],original_text:body.text,share_with_agent:body.shareWithAgent,status:'queued',created_at:new Date().toISOString(),observed_on:body.observedOn,replaces_id:body.replacesId||null,visuals:[]},...rows];
   if(loseSecondResponse&&accepted.size===2&&!lost){lost=true;throw new TypeError('Failed to fetch');}
   return Response.json({id},{status:202});
  }
  if(path.endsWith('/observations'))return Response.json({observations:rows.filter(r=>r.pet_id===path.split('/')[3])});
  if(path.endsWith('/process')){calls.processed.push(path);rows=rows.map(r=>r.status==='queued'?{...r,status:'archived'}:r);return Response.json({processed:true});}
  if(path.endsWith('/knowledge'))return Response.json({notes:[]});
  if(path.endsWith('/intake'))return Response.json({visuals:[],documents:[]});
  throw Error('Unexpected request: '+path);
 };
 const previous=new Map();
 for(const [key,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData,localStorage:w.localStorage,confirm:()=>true,fetch:fetcher,MediaRecorder:Recorder,Image,FileReader:class {async readAsDataURL(blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onload();}}}))
  {previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 t.after(()=>{dom.window.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const q=s=>w.document.querySelector(s),click=s=>{assert.ok(q(s),`Missing ${s}`);q(s).click();};
 const until=async(predicate,message='Expected interface state was not reached')=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),message);};
 const type=value=>{if(!q('#daily-text'))click('[data-daily=mode]');const el=q('#daily-text');assert.ok(el,'Missing #daily-text');el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 await import(`../dist/online.js?daily=${++run}`);
 q('[name=username]').value='staff';q('[name=password]').value='not-a-real-password';q('#login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>q('.station-action-dock [data-live=voice]'));
 const photo=async()=>{if(!q('[data-daily=album]'))click('[data-daily=attachments]');const input=q('#daily-album');Object.defineProperty(input,'files',{value:[new Blob(['test image'],{type:'image/jpeg'})]});input.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>q('.daily-composer .daily-thumb img'));};
 return {w,q,click:async selector=>{click(selector);await new Promise(r=>setTimeout(r,0));await until(()=>!q('.daily-entry [role=status]'));await new Promise(r=>setTimeout(r,0));},until,type,calls,Recorder,photo,jpeg};
}

async function enter(h,id='pet-1',typing=true){
 await h.click('.station-action-dock [data-live=voice]');await h.until(()=>h.q('.daily-picker'));
 await h.click(`[data-daily=pick][data-id="${id}"]`);await h.until(()=>h.q('.daily-flow'));if(typing&&!h.q('#daily-text')&&h.q('[data-daily=mode]'))await h.click('[data-daily=mode]');
}

test('continuous additions stay with one pet and are only submitted after a combined review',async t=>{
 const h=await page(t);await enter(h,'pet-2');
 assert.equal(h.q('.topbar-title').textContent,'补充');assert.equal(h.q('[role=tab]'),null);
 assert.equal(h.q('[data-daily=save]'),null);assert.equal(h.q('[data-daily=review]').disabled,true);
 assert.match(h.q('[data-daily=sheet]').getAttribute('aria-label'),/未指定/);
 h.type('它已经绝育了，之前忘了说。');await h.click('[data-daily=add]');
 assert.equal(h.q('#daily-text').value,'');assert.equal(h.calls.saves.length,0);assert.ok(h.q('.daily-entry'));
 h.type('昨天第一次主动靠近了。');
 await h.click('[data-daily=sheet]');await h.click(`[data-daily=day][data-day="${daysAgo(1)}"]`);await h.click('[data-daily=local]');
 await h.click('[data-daily=review]');
 assert.equal(h.calls.saves.length,0);assert.equal(h.q('#daily-text'),null);assert.match(h.q('[data-daily=save]').textContent,/2 条/);
 await h.click('[data-daily=continue]');assert.ok(h.q('#daily-text'));assert.equal(h.calls.saves.length,0);
 await h.click('[data-daily=review]');await h.click('[data-daily=save]');await h.until(()=>h.q('.online-card.just-added'));
 assert.equal(h.calls.saves.length,2);assert.ok(h.calls.saves.every(c=>c.path==='/v1/pets/pet-2/observations'));
 assert.deepEqual(h.calls.saves.map(c=>c.body),[{text:'它已经绝育了，之前忘了说。',shareWithAgent:true},{text:'昨天第一次主动靠近了。',shareWithAgent:false,observedOn:daysAgo(1)}]);
 assert.equal(new Set(h.calls.saves.map(c=>c.key)).size,2);assert.equal(h.calls.processed.length,2);
 assert.match(h.q('.topbar-title').textContent,/阿灰/);assert.match(h.q('.online-card.just-added').textContent,/昨天 · 刚追加/);
});

test('review allows edits and removal without losing the next unfinished addition',async t=>{
 const h=await page(t);await enter(h);h.type('它喜欢小球。');await h.click('[data-daily=add]');
 h.type('它喜欢羽毛玩具。');await h.click('[data-daily=edit-entry]');
 assert.equal(h.q('#daily-text').value,'它喜欢小球。');
 h.type('它更喜欢羽毛玩具。');await h.click('[data-daily=add]');
 await h.click('[data-daily=review]');assert.match(h.q('[data-daily=save]').textContent,/2 条/);
 await h.click('.daily-entry:last-child [data-daily=remove-entry]');
 assert.equal(h.calls.saves.length,0);assert.match(h.q('[data-daily=save]').textContent,/1 条/);
 await h.click('[data-daily=save]');await h.until(()=>h.calls.saves.length===1);
 assert.equal(h.calls.saves[0].body.text,'它更喜欢羽毛玩具。');
});

test('attachments preview beside the input and remain with their own additions, including media alone',async t=>{
 const h=await page(t);await enter(h);h.type('平时喜欢玩羽毛。');await h.photo();
 assert.ok(h.q('.daily-composer #daily-text'));assert.ok(h.q('.daily-composer .daily-thumb img'));assert.ok(h.q('.daily-composer [data-daily=attachments]'));assert.ok(h.q('.daily-composer [data-daily=mode]'));
 await h.click('[data-daily=add]');assert.ok(h.q('.daily-entry .daily-thumb img'));assert.equal(h.q('.daily-composer .daily-thumb'),null);
 await h.photo();await h.click('[data-daily=review]');assert.equal(h.calls.saves.length,0);await h.click('[data-daily=save]');await h.until(()=>h.q('.online-card.just-added'));
 assert.deepEqual(h.calls.saves.map(c=>c.body),[{text:'平时喜欢玩羽毛。',shareWithAgent:true,photos:[h.jpeg]},{text:'',shareWithAgent:true,photos:[h.jpeg]}]);
});

test('a lost response halfway through final confirmation retries only the unacknowledged item with its original key',async t=>{
 const h=await page(t,{loseSecondResponse:true});await enter(h);
 h.type('第一条补充。');await h.click('[data-daily=add]');h.type('第二条补充。');await h.click('[data-daily=review]');await h.click('[data-daily=save]');
 await h.until(()=>h.q('.daily-review-actions [role=alert]')?.textContent.includes('已保存 1/2'));
 assert.equal(h.q('[data-daily=edit-entry]').disabled,true);
 await h.click('[data-live=home]');await h.until(()=>h.q('.station-action-dock'));await enter(h); // The pending draft is retained for this pet.
 await h.until(()=>h.q('[data-daily=save]'));await h.click('[data-daily=save]');await h.until(()=>h.q('.online-card.just-added'));
 assert.equal(h.calls.saves.length,3);assert.deepEqual(h.calls.saves[1],h.calls.saves[2]);assert.notEqual(h.calls.saves[0].key,h.calls.saves[1].key);
 assert.equal(h.calls.processed.length,2);
});

test('unfinished additions survive in-app navigation and stay isolated between pets',async t=>{
 const h=await page(t);await enter(h);h.type('橘子的第一条。');await h.click('[data-daily=add]');h.type('还没加入的内容。');
 await h.click('[data-live=home]');await h.until(()=>h.q('.station-action-dock'));await enter(h,'pet-2');
 assert.equal(h.q('.daily-entry'),null);assert.equal(h.q('#daily-text').value,'');
 await h.click('[data-live=home]');await h.until(()=>h.q('.station-action-dock'));await enter(h);
 assert.match(h.q('.daily-entry').textContent,/橘子的第一条/);assert.equal(h.q('#daily-text').value,'还没加入的内容。');assert.equal(h.calls.saves.length,0);
});

test('profile entry already selects the current pet',async t=>{
 const h=await page(t);await h.click('[data-live=pets]');await h.until(()=>h.q('[data-live=pet]'));await h.click('[data-live=pet][data-id=pet-1]');await h.until(()=>h.q('[data-live=voice][data-id=pet-1]'));
 await h.click('[data-live=voice][data-id=pet-1]');await h.until(()=>h.q('.daily-flow'));assert.equal(h.q('.daily-picker'),null);assert.match(h.q('.daily-who').textContent,/橘子/);
});

test('failed transcription retains the audio for retry without adding or submitting a record',async t=>{
 const h=await page(t,{transcribe:async n=>{if(n===1)throw new TypeError('Failed to fetch');return {text:'今天食欲正常。'};}});await enter(h);
 h.type('早上量了体重。');await h.click('[data-daily=mode]');await h.click('#daily-record');await h.until(()=>h.Recorder.latest?.state==='recording');
 await h.click('#daily-record');await h.until(()=>h.q('[data-daily=retry-speech]')&&!h.q('[data-daily=retry-speech]').disabled);
 assert.equal(h.calls.saves.length,0);assert.equal(h.q('[data-daily=add]').disabled,true);assert.equal(h.q('[data-daily=review]').disabled,true);
 await h.click('[data-daily=retry-speech]');await h.until(()=>h.q('#daily-text')?.value==='早上量了体重。\n今天食欲正常。');
 assert.equal(h.q('audio'),null);assert.equal(h.calls.saves.length,0);await h.click('[data-daily=add]');assert.ok(h.q('.daily-entry'));assert.ok(h.q('.intake-talk-button'));
});

test('correction retains date and visibility, is reviewed, and replaces exactly one original record',async t=>{
 const h=await page(t);await enter(h);h.type('它不吃罐头。');await h.click('[data-daily=sheet]');await h.click(`[data-daily=day][data-day="${daysAgo(2)}"]`);await h.click('[data-daily=local]');await h.click('[data-daily=review]');await h.click('[data-daily=save]');await h.until(()=>h.q('[data-live=correct]'));
 await h.click('[data-live=correct]');await h.until(()=>h.q('#daily-text'));
 assert.equal(h.q('#daily-text').value,'它不吃罐头。');assert.match(h.q('.daily-date-chip').textContent,/前天/);assert.equal(h.q('[data-daily=album]'),null);
 h.type('它只是不吃鸡肉味罐头。');await h.click('[data-daily=add]');assert.equal(h.calls.saves.length,1);
 await h.click('[data-daily=continue]');assert.equal(h.q('#daily-text').value,'它只是不吃鸡肉味罐头。');await h.click('[data-daily=add]');await h.click('[data-daily=save]');await h.until(()=>h.calls.saves.length===2&&h.q('.online-card.just-added'));
 assert.deepEqual(h.calls.saves[1].body,{text:'它只是不吃鸡肉味罐头。',shareWithAgent:false,replacesId:'obs-1',observedOn:daysAgo(2)});
});

test('dates are optional and a future event date cannot be selected',async t=>{
 const h=await page(t);await enter(h);await h.click('[data-daily=sheet]');const input=h.q('#daily-date');assert.equal(input.max,daysAgo(0));
 const tomorrow=new Date(Date.now()+2*86400000);input.value=`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`;input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
 assert.match(h.q('.daily-date-chip').textContent,/日期/);await h.click(`[data-daily=day][data-day="${daysAgo(0)}"]`);assert.match(h.q('.daily-date-chip').textContent,/今天/);
 await h.click('[data-daily=sheet]');await h.click('[data-daily=day][data-day=""]');assert.match(h.q('.daily-date-chip').textContent,/日期/);
});


test('example quota errors retain the last persisted records and retry creates only one addition',async()=>{
 const {createStationExamples}=await import('../dist/station-examples.js');let fail=true,persisted;
 const api=createStationExamples({getItem:()=>null,setItem:(_,value)=>{if(fail)throw Error('quota');persisted=value;}});
 const petId=(await api.pets()).pets[0].id,before=(await api.observations(petId)).observations.length;
 await assert.rejects(api.submitObservation(petId,{text:'配额测试',photos:['data:image/jpeg;base64,AAAA']},'quota-key'),/EXAMPLE_STORAGE_FULL/);
 assert.equal((await api.observations(petId)).observations.length,before);assert.equal(persisted,undefined);
 fail=false;const saved=await api.submitObservation(petId,{text:'配额测试'},'quota-key');assert.equal((await api.submitObservation(petId,{text:'配额测试'},'quota-key')).id,saved.id);
 assert.equal((await api.observations(petId)).observations.length,before+1);assert.ok(persisted);
});


test('a rejected later entry remains editable while already saved entries stay fixed',async t=>{
 const h=await page(t,{rejectSecondOnce:true});await enter(h);h.type('已确认的第一条。');await h.click('[data-daily=add]');h.type('需要改的第二条。');await h.click('[data-daily=review]');await h.click('[data-daily=save]');
 await h.until(()=>h.q('.daily-review-actions [role=alert]')?.textContent.includes('已保存 1/2'));
 assert.equal(h.q('.daily-entry:first-child [data-daily=edit-entry]').disabled,true);assert.equal(h.q('.daily-entry:last-child [data-daily=edit-entry]').disabled,false);
 await h.click('.daily-entry:last-child [data-daily=edit-entry]');h.type('修改后的第二条。');await h.click('[data-daily=add]');await h.click('[data-daily=review]');await h.click('[data-daily=save]');await h.until(()=>h.q('.online-card.just-added'));
 assert.equal(h.calls.saves.length,3);assert.equal(h.calls.saves[2].body.text,'修改后的第二条。');assert.notEqual(h.calls.saves[1].key,h.calls.saves[2].key);assert.equal(h.calls.processed.length,2);
});


test('voice and typing share the intake composer while preserving unsent text, media and options',async t=>{
 const h=await page(t);await enter(h,'pet-1',false);
 assert.ok(h.q('.intake-composer.voice .intake-talk-button'));
 assert.equal(h.q('#daily-text'),null);
 await h.click('[data-daily=mode]');h.type('样式核对：之前忘了说，它会用猫砂。');await h.photo();
 await h.click('[data-daily=local]');await h.click('[data-daily=mode]');
 assert.ok(h.q('.intake-caption.editable #daily-text'));
 assert.match(h.q('#daily-text').value,/会用猫砂/);
 assert.ok(h.q('.daily-composer .daily-thumb img'));
 assert.equal(h.q('[data-daily=local]').getAttribute('aria-pressed'),'true');
 h.type('');assert.ok(h.q('#daily-text'),'Clearing a spoken draft keeps it editable');
 assert.equal(h.q('[data-daily=add]').disabled,false,'A photo can still be added without text');
 await h.click('[data-daily=mode]');await h.click('[data-daily=remove-media]');
 assert.equal(h.w.document.querySelectorAll('[data-daily=attachments]').length,1);
 h.type('最终保留这条。');await h.click('[data-daily=add]');
 assert.ok(h.q('.daily-entry .intake-bubble.me'));
 assert.equal(h.calls.saves.length,0);
 await h.click('[data-daily=review]');await h.click('[data-daily=save]');await h.until(()=>h.calls.saves.length===1);
 assert.deepEqual(h.calls.saves[0].body,{text:'最终保留这条。',shareWithAgent:false});
});


test('real analysis receives pet context and prior turns; a failure preserves drafts and never archives AI text',async t=>{
 const h=await page(t,{analyse:async(body,n)=>{if(n===2)throw Error('provider');return {reply:'Agent 的分析回应',nextQuestion:n===1?'这是今天的观察还是长期习惯？':''};}});await enter(h);
 h.type('它吃得比以前少。');await h.click('[data-daily=add]');
 assert.match(h.q('.daily-agent').textContent,/长期习惯/);assert.equal(h.calls.saves.length,0);
 h.type('只是今天比昨天少，原因还不清楚。');await h.click('[data-daily=add]');
 assert.match(h.q('#daily-error').textContent,/暂时没有回应/);assert.equal(h.calls.saves.length,0);
 assert.match(h.q('.daily-entry:last-child').textContent,/原因还不清楚/);
 await h.click('[data-daily=retry-analysis]');
 assert.equal(h.calls.analyses.length,3);assert.deepEqual(h.calls.analyses[1],h.calls.analyses[2]);
 assert.equal(h.calls.analyses[2].body.history[0].question,'这是今天的观察还是长期习惯？');
 assert.equal(h.calls.analyses[2].path,'/v1/pets/pet-1/observations/analyze');
 await h.click('[data-daily=review]');await h.click('[data-daily=save]');await h.until(()=>h.calls.saves.length===2);
 assert.deepEqual(h.calls.saves.map(c=>c.body.text),['它吃得比以前少。','只是今天比昨天少，原因还不清楚。']);
});
