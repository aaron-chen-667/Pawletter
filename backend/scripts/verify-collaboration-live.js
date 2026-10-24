// Real API/database acceptance with the collaborator's Origin and isolated QA records.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPawletterClient} from '../client/pawletter-api.js';
const base='https://pawletter-api-446222711695.asia-east1.run.app';
const origin='https://pawletter-preview.g1251020624.chatgpt.site';
const accounts=JSON.parse((await readFile(new URL('../.local/pawletter-test-accounts.json',import.meta.url),'utf8')).replace(/^\uFEFF/,'')).accounts;
const report={at:new Date().toISOString(),origin,checks:[]};
const fetcher=async(url,options={})=>{
 const response=await fetch(url,{...options,headers:{...options.headers,Origin:origin}});
 assert.equal(response.headers.get('access-control-allow-origin'),origin);
 return response;
};
const station=createPawletterClient(base,fetcher),adopter=createPawletterClient(base,fetcher);
let pet;const records=[];
const profile={species:'cat',internal:true,description:'内部跨域及数据库联调记录'};
function pass(name){report.checks.push(name);console.log('PASS '+name);}
try{
 for(const allowed of [origin,'https://pawletter-adoption-h5.chenaaron668.chatgpt.site']){
  for(const method of ['GET','POST','DELETE']){
   const r=await fetch(base+'/v1/pets',{method:'OPTIONS',headers:{Origin:allowed,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'Authorization,Content-Type,Idempotency-Key'}});
   assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),allowed);assert.ok(r.headers.get('access-control-allow-methods').includes(method));
  }
 }
 pass('both origins allow GET POST DELETE preflight');
 const rejected=await fetch(base+'/health',{headers:{Origin:origin+'.evil.invalid'}});assert.equal(rejected.headers.get('access-control-allow-origin'),null);pass('unlisted origin has no CORS permission');
 const speech=await fetcher(base+'/v1/onboarding/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:Buffer.from('invalid')});assert.equal(speech.status,400);assert.equal((await speech.json()).error,'INVALID_AUDIO_FILE');pass('preview passes speech origin check');
 for(const [role,client] of [['station',station],['adopter',adopter]]){const account=accounts.find(a=>a.role===role);await client.login(account.username,account.password);}
 pet=await station.createPet({name:'联调·协作数据库',profile,published:false});pass('create private pet');
 assert.ok((await station.pets()).pets.some(p=>p.id===pet.id));pass('read persisted pet');
 await station.updatePet(pet.id,{name:'联调·协作数据库已更新',profile,published:false});assert.equal((await station.pets()).pets.find(p=>p.id===pet.id).name,'联调·协作数据库已更新');pass('update persisted pet');
 await assert.rejects(adopter.updatePet(pet.id,{name:'unauthorized',profile,published:false}),e=>e.status===403);pass('adopter cannot update station pet');
 const first=await station.submitObservation(pet.id,{text:'协作测试原始记录。',shareWithAgent:false},randomUUID());records.push(first.id);
 assert.ok((await station.observations(pet.id)).observations.some(r=>r.id===first.id));pass('create and read observation');
 const correction=await station.submitObservation(pet.id,{text:'协作测试更正记录。',shareWithAgent:false,replacesId:first.id},randomUUID());records.push(correction.id);
 assert.equal((await station.observations(pet.id)).observations.find(r=>r.id===first.id).status,'withdrawn');pass('correct observation and invalidate old record');
 await station.withdrawObservation(correction.id);assert.equal((await station.observations(pet.id)).observations.find(r=>r.id===correction.id).status,'withdrawn');pass('DELETE withdraws persisted observation');
}catch(error){report.failure={name:error.name,status:error.status,message:error.name==='AssertionError'?'ASSERTION_FAILED':error.message};process.exitCode=1;console.log(JSON.stringify(report.failure));}
finally{
 const cleanup=[];
 for(const id of records)try{await station.withdrawObservation(id);}catch{cleanup.push('observation');}
 if(pet)try{await station.updatePet(pet.id,{name:'联调·协作验收已结束',profile,published:false});}catch{cleanup.push('pet');}
 await Promise.all([station.logout().catch(()=>cleanup.push('station session')),adopter.logout().catch(()=>cleanup.push('adopter session'))]);
 report.cleanup=cleanup.length?'incomplete':'complete';if(cleanup.length)process.exitCode=1;
 await writeFile(new URL('../.local/collaboration-report.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:report.checks.length,failure:report.failure,cleanup:report.cleanup}));
}
