// Targeted follow-up after correcting the public example source records.
import {readFile,writeFile} from 'node:fs/promises';
import {createPawletterClient} from '../client/pawletter-api.js';
const base='https://pawletter-api-446222711695.asia-east1.run.app';
const local=name=>new URL('../.local/'+name,import.meta.url);
const credentials=JSON.parse((await readFile(local('pawletter-test-accounts.json'),'utf8')).replace(/^\uFEFF/,''));
const account=credentials.accounts.find(a=>a.role==='adopter'),client=createPawletterClient(base);
const report={at:new Date().toISOString(),sources:[],answers:[],failures:[]};
try{
 await client.login(account.username,account.password);
 const response=await fetch(base+'/v1/catalog');if(!response.ok)throw Error('CATALOG_UNAVAILABLE');
 const pets=(await response.json()).pets.filter(p=>p.id.startsWith('example-pet-'));
 if(pets.length!==17)throw Error('CATALOG_COUNT_MISMATCH');
 for(const pet of pets){
  const {notes}=await client.knowledge(pet.id);
  const passed=notes.some(n=>n.id===pet.id+'-archive-2-care-v2-note'&&n.quote.includes('对未来领养家庭的照护要求'))&&!notes.some(n=>n.id===pet.id+'-archive-2-note');
  report.sources.push({pet:pet.name,passed});if(!passed)report.failures.push({pet:pet.name,check:'corrected source active, old source absent'});
 }
 for(const id of ['example-pet-cookie','example-pet-cola','example-pet-pancake']){
  const pet=pets.find(p=>p.id===id);if(!pet)throw Error('TARGET_PET_NOT_FOUND');
  const reply=await client.chat(id,'介绍一下你自己，再说说对领养家庭的照护要求。请分清你的已有习惯与对未来家人的要求，不要把照护要求当成你已经具备的能力。');
  const {notes}=await client.knowledge(id),ids=new Set(notes.map(n=>n.id));
  const passed=reply.citations.length>0&&reply.citations.every(c=>ids.has(c.id));
  report.answers.push({id,name:pet.name,...reply,passed});if(!passed)report.failures.push({id,check:'current own sources'});
  console.log(JSON.stringify({pet:pet.name,answer:reply.answer,passed}));
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 // Re-evaluate the saved full run without changing its original result or pretending to rerun it.
 const previous=JSON.parse(await readFile(local('all-pet-agents-report.json'),'utf8'));
 report.previousRunReassessment={at:previous.at,pets:previous.pets.length,corePassed:previous.pets.every(p=>p.passed),careBoundaryPassed:/不能|不是|不代表|不等于|不知道|不清楚|未.*记录|没.*记录|没有.*记/.test(previous.careRequirementBoundary.answer),reason:'Original assertion omitted the valid denial 不是; raw report retained.'};
 if(!report.previousRunReassessment.corePassed||!report.previousRunReassessment.careBoundaryPassed)report.failures.push({check:'previous run reassessment'});
 await writeFile(local('care-clarification-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({sources:report.sources.length,answers:report.answers.length,reassessment:report.previousRunReassessment,failures:report.failures.length}));
 if(report.failures.length)process.exitCode=1;
}finally{await client.logout().catch(()=>{});}
