// Live opt-in QA. Uses synthetic audio and an internal unpublished-after-test pet.
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createPawletterClient} from '../client/pawletter-api.js';
const base='https://pawletter-api-446222711695.asia-east1.run.app',origin='https://pawletter-adoption-h5.chenaaron668.chatgpt.site';
const credentials=JSON.parse(await readFile(new URL('../.local/pawletter-test-accounts.json',import.meta.url),'utf8'));
const staff=createPawletterClient(base);let token,pet,observation,application,stage='login';
const profile={species:'cat',character:'慢热、谨慎',description:'内部验收宠物，以下资料仅用于验证，不对应真实动物。',internal:true};
async function call(path,body,key){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error),{status:r.status});return data;}
async function archived(id){for(let n=0;n<30;n++){const row=(await staff.observations(pet.id)).observations.find(x=>x.id===id);if(row?.status==='archived')return;if(row?.status==='failed')throw new Error(row.error_code);await new Promise(r=>setTimeout(r,3000));}throw new Error('ARCHIVE_TIMEOUT');}
try{
 const account=credentials.accounts.find(a=>a.role==='station');await staff.login(account.username,account.password);
 pet=await staff.createPet({name:'联调·档案闭环',profile,published:true});assert.equal((await staff.agent(pet.id)).voice.tone,'shy');await staff.updateAgent(pet.id,{tone:'calm',style:'简短、安静，用第一人称回答；没有记录就说尚未了解。'});assert.equal((await staff.agent(pet.id)).voice.tone,'calm');
 assert.ok(!(await call('/v1/catalog')).pets.some(p=>p.id===pet.id));console.log('PASS create pet → archive-based agent → expression settings; internal pet hidden');
 stage='register';const answers={work:{text:'居家办公，每天离家不到两小时。',value:'short'},routine:{text:'早七晚十一，作息规律。',value:'regular'},free:{text:'每天两小时以上照护。',value:'over2'},expectation:{text:'希望认识安静的成年猫。',value:'quiet'}};
 const registered=await call('/v1/auth/register',{username:'qa_loop_'+Date.now(),password:randomBytes(24).toString('base64url'),nickname:'闭环验收',realName:'内部验收',phone:'00000000000',covenant:true,privacy:true,lifestyle:{answers}},randomUUID());token=registered.token;assert.equal(registered.profile.verification,'pending');
 stage='audio';const wav=await readFile(new URL('../.local/verification.wav',import.meta.url));const media=await staff.uploadAudio(pet.id,new Blob([wav],{type:'audio/wav'}));const body={mediaId:media.id,shareWithAgent:true},key=randomUUID();observation=await staff.submitObservation(pet.id,body,key);assert.equal((await staff.submitObservation(pet.id,body,key)).id,observation.id);await staff.processObservation(observation.id);await archived(observation.id);console.log('PASS real audio → automatic transcription → archived memory, retry idempotent');
 stage='answer';const answer=await call('/v1/pets/'+pet.id+'/chat',{question:'你平时喜欢玩什么？'});assert.ok(answer.citations.some(n=>n.quote.includes('逗猫棒')));assert.match(answer.answer,/逗猫棒/);console.log('PASS adopter answer cites this pet rescue archive');
 stage='correction';observation=await staff.submitObservation(pet.id,{text:'更正：之前说喜欢逗猫棒不准确。连续两周观察，它喜欢的是小球，看到逗猫棒会躲开。',shareWithAgent:true,replacesId:observation.id},randomUUID());await staff.processObservation(observation.id);await archived(observation.id);
 const changed=await call('/v1/pets/'+pet.id+'/chat',{question:'你平时喜欢哪一种玩具？'});assert.match(changed.answer,/小球/);assert.ok(changed.citations.some(n=>n.quote.includes('小球')));console.log('PASS rescue correction changes subsequent answer and source');
 stage='withdraw';await staff.withdrawObservation(observation.id);observation=null;const unknown=await call('/v1/pets/'+pet.id+'/chat',{question:'你平时喜欢什么玩具？'});assert.equal(unknown.citations.length,0);assert.match(unknown.answer,/没有|尚未|还不|不确定|暂时|未记录/);console.log('PASS withdrawn memory is not reused; unknown remains unknown');
 stage='application';application=await call('/v1/pets/'+pet.id+'/applications',{note:'内部验收申请，检查画像分享与第一视角通知。',memories:[],shareProfile:true},randomUUID());assert.equal(application.snapshot.realName,'内部验收');assert.ok((await staff.applications()).applications.some(a=>a.id===application.id));const history=await call('/v1/pets/'+pet.id+'/chat');assert.ok(history.messages.some(m=>m.from==='pet'&&m.text.includes('照顾我的人收到你的申请')));
 application=await staff.applicationStage(application.id,1,application.version);application=await staff.applicationStage(application.id,2,application.version);await assert.rejects(staff.applicationStage(application.id,3,application.version),e=>e.message==='IDENTITY_PENDING');console.log('PASS real application → station review → pet voice notification; pending identity blocks handover');
}catch(error){console.error(JSON.stringify({stage,ok:false,code:/^[A-Z_]{3,60}$/.test(error.message||'')?error.message:'ASSERTION_FAILED'}));process.exitCode=1;}
finally{
 if(observation)await staff.withdrawObservation(observation.id).catch(()=>{});
 if(application)await staff.applicationStage(application.id,-1,application.version).catch(()=>{});
 if(pet)await staff.updatePet(pet.id,{name:'联调·档案闭环',profile,published:false}).catch(()=>{});
 if(token)await call('/v1/auth/logout',{}).catch(()=>{});await staff.logout().catch(()=>{});
 console.log('QA cleanup finished: internal pet unpublished, pending application withdrawn, sessions revoked');
}
