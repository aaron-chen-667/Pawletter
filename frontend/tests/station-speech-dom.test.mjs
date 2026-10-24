import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('station network failure keeps playback and retry, then requires confirmation before archiving',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online&role=station'}),w=dom.window,originalFetch=globalThis.fetch;let attempts=0,saves=0;
 const p={id:'pet-1',name:'橘子',stationId:'s1',profile:{species:'cat'},published:false};
 class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/wav';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['RIFF0000WAVE'])});this.onstop();}}
 w.MediaRecorder=Recorder;w.HTMLElement.prototype.setPointerCapture=()=>{};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
 const fetcher=async(url,options)=>{
  if(String(url).startsWith('blob:'))return originalFetch(url,options);
  const path=new URL(url).pathname;
  if(path.endsWith('/login'))return Response.json({token:'test',user:{role:'station',stationId:'s1'}});
  if(path==='/v1/pets')return Response.json({pets:[p]});
  if(path==='/v1/applications')return Response.json({applications:[]});
  if(path==='/v1/followups')return Response.json({followups:[]});
  if(path.endsWith('/transcribe')){attempts++;if(attempts===1)throw new TypeError('Failed to fetch');return Response.json({text:'今天食欲正常。'});}
  if(path.endsWith('/observations')&&options.method==='POST'){saves++;return Response.json({id:'obs'});}
  if(path.endsWith('/observations'))return Response.json({observations:[]});
  if(path.endsWith('/knowledge'))return Response.json({notes:[]});
  return Response.json({});
 };
 for(const [key,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData,MediaRecorder:Recorder,fetch:fetcher}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const q=s=>document.querySelector(s),until=async fn=>{for(let i=0;i<150&&!fn();i++)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
 try{
  await import('../dist/online.js');q('[name=username]').value='staff';q('[name=password]').value='testing-password';q('#login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>q('[data-live=voice]'));q('[data-live=voice]').click();await until(()=>q('#hold-record'));
  q('#hold-record').dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0,clientY:300}));await until(()=>q('#hold-record').textContent.includes('松开'));q('#hold-record').dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,clientY:300}));await until(()=>q('#live-error').textContent.includes('连接不上'));
  assert.ok(q('details[open] audio'));assert.doesNotMatch(q('#live-error').textContent,/Failed to fetch/);assert.equal(saves,0);
  q('[data-live=transcribe-again]').click();await until(()=>q('#observation-text')?.value==='今天食欲正常。');assert.equal(saves,0);assert.equal(q('#live-error').textContent,'');q('[data-live=submit-text]').click();await until(()=>saves===1);assert.equal(attempts,2);
 }finally{globalThis.fetch=originalFetch;dom.window.close();}
});
