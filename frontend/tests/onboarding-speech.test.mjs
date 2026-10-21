import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOnboardingSpeech} from '../dist/onboarding-speech.js';
test('speech uploads actual audio, reports failures and can retry the same recording',async()=>{
 let posts=0;const audio=new Blob(['RIFF0000WAVE'],{type:'audio/wav'});
 const speech=createOnboardingSpeech(async(url,options)=>{
  if(url==='blob:recording')return {blob:async()=>audio};
  posts++;assert.equal(options.body,audio);assert.equal(options.headers['Content-Type'],'audio/wav');
  return posts===1?{ok:false,status:429}:{ok:true,json:async()=>({text:'每天上班八小时。'})};
 });
 assert.match((await speech.transcribe('blob:recording')).error,/繁忙/);
 assert.equal((await speech.transcribe('blob:recording')).text,'每天上班八小时。');
});
test('leaving a question discards its late transcription',async()=>{
 let resolve,started;const ready=new Promise(r=>started=r);
 const speech=createOnboardingSpeech(async url=>url==='blob:recording'?{blob:async()=>new Blob(['a'])}:new Promise(r=>{resolve=r;started();}));
 const request=speech.transcribe('blob:recording');await ready;speech.cancel();
 resolve({ok:true,json:async()=>({text:'旧问题的回答'})});assert.equal(await request,null);
});
