import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const pad=n=>String(n).padStart(2,'0');
const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
let run=0;

async function page(t,{transcribe=async()=>({text:'今天食欲正常。'})}={}){
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online&role=station',pretendToBeVisual:true}),w=dom.window,originalFetch=globalThis.fetch;
 const pets=[{id:'pet-1',name:'橘子',stationId:'s1',profile:{species:'cat'},published:false},{id:'pet-2',name:'阿灰',stationId:'s1',profile:{species:'cat'},published:false}];
 const calls={saves:[],speech:0};let rows=[];
 class Recorder{static isTypeSupported(){return true;}constructor(){Recorder.latest=this;this.state='inactive';this.mimeType='audio/wav';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['RIFF0000WAVE'])});this.onstop();}}
 w.MediaRecorder=Recorder;w.HTMLElement.prototype.setPointerCapture=()=>{};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
 const fetcher=async(url,options={})=>{
  if(/^(blob|data):/.test(String(url)))return originalFetch(url,options);
  const path=new URL(url).pathname,body=typeof options.body==='string'?JSON.parse(options.body):undefined;
  if(path.endsWith('/login'))return Response.json({token:'test',user:{id:'staff',role:'station',stationId:'s1'}});
  if(path==='/v1/pets')return Response.json({pets});
  if(path==='/v1/applications')return Response.json({applications:[]});
  if(path==='/v1/followups')return Response.json({followups:[]});
  if(path.endsWith('/transcribe')){calls.speech++;try{return Response.json(await transcribe(calls.speech));}catch(e){throw e;}}
  if(path.endsWith('/observations')&&options.method==='POST'){
   calls.saves.push({path,body,key:options.headers['Idempotency-Key']});const id='obs-'+calls.saves.length;
   if(body.replacesId)rows=rows.map(r=>r.id===body.replacesId?{...r,status:'withdrawn'}:r);
   rows=[{id,original_text:body.text,share_with_agent:body.shareWithAgent,status:'queued',created_at:new Date().toISOString(),observed_on:body.observedOn,replaces_id:body.replacesId||null,visuals:[]},...rows];
   return Response.json({id},{status:202});
  }
  if(path.endsWith('/observations'))return Response.json({observations:rows});
  if(path.endsWith('/process')){rows=rows.map(r=>r.status==='queued'?{...r,status:'archived'}:r);return Response.json({processed:true});}
  if(path.endsWith('/knowledge'))return Response.json({notes:[]});
  if(path.endsWith('/intake'))return Response.json({visuals:[],documents:[]});
  throw Error('Unexpected request: '+path);
 };
 const previous=new Map();
 for(const [key,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData,confirm:()=>true,fetch:fetcher,MediaRecorder:Recorder,FileReader:class {async readAsDataURL(blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onload();}}}))
  {previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 t.after(()=>{dom.window.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const q=s=>w.document.querySelector(s),click=s=>{assert.ok(q(s),`Missing ${s}`);q(s).click();};
 const until=async(predicate,message='Expected interface state was not reached')=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),message);};
 const type=value=>{const el=q('#daily-text');assert.ok(el,'Missing #daily-text');el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 await import(`../dist/online.js?daily=${++run}`);
 q('[name=username]').value='staff';q('[name=password]').value='not-a-real-password';q('#login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>q('.station-action-dock [data-live=voice]'));
 return {w,q,click,until,type,calls,Recorder};
}

test('from the workspace the rescuer picks a partner, records with a date and visibility, and lands on that partner',async t=>{
 const h=await page(t);
 h.click('.station-action-dock [data-live=voice]');await h.until(()=>h.q('.daily-picker'));
 assert.match(h.q('.topbar-title').textContent,/给谁补充/);assert.equal(h.q('#daily-text'),null);
 h.click('[data-daily=pick][data-id=pet-2]');await h.until(()=>h.q('#daily-text'));
 assert.match(h.q('.daily-who').textContent,/阿灰/);assert.match(h.q('.daily-entry header').textContent,/阿灰 · 今天/);
 assert.equal(h.q('[data-daily=save]').disabled,true,'Nothing to save yet');
 h.type('今天第一次主动靠过来了，同事说昨晚也吃完了半碗。');
 assert.equal(h.q('.daily-who').disabled,true,'The partner stays fixed once the rescuer starts writing');
 h.click('[data-daily=sheet]');await h.until(()=>h.q('.daily-sheet'));h.click(`[data-daily=day][data-day="${daysAgo(1)}"]`);await h.until(()=>!h.q('.daily-sheet'));
 assert.match(h.q('.daily-entry header').textContent,/阿灰 · 昨天/);
 h.click('[data-daily=local]');await h.until(()=>h.q('[data-daily=local].on'));
 h.click('[data-daily=save]');await h.until(()=>h.q('.online-card.just-added'));
 assert.equal(h.calls.saves.length,1);const {body,path,key}=h.calls.saves[0];
 assert.equal(path,'/v1/pets/pet-2/observations');assert.ok(key);
 assert.deepEqual(body,{text:'今天第一次主动靠过来了，同事说昨晚也吃完了半碗。',shareWithAgent:false,observedOn:daysAgo(1)});
 assert.match(h.q('.topbar-title').textContent,/阿灰/);assert.match(h.q('#app').textContent,/已追加，正在整理进资料库/);
 assert.match(h.q('.online-card.just-added').textContent,/昨天 · 刚追加/);assert.match(h.q('.online-card.just-added').textContent,/仅本站可见/);
});

test('from a partner profile the partner is already chosen',async t=>{
 const h=await page(t);
 h.click('[data-live=pets]');await h.until(()=>h.q('[data-live=pet]'));h.click('[data-live=pet][data-id=pet-1]');await h.until(()=>h.q('[data-live=voice][data-id=pet-1]'));
 h.click('[data-live=voice][data-id=pet-1]');await h.until(()=>h.q('#daily-text'));
 assert.equal(h.q('.daily-picker'),null);assert.match(h.q('.daily-who').textContent,/橘子/);
});

test('spoken words join the entry and a failed transcription keeps the recording for retry without saving',async t=>{
 const h=await page(t,{transcribe:async n=>{if(n===1)throw new TypeError('Failed to fetch');return {text:'今天食欲正常。'};}});
 h.click('.station-action-dock [data-live=voice]');await h.until(()=>h.q('[data-daily=pick]'));h.click('[data-daily=pick]');await h.until(()=>h.q('#daily-record'));
 h.type('早上量了体重。');
 h.click('#daily-record');await h.until(()=>h.Recorder.latest?.state==='recording'&&h.q('.daily-dock[data-state=rec]'));
 assert.ok(h.q('[data-daily=cancel-voice]'));
 h.click('#daily-record');await h.until(()=>h.q('audio')&&h.q('[data-daily=retry-speech]'));
 assert.equal(h.calls.saves.length,0);assert.equal(h.q('[data-daily=save]').disabled,true,'A pending recording must be resolved first');
 h.click('[data-daily=retry-speech]');await h.until(()=>h.q('#daily-text')?.value==='早上量了体重。\n今天食欲正常。');
 assert.equal(h.q('audio'),null);assert.equal(h.calls.saves.length,0);
});

test('a correction starts from the old record, keeps its date and visibility, and cannot add media',async t=>{
 const h=await page(t);
 h.click('.station-action-dock [data-live=voice]');await h.until(()=>h.q('[data-daily=pick]'));h.click('[data-daily=pick][data-id=pet-1]');await h.until(()=>h.q('#daily-text'));
 h.type('它不吃罐头。');h.click('[data-daily=sheet]');await h.until(()=>h.q('.daily-sheet'));h.click(`[data-daily=day][data-day="${daysAgo(2)}"]`);
 h.click('[data-daily=local]');h.click('[data-daily=save]');await h.until(()=>h.q('[data-live=correct]'));
 h.click('[data-live=correct]');await h.until(()=>h.q('.daily-entry.correcting'));
 assert.match(h.q('.topbar-title').textContent,/更正这条记录/);assert.match(h.q('.daily-original').textContent,/它不吃罐头/);assert.equal(h.q('#daily-text').value,'它不吃罐头。');
 assert.match(h.q('.daily-date-chip').textContent,/前天/);assert.equal(h.q('[data-daily=panel]'),null);
 h.type('它只是不吃鸡肉味罐头。');h.click('[data-daily=save]');await h.until(()=>h.calls.saves.length===2&&h.q('.online-card.just-added'));
 assert.deepEqual(h.calls.saves[1].body,{text:'它只是不吃鸡肉味罐头。',shareWithAgent:false,replacesId:'obs-1',observedOn:daysAgo(2)});
 assert.match(h.q('.online-card.just-added').textContent,/更正过/);
});

test('a future date cannot be chosen',async t=>{
 const h=await page(t);
 h.click('.station-action-dock [data-live=voice]');await h.until(()=>h.q('[data-daily=pick]'));h.click('[data-daily=pick]');await h.until(()=>h.q('#daily-text'));
 h.click('[data-daily=sheet]');await h.until(()=>h.q('#daily-date'));
 const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);const input=h.q('#daily-date');assert.equal(input.max,daysAgo(0));
 input.value=`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`;input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
 assert.match(h.q('.daily-date-chip').textContent,/今天/);
});
