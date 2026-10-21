import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createObservationSender,errorMessage} from '../dist/online-flow.js';
test('retry keeps pet, audio upload, consent, correction and idempotency key immutable',async()=>{
 const calls=[];let uploads=0,attempts=0;
 const client={uploadAudio:async()=>{uploads++;return{id:'audio-1'};},submitObservation:async(...args)=>{calls.push(structuredClone(args));if(++attempts===1)throw Error('network');return{id:'obs-1',duplicate:true};}};
 const sender=createObservationSender(client,()=> 'same-key');
 await assert.rejects(sender.send({petId:'pet-a',audio:new Blob(['audio']),text:'',shareWithAgent:false,replacesId:'old'}));
 assert.equal(sender.pending,true);
 const result=await sender.send({petId:'pet-b',text:'different',shareWithAgent:true});
 assert.equal(uploads,1);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1][0],'pet-a');assert.equal(calls[1][1].shareWithAgent,false);assert.equal(calls[1][1].replacesId,'old');assert.equal(result.petId,'pet-a');assert.equal(sender.pending,false);
});
test('concurrent submit cannot duplicate records; retry does not overlap an active request',async()=>{
 let resolve;let count=0;const client={submitObservation:()=>{count++;return new Promise(r=>resolve=r);}};
 const sender=createObservationSender(client,()=> 'key');
 const first=sender.send({petId:'p',text:'每天喜欢玩。',shareWithAgent:true});
 await assert.rejects(sender.send(),/SUBMISSION_BUSY/);assert.throws(()=>sender.discard(),/SUBMISSION_BUSY/);
 resolve({id:'one'});await first;assert.equal(count,1);sender.discard();
});
test('empty input is rejected before networking and private notes remain opt-in',async()=>{
 const calls=[];const sender=createObservationSender({submitObservation:async(...args)=>{calls.push(args);return{id:'one'};}},()=> 'key');
 await assert.rejects(sender.send({petId:'p',text:'  '}),/EMPTY_OBSERVATION/);
 await sender.send({petId:'p',text:'  今天不愿被抱。  '});assert.equal(calls[0][1].shareWithAgent,false);assert.equal(calls[0][1].text,'今天不愿被抱。');
 assert.match(errorMessage({message:'SESSION_EXPIRED'}),/重新登录/);
});
