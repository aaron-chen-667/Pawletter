import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {connectDatabase,transaction} from '../src/db.js';
const label='对未来领养家庭的照护要求（不是宠物已经具备的能力或已经发生的行为）：';
const example='【虚构示例观察，非照片中动物的真实记录】';
export async function clarifyExampleCare(db){
 const rows=JSON.parse(await readFile(new URL('../fixtures/public-examples.json',import.meta.url),'utf8'));
 return transaction(db,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(73021424)');
  let corrected=0;
  for(const pet of rows){
   const index=pet.notes.findIndex(n=>n.topic==='other');if(index<0)continue;
   const quote=pet.notes[index].quote.replace(label,''),oldId=pet.id+'-archive-'+index,newId=oldId+'-care-v2';
   const old=(await client.query('SELECT * FROM observations WHERE id=$1 FOR UPDATE',[oldId])).rows[0];
   // Never overwrite a caretaker edit, private record or withdrawal.
   if(!old||old.status!=='archived'||!old.share_with_agent||old.original_text!==example+quote)continue;
   const text=example+label+quote;
   const added=await client.query("INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,share_with_agent,status,transcript,replaces_id) VALUES($1,$2,$3,$1,$4,$5,true,'archived',$5,$6) ON CONFLICT(id) DO NOTHING RETURNING id",[newId,pet.id,old.author_id,createHash('sha256').update(text).digest('hex'),text,oldId]);
   if(!added.rows.length)continue;
   await client.query("UPDATE observations SET status='withdrawn',updated_at=now() WHERE id=$1",[oldId]);
   await client.query("INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty) VALUES($1,$2,$3,'other',$4,'pending')",[newId+'-note',newId,pet.id,text]);
   await client.query("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES($1,$2,'example.care.clarified',$3)",[newId+'-audit',old.author_id,pet.id]);
   corrected++;
  }
  return {corrected};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=connectDatabase();try{console.log(JSON.stringify(await clarifyExampleCare(db)));}
 catch{console.error('CARE_CLARIFICATION_FAILED');process.exitCode=1;}finally{await db.end();}
}
