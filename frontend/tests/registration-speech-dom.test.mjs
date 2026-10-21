import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('hold release transcribes, slide up cancels, busy preserves recording and retry advances interview',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/',pretendToBeVisual:true});
 const {window}=dom;window.scrollTo=()=>{};const realFetch=globalThis.fetch;let posts=0,finish;
 const fetcher=(url,options)=>String(url).endsWith('/catalog')?Promise.resolve({ok:true,json:async()=>({pets:[]})}):String(url).startsWith('blob:')?realFetch(url,options):url.endsWith('/interview')?Promise.resolve({ok:true,json:async()=>({understood:true,value:'long',reply:'白天外出，记下啦。'})}):new Promise(resolve=>{posts++;finish=resolve;});
 class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['recorded speech'])});this.onstop();}}
 Object.defineProperty(window.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});window.MediaRecorder=Recorder;
 for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,FormData:window.FormData,MediaRecorder:Recorder,fetch:fetcher,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const until=async fn=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
 const pointer=(target,type,y)=>target.dispatchEvent(new window.MouseEvent(type,{bubbles:true,cancelable:true,clientY:y}));
 try{
  await import('../dist/app.js');document.querySelector('[data-action=nav][data-value=mine]').click();document.querySelector('[data-action=register]').click();
  const form=document.querySelector('#register-form');for(const [k,v] of Object.entries({nickname:'测试',username:'tester',password:'password-test-123',realName:'验收用户',phone:'13800000000'}))form.elements[k].value=v;form.elements.covenant.checked=true;form.elements.privacy.checked=true;form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  pointer(document.querySelector('#interview-hold'),'pointerdown',300);await until(()=>document.querySelector('#interview-hold').textContent.includes('秒'));
  pointer(document,'pointermove',200);assert.match(document.querySelector('#interview-hold').textContent,/取消/);pointer(document,'pointerup',200);await until(()=>!document.querySelector('#interview-hold').disabled);assert.equal(posts,0);
  pointer(document.querySelector('#interview-hold'),'pointerdown',300);await until(()=>document.querySelector('#interview-hold').textContent.includes('秒'));pointer(document,'pointerup',300);try{await until(()=>posts===1);}catch(e){console.log({posts,body:document.querySelector('.interview-composer').textContent});throw e;}
  finish({ok:false,status:429,json:async()=>({error:'SPEECH_PROVIDER_BUSY'})});await until(()=>document.querySelector('[data-action=lifestyle-transcribe]'));
  assert.match(document.querySelector('.form-error').textContent,/30 秒/);assert.ok(document.querySelector('audio'));
  document.querySelector('[data-action=lifestyle-transcribe]').click();await until(()=>posts===2);finish({ok:true,json:async()=>({text:'工作日朝九晚六，晚上七点到家。'})});
  await until(()=>document.querySelector('.topbar-title').textContent.includes('2 / 4'));
  assert.match(document.querySelector('.interview-bubble.human').textContent,/朝九晚六/);assert.equal(document.querySelector('select'),null);
 }finally{globalThis.fetch=realFetch;window.close();}
});