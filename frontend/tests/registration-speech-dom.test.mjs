import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('stopping registration recording automatically transcribes, preserves audio on failure and supports retry',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/?flow=register',pretendToBeVisual:true});
 const {window}=dom;window.scrollTo=()=>{};
 const realFetch=globalThis.fetch;let posts=0,finish;
 const fetcher=(url,options)=>String(url).startsWith('blob:')?realFetch(url,options):new Promise(resolve=>{posts++;finish=resolve;});
 class Recorder{
  static isTypeSupported(){return true;}
  constructor(){this.state='inactive';this.mimeType='audio/webm';}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable({data:new Blob(['recorded speech'])});this.onstop();}
 }
 Object.defineProperty(window.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
 window.MediaRecorder=Recorder;
 for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,FormData:window.FormData,MediaRecorder:Recorder,fetch:fetcher,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const until=async fn=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
 try{
  await import('../dist/app.js');
  const form=document.querySelector('#register-form');form.elements.covenant.checked=true;form.elements.privacy.checked=true;
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  document.querySelector('[data-action=lifestyle-record]').click();await until(()=>document.querySelector('.lifestyle-mic.recording'));
  document.querySelector('[data-action=lifestyle-record]').click();await until(()=>posts===1);
  assert.equal(document.querySelector('#lifestyle-answer').disabled,true);
  finish({ok:false,status:502});await until(()=>document.querySelector('[data-action=lifestyle-transcribe]'));
  assert.ok(document.querySelector('audio'));
  document.querySelector('[data-action=lifestyle-transcribe]').click();await until(()=>posts===2);
  finish({ok:true,json:async()=>({text:'工作日朝九晚六，晚上七点到家。'})});
  await until(()=>document.querySelector('#lifestyle-answer').value.includes('朝九晚六'));
  assert.equal(document.querySelector('#lifestyle-answer').disabled,false);
 }finally{globalThis.fetch=realFetch;window.close();}
});
