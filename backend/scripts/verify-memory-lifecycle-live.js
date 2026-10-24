// Explicit real-provider QA; only creates internal test pets and revokes its own records.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createPawletterClient} from '../client/pawletter-api.js';
const base='https://pawletter-api-446222711695.asia-east1.run.app';
const accounts=JSON.parse((await readFile(new URL('../.local/pawletter-test-accounts.json',import.meta.url),'utf8')).replace(/^\uFEFF/,'')).accounts;
const staff=createPawletterClient(base),adopter=createPawletterClient(base),report={at:new Date().toISOString(),checks:{},answers:{}};
const pets=[],observations=[];let stage='login';
const profile={species:'cat',character:'安静、独立',description:'内部验收档案，不对应真实动物。',internal:true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ask(id,text){await sleep(5000);for(let n=0;n<2;n++)try{return await adopter.chat(id,text);}catch(e){if(n===0&&[429,502].includes(e.status)){await sleep(31000);continue;}throw e;}}
async function record(petId,text,extra={}){
 const r=await staff.submitObservation(petId,{text,shareWithAgent:true,...extra},randomUUID());observations.push(r.id);await staff.processObservation(r.id);
 for(let n=0;n<24;n++){
  const row=(await staff.observations(petId)).observations.find(o=>o.id===r.id);
  if(row?.status==='archived')return r;
  if(row?.status==='failed')throw Error(row.error_code);
  await sleep(5000);
 }
 throw Error('ARCHIVE_TIMEOUT');
}
function pass(name){report.checks[name]=true;console.log('PASS '+name);}
try{
 for(const [role,client] of [['station',staff],['adopter',adopter]]){const a=accounts.find(a=>a.role===role);await client.login(a.username,a.password);}
 for(const name of ['联调·记忆甲','联调·记忆乙'])pets.push(await staff.createPet({name,profile,published:true}));
 const [one,two]=pets;
 stage='baseline';const unknown=await ask(one.id,'我最想知道你平时喜欢哪种玩具？');assert.equal(unknown.citations.length,0);pass('unknown before archive');
 stage='archive';const old=await record(one.id,'连续两周观察，它每天喜欢玩蓝色小球，看到羽毛逗猫棒会躲开。');
 const answer=await ask(one.id,'你平时喜欢哪种玩具？');report.answers.before=answer;assert.match(answer.answer,/蓝色的?小球/);assert.ok(answer.citations.some(c=>c.observation_id===old.id));pass('rescuer observation becomes cited memory');
 stage='private';const hidden=await record(one.id,'它每天把紫色布包当作最喜欢的玩具。',{shareWithAgent:false});
 assert.ok(!(await adopter.knowledge(one.id)).notes.some(n=>n.observation_id===hidden.id));
 const privateAnswer=await ask(one.id,'你最喜欢的玩具是什么？');assert.doesNotMatch(privateAnswer.answer,/紫色的?布包/);pass('private observation excluded');
 stage='isolation';await record(two.id,'连续两周观察，它每天喜欢玩黄色毛线球，其他玩具暂时不感兴趣。');
 const other=await ask(two.id,'你平时喜欢哪种玩具？');report.answers.other=other;assert.match(other.answer,/黄色的?毛线球/);assert.doesNotMatch(other.answer,/蓝色的?小球/);assert.ok(other.citations.every(c=>c.observation_id!==old.id));pass('other pet memory isolated');
 stage='correction';const revised=await staff.submitObservation(one.id,{text:'更正之前的记录：连续三周观察，它最喜欢的是红色布老鼠，蓝色小球已经不再感兴趣。',shareWithAgent:true,replacesId:old.id},randomUUID());observations.push(revised.id);
 assert.ok(!(await adopter.knowledge(one.id)).notes.some(n=>n.observation_id===old.id));pass('correction immediately invalidates original');
 await staff.processObservation(revised.id);const corrected=(await staff.observations(one.id)).observations.find(o=>o.id===revised.id);assert.equal(corrected.status,'archived');
 const changed=await ask(one.id,'你现在最喜欢哪种玩具？');report.answers.after=changed;assert.match(changed.answer,/红色的?布老鼠/);assert.ok(changed.citations.some(c=>c.observation_id===revised.id));assert.ok(changed.citations.every(c=>c.observation_id!==old.id));pass('updated archive changes next answer');
 stage='style';const before=await staff.agent(one.id);await staff.updateAgent(one.id,{tone:'calm',style:'保持安静、简短。只用两句话回答，不用感叹号，不用叠词或汪喵语气。'});const after=await staff.agent(one.id);assert.equal(after.revision,before.revision+1);
 const styled=await ask(one.id,'你现在最喜欢什么玩具？');report.answers.styled=styled;assert.match(styled.answer,/红色的?布老鼠/);assert.doesNotMatch(styled.answer,/[!！]/);pass('expression update preserves archived facts');
 stage='withdrawal';await staff.withdrawObservation(revised.id);const withdrawn=await ask(one.id,'你最喜欢的玩具是什么？');report.answers.withdrawn=withdrawn;assert.equal(withdrawn.citations.length,0);assert.doesNotMatch(withdrawn.answer,/红色的?布老鼠|蓝色的?小球|紫色的?布包/);assert.match(withdrawn.answer,/不知道|不清楚|没.*记录|未.*记录|不确定|尚未/);pass('withdrawn memory not reused');
 stage='public';const catalog=await (await fetch(base+'/v1/catalog')).json();assert.ok(pets.every(p=>!catalog.pets.some(x=>x.id===p.id)));pass('QA pets excluded from public catalog');
}catch(e){report.failure={stage,status:e.status,code:/^[A-Z_]+$/.test(e.message||'')?e.message:'ASSERTION_FAILED'};console.log(JSON.stringify(report.failure));process.exitCode=1;}
finally{
 const cleanup=[];
 for(const id of observations)try{await staff.withdrawObservation(id);}catch{cleanup.push('observation');}
 for(const pet of pets)try{await staff.updatePet(pet.id,{name:'联调·记忆验收已结束',profile,published:false});}catch{cleanup.push('pet');}
 await Promise.all([staff.logout().catch(()=>cleanup.push('session')),adopter.logout().catch(()=>cleanup.push('session'))]);
 report.cleanup=cleanup.length?'incomplete':'complete';await writeFile(new URL('../.local/memory-lifecycle-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,cleanup:report.cleanup}));
}
