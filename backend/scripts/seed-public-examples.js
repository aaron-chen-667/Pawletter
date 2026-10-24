import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {connectDatabase,transaction} from '../src/db.js';
import {defaultVoice} from '../src/pet-agent.js';

// Explicit administrator-run import. Never invoked on startup or by a public route.
// Stable IDs and insert-only writes preserve subsequent human edits and withdrawals.
export async function seedPublicExamples(db){
 const rows=JSON.parse(await readFile(new URL('../fixtures/public-examples.json',import.meta.url),'utf8'));
 return transaction(db,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(73021424)');
  let created=0;
  for(const pet of rows){
   await client.query('INSERT INTO stations(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[pet.stationId,pet.stationName]);
   const author='archive-author-'+pet.stationId;
   await client.query("INSERT INTO users(id,username,password_hash,role,station_id,active) VALUES($1,$1,$2,'station',$3,false) ON CONFLICT(id) DO NOTHING",[author,randomBytes(48).toString('hex'),pet.stationId]);
   const inserted=await client.query('INSERT INTO pets(id,station_id,name,profile,published) VALUES($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING RETURNING id',[pet.id,pet.stationId,pet.name,JSON.stringify(pet.profile)]);
   if(!inserted.rows.length)continue;
   created++;
   await client.query('INSERT INTO pet_agents(pet_id,voice) VALUES($1,$2)',[pet.id,JSON.stringify(defaultVoice(pet.profile))]);
   for(const [index,note] of pet.notes.entries()){
    const id=pet.id+'-archive-'+index,text='【虚构示例观察，非照片中动物的真实记录】'+note.quote;
    const certainty=/待|不确定|尚未|需.*核对/.test(note.quote)?'pending':note.topic==='health'?'observation':'ongoing';
    await client.query("INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,share_with_agent,status,transcript) VALUES($1,$2,$3,$1,$4,$5,true,'archived',$5)",[id,pet.id,author,createHash('sha256').update(text).digest('hex'),text]);
    await client.query('INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty) VALUES($1,$2,$3,$4,$5,$6)',[id+'-note',id,pet.id,note.topic,text,certainty]);
   }
   await client.query("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES($1,$2,'example.archive.imported',$3)",[pet.id+'-import',author,pet.id]);
  }
  return {created,skipped:rows.length-created,total:rows.length};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=connectDatabase();
 try{console.log(JSON.stringify(await seedPublicExamples(db)));}
 catch{console.error('Example import failed; transaction rolled back. Check database access and schema.');process.exitCode=1;}
 finally{await db.end();}
}
