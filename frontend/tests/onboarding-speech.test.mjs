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
 const speech=createOnboardingSpeech(async url=>url==='blob:recording'?{blob:async()=>new Blob(['a'],{type:'audio/wav'})}:new Promise(r=>{resolve=r;started();}));
 const request=speech.transcribe('blob:recording');await ready;speech.cancel();
 resolve({ok:true,json:async()=>({text:'旧问题的回答'})});assert.equal(await request,null);
});
test('network failure preserves a retryable recording and never exposes browser errors',async()=>{
 let uploads=0;const speech=createOnboardingSpeech(async url=>{
  if(url==='blob:saved')return {blob:async()=>new Blob(['RIFF0000WAVE'],{type:'audio/wav'})};
  if(++uploads===1)throw new TypeError('Failed to fetch');
  return {ok:true,json:async()=>({text:'今天食欲正常。'})};
 });
 const failed=await speech.transcribe('blob:saved');assert.match(failed.error,/连接不上语音服务.*录音已保留/);assert.doesNotMatch(failed.error,/Failed to fetch/);
 assert.equal((await speech.transcribe('blob:saved')).text,'今天食欲正常。');assert.equal(uploads,2);
});
test('unreadable local recording is distinguished from upload failure and sends nothing',async()=>{
 const speech=createOnboardingSpeech(async()=>{throw new TypeError('Failed to fetch');});
 const result=await speech.transcribe('blob:expired');assert.match(result.error,/录音暂时无法读取/);assert.doesNotMatch(result.error,/录音已保留|Failed to fetch/);
});
