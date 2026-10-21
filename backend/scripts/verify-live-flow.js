// Explicit opt-in cloud integration check. Reads local test credentials, prints only status.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createPawletterClient} from '../client/pawletter-api.js';
const base='https://pawletter-api-446222711695.asia-east1.run.app';
const credentials=JSON.parse(await readFile(new URL('../.local/pawletter-test-accounts.json',import.meta.url),'utf8'));
const staff=createPawletterClient(base),adopter=createPawletterClient(base);
let observationId,stage='login';
async function waitArchived(petId,id){
 for(let n=0;n<30;n++){
  const r=(await staff.observations(petId)).observations.find(r=>r.id===id);
  if(r?.status==='archived')return;
  if(r?.status==='failed')throw new Error(r.error_code||'PROCESSING_FAILED');
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 throw new Error('ARCHIVE_TIMEOUT');
}
try{
 for(const [client,role] of [[staff,'station'],[adopter,'adopter']]){const a=credentials.accounts.find(a=>a.role===role);await client.login(a.username,a.password);}
 console.log('PASS authenticated roles');
 let p=(await staff.pets()).pets.find(p=>p.name==='联调·吐司');
 if(!p){const created=await staff.createPet({name:'联调·吐司',profile:{species:'cat',description:'虚构的内部联调宠物，用于验证语音记录和 Agent 问答。'},published:true});p={id:created.id};}
 assert.ok((await adopter.pets()).pets.some(x=>x.id===p.id));
 await assert.rejects(adopter.createPet({name:'越权测试',profile:{species:'cat'},published:false}),e=>e.status===403);
 console.log('PASS pet visibility and station permission');
 const wav=await readFile(new URL('../.local/verification.wav',import.meta.url));
 const uploaded=await staff.uploadAudio(p.id,new Blob([wav],{type:'audio/wav'}));
 const body={mediaId:uploaded.id,shareWithAgent:true},key=randomUUID();
 const record=await staff.submitObservation(p.id,body,key);observationId=record.id;
 const duplicate=await staff.submitObservation(p.id,body,key);assert.equal(duplicate.id,record.id);assert.equal(duplicate.duplicate,true);
 console.log('PASS real audio upload and duplicate protection');
 stage='archive';await staff.processObservation(record.id);
 await waitArchived(p.id,record.id);
 stage='knowledge';
 assert.ok((await adopter.knowledge(p.id)).notes.some(n=>n.quote.includes('逗猫棒')));
 stage='cited_answer';const answer=await adopter.chat(p.id,'它平时喜欢玩什么？');assert.ok(answer.citations.some(n=>n.quote.includes('逗猫棒')));
 console.log('PASS transcription, archive, adopter knowledge and cited answer');
 stage='correction';const correction=await staff.submitObservation(p.id,{text:'之前说喜欢逗猫棒不准确，目前还不确定它喜欢哪种玩具。',shareWithAgent:true,replacesId:record.id},randomUUID());
 observationId=correction.id;
 assert.ok(!(await adopter.knowledge(p.id)).notes.some(n=>n.quote.includes('每天晚上')));
 await staff.processObservation(correction.id);
 await waitArchived(p.id,correction.id);
 const corrected=(await adopter.knowledge(p.id)).notes;assert.ok(corrected.some(n=>n.certainty==='pending'&&n.quote.includes('不准确')));
 await staff.withdrawObservation(correction.id);observationId=null;
 const remaining=(await adopter.knowledge(p.id)).notes;assert.equal(remaining.length,0);
 const unknown=await adopter.chat(p.id,'它喜欢玩什么？');assert.equal(unknown.citations.length,0);
 console.log('PASS correction and withdrawal remove facts from new answers');
}catch(e){console.error(JSON.stringify({check:'live_flow',stage,ok:false,code:/^[A-Z_]{3,50}$/.test(e.message||'')?e.message:'VERIFICATION_FAILED'}));process.exitCode=1;}
finally{
 if(observationId)await staff.withdrawObservation(observationId).catch(()=>{});
 await Promise.allSettled([staff.logout(),adopter.logout()]);
}
