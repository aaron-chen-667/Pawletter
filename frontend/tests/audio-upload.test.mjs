import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeMonoWav} from '../dist/audio-upload.js';
import {createOnboardingSpeech} from '../dist/onboarding-speech.js';
test('speech WAV is mono PCM with correct sizes, sample rate and clipped samples',async()=>{
 const blob=encodeMonoWav(new Float32Array([-2,-.5,0,.5,2])),buffer=await blob.arrayBuffer(),view=new DataView(buffer);
 assert.equal(blob.type,'audio/wav');assert.equal(blob.size,54);assert.equal(view.getUint32(24,true),16000);
 assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint16(34,true),16);assert.equal(view.getUint32(40,true),10);
 assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(52,true),32767);
});
test('browser recording is normalized before upload and conversion cancellation sends nothing',async()=>{
 const input=new Blob(['webm'],{type:'audio/webm'}),wav=encodeMonoWav(new Float32Array(4000));let posts=0;
 const fetcher=async(url,options)=>url==='blob:audio'?{blob:async()=>input}:(posts++,assert.equal(options.body,wav),assert.equal(options.headers['Content-Type'],'audio/wav'),{ok:true,json:async()=>({text:'晚上在家。'})});
 const speech=createOnboardingSpeech(fetcher,async blob=>{assert.equal(blob,input);return wav;});
 assert.equal((await speech.transcribe('blob:audio')).text,'晚上在家。');assert.equal(posts,1);
 let finish;const cancelled=createOnboardingSpeech(fetcher,()=>new Promise(r=>finish=r));const pending=cancelled.transcribe('blob:audio');
 while(!finish)await new Promise(r=>setTimeout(r,0));cancelled.cancel();finish(wav);assert.equal(await pending,null);assert.equal(posts,1);
});
