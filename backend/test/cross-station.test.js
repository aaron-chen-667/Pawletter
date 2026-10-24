import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/db.js';
import {provision,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
import {setStationReadAccess} from '../scripts/set-station-read-access.js';

const password='cross-station-test-password';
const audio=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(20)]);
const photo=Buffer.concat([Buffer.from([255,216]),Buffer.alloc(24)]);
const photoUrl='data:image/jpeg;base64,'+photo.toString('base64');
const dueAt='2026-11-01T02:00:00.000Z';
const ids=values=>values.map(value=>value.id).sort();

async function fixture(t){
 const engine=new PGlite();
 const query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params);
 const db={query,connect:async()=>({query,release(){}})};
 await migrate(db);await migrate(db);
 const users={};
 for(const [username,role,stationId] of [['developer','station','home'],['other-staff','station','other'],['applicant','adopter',null],['outsider','adopter',null]]){
  await provision(db,{username,password,role,stationId,stationName:stationId==='home'?'原救助站':'其他救助站'});
  users[username]=await login(db,username,password);
 }
 const blobs=new Map();let answerContext;
 const storage={put:async(key,value)=>blobs.set(key,value),read:async key=>blobs.get(key),remove:async key=>blobs.delete(key)};
 const ai={answer:async context=>{answerContext=context;return {answer:'没有可公开的记录。',citationIds:[]};}};
 const app=await createApp({db,ai,storage});
 t.after(async()=>{await app.close();await engine.close();});
 const request=(username,method,url,payload,headers={})=>app.inject({method,url,headers:{...(username?{authorization:'Bearer '+users[username].token}:{}),...headers},...(payload===undefined?{}:{payload})});
 async function seedPet(stationId,ownerId,published=false,stage=3){
  const pet={id:randomUUID(),observationId:randomUUID(),knowledgeId:randomUUID(),audioId:randomUUID(),visualId:randomUUID(),intakeId:randomUUID(),applicationId:randomUUID(),followupId:stage===3?randomUUID():null};
  await db.query('INSERT INTO pets(id,station_id,name,profile,published) VALUES($1,$2,$3,$4,$5)',[pet.id,stationId,stationId+'的宠物',JSON.stringify({species:'cat',description:'来自原救助站的档案。'}),published]);
  await db.query('INSERT INTO pet_agents(pet_id,voice) VALUES($1,$2)',[pet.id,JSON.stringify({tone:'calm',style:'轻声表达'})]);
  await db.query("INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,transcript,share_with_agent,status) VALUES($1,$2,$3,$4,'fixture','私有原始观察。','私有原始观察。',false,'archived')",[pet.observationId,pet.id,ownerId,randomUUID()]);
  await db.query("INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty) VALUES($1,$2,$3,'health','私有原始观察。','pending')",[pet.knowledgeId,pet.observationId,pet.id]);
  for(const [id,object,mime,bytes] of [[pet.audioId,`pets/${pet.id}/audio/${pet.audioId}`,'audio/webm',audio],[pet.visualId,`pets/${pet.id}/visual/0`,'image/jpeg',photo]]){
   blobs.set(object,bytes);
   await db.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size,shared) VALUES($1,$2,$3,$4,$5,$6,false)',[id,pet.id,ownerId,object,mime,bytes.length]);
  }
  await db.query("INSERT INTO pet_intakes(id,author_id,pet_id,request_hash,source_text,ocr_text,observation_id) VALUES($1,$2,$3,'fixture','私有录入原文。','私有材料 OCR。',$4)",[pet.intakeId,ownerId,pet.id,pet.observationId]);
  await db.query("INSERT INTO adoption_applications(id,pet_id,adopter_id,station_id,snapshot,note,stage,idempotency_key) VALUES($1,$2,$3,$4,$5,'演示申请',$6,$7)",[pet.applicationId,pet.id,users.applicant.user.id,stationId,JSON.stringify({nickname:'演示申请人',phone:'13800000000'}),stage,randomUUID()]);
  if(pet.followupId)await db.query("INSERT INTO rescue_followups(id,application_id,due_at,history,idempotency_key,request_hash) VALUES($1,$2,$3,'[]',$4,'fixture')",[pet.followupId,pet.applicationId,dueAt,randomUUID()]);
  return pet;
 }
 const home=await seedPet('home',users.developer.user.id);
 const privateOther=await seedPet('other',users['other-staff'].user.id,false,0);
 const publicOther=await seedPet('other',users['other-staff'].user.id,true);
 return {db,app,users,blobs,request,seedPet,home,privateOther,publicOther,get answerContext(){return answerContext;}};
}

test('cross-station access defaults off and cannot elevate adopter or client-supplied claims',async t=>{
 const f=await fixture(t),{db,request,users,home,privateOther,publicOther}=f;
 assert.ok((await db.query('SELECT read_all_stations FROM users')).rows.every(row=>row.read_all_stations===false));
 assert.equal(users.developer.user.canReadAllStations,false);
 assert.equal((await request('developer','GET','/v1/me')).json().canReadAllStations,false);
 assert.deepEqual(ids((await request('developer','GET','/v1/pets')).json().pets),[home.id]);
 assert.deepEqual(ids((await request('developer','GET','/v1/stations')).json().stations),['home']);
 assert.deepEqual(ids((await request('developer','GET','/v1/applications')).json().applications),[home.applicationId]);
 assert.deepEqual(ids((await request('developer','GET','/v1/followups')).json().followups),[home.followupId]);
 assert.equal((await request('developer','GET',`/v1/pets/${privateOther.id}`)).statusCode,404);
 for(const path of [`/v1/pets/${publicOther.id}/observations`,`/v1/pets/${publicOther.id}/intake`,`/v1/media/${publicOther.audioId}`,`/v1/pets/${publicOther.id}/visual/0`]){
  assert.equal((await request('developer','GET',path)).statusCode,403,path);
 }
 assert.deepEqual((await request('developer','GET',`/v1/pets/${publicOther.id}/knowledge`)).json().notes,[]);
 assert.equal((await request(null,'GET','/v1/stations')).statusCode,401);
 await db.query('UPDATE users SET read_all_stations=true WHERE id=$1',[users.outsider.user.id]);
 assert.equal((await request('outsider','GET','/v1/me')).json().canReadAllStations,false);
 assert.equal((await login(db,'outsider',password)).user.canReadAllStations,false);
 assert.deepEqual(ids((await request('outsider','GET','/v1/pets')).json().pets),[publicOther.id]);
 assert.deepEqual((await request('outsider','GET','/v1/applications')).json().applications,[]);
 assert.equal((await request('outsider','GET','/v1/followups')).statusCode,403);
 assert.equal((await request('outsider','GET','/v1/stations')).statusCode,403);
 assert.equal((await request('outsider','GET',`/v1/pets/${privateOther.id}`)).statusCode,404);
 assert.equal((await request('outsider','GET',`/v1/media/${publicOther.audioId}`)).statusCode,403);
 assert.equal((await request('outsider','GET',`/v1/pets/${publicOther.id}/visual/0`)).statusCode,403);
 assert.deepEqual((await request('outsider','GET',`/v1/pets/${publicOther.id}/knowledge`)).json().notes,[]);
 const forged=await request(null,'POST','/v1/auth/login',{username:'developer',password,canReadAllStations:true});
 assert.equal(forged.statusCode,400,forged.body);
});

test('grant and revoke take effect on existing sessions, including future stations and private files',async t=>{
 const f=await fixture(t),{db,request,users,home,privateOther,publicOther,seedPet}=f;
 const grant=await setStationReadAccess(db,{username:'developer',enabled:true});
 assert.equal(grant.canReadAllStations,true);assert.equal(grant.stationId,'home');
 assert.equal((await request('developer','GET','/v1/me')).json().canReadAllStations,true);
 assert.equal((await login(db,'developer',password)).user.canReadAllStations,true);
 assert.deepEqual(ids((await request('developer','GET','/v1/pets')).json().pets),ids([home,privateOther,publicOther]));
 const stations=(await request('developer','GET','/v1/stations')).json().stations;
 assert.deepEqual(ids(stations),['home','other']);assert.ok(stations.every(row=>typeof row.name==='string'&&row.name));
 const petResponse=await request('developer','GET',`/v1/pets/${privateOther.id}`);
 assert.equal(petResponse.statusCode,200,petResponse.body);assert.equal(petResponse.json().stationId,'other');
 assert.equal((await request('developer','GET',`/v1/pets/${privateOther.id}/agent`)).json().voice.tone,'calm');
 assert.deepEqual(ids((await request('developer','GET',`/v1/pets/${privateOther.id}/observations`)).json().observations),[privateOther.observationId]);
 assert.deepEqual(ids((await request('developer','GET',`/v1/pets/${privateOther.id}/knowledge`)).json().notes),[privateOther.knowledgeId]);
 const intake=(await request('developer','GET',`/v1/pets/${privateOther.id}/intake`)).json();
 assert.equal(intake.source_text,'私有录入原文。');assert.equal(intake.ocr_text,'私有材料 OCR。');assert.equal(intake.visuals.length,1);
 const raw=await request('developer','GET',`/v1/media/${privateOther.audioId}`);
 assert.equal(raw.statusCode,200,raw.body);assert.deepEqual(raw.rawPayload,audio);
 const visual=await request('developer','GET',`/v1/pets/${privateOther.id}/visual/0`);
 assert.equal(visual.statusCode,200,visual.body);assert.deepEqual(visual.rawPayload,photo);
 assert.deepEqual(ids((await request('developer','GET','/v1/applications')).json().applications),[home.applicationId,privateOther.applicationId,publicOther.applicationId].sort());
 const followups=(await request('developer','GET','/v1/followups')).json().followups;
 assert.deepEqual(ids(followups),[home.followupId,publicOther.followupId].sort());
 assert.equal(followups.find(row=>row.id===publicOther.followupId).stationId,'other');
 assert.equal((await request('developer','GET',`/v1/pets/${privateOther.id}/chat`)).statusCode,404);
 assert.equal((await request('developer','POST',`/v1/pets/${privateOther.id}/chat`,{question:'告诉我私有观察。'})).statusCode,404);
 const chat=await request('developer','POST',`/v1/pets/${publicOther.id}/chat`,{question:'健康情况怎么样？'});
 assert.equal(chat.statusCode,200,chat.body);assert.deepEqual(f.answerContext.notes,[]);
 await provision(db,{username:'future-staff',password,role:'station',stationId:'future',stationName:'未来新增的救助站'});
 const futureUser=(await db.query("SELECT id FROM users WHERE username='future-staff'")).rows[0];
 const future=await seedPet('future',futureUser.id);
 assert.deepEqual(ids((await request('developer','GET','/v1/stations')).json().stations),['future','home','other']);
 assert.ok((await request('developer','GET','/v1/pets')).json().pets.some(row=>row.id===future.id&&row.stationId==='future'));
 assert.ok((await request('developer','GET','/v1/applications')).json().applications.some(row=>row.id===future.applicationId));
 assert.ok((await request('developer','GET','/v1/followups')).json().followups.some(row=>row.id===future.followupId&&row.stationId==='future'));
 assert.equal((await request('developer','GET',`/v1/pets/${future.id}/visual/0`)).statusCode,200);
 const revoked=await setStationReadAccess(db,{username:'developer',enabled:false});assert.equal(revoked.canReadAllStations,false);
 assert.equal((await request('developer','GET','/v1/me')).json().canReadAllStations,false);
 assert.deepEqual(ids((await request('developer','GET','/v1/pets')).json().pets),[home.id]);
 assert.deepEqual(ids((await request('developer','GET','/v1/stations')).json().stations),['home']);
 assert.deepEqual(ids((await request('developer','GET','/v1/applications')).json().applications),[home.applicationId]);
 assert.deepEqual(ids((await request('developer','GET','/v1/followups')).json().followups),[home.followupId]);
 assert.equal((await request('developer','GET',`/v1/pets/${future.id}`)).statusCode,404);
 assert.equal((await request('developer','GET',`/v1/media/${privateOther.audioId}`)).statusCode,403);
 assert.equal((await request('developer','GET',`/v1/pets/${privateOther.id}/visual/0`)).statusCode,403);
 const audit=(await db.query("SELECT action,target_id FROM audit_events WHERE action LIKE 'station.read_all_stations.%' ORDER BY created_at,id")).rows;
 assert.deepEqual(audit.map(row=>row.action).sort(),['station.read_all_stations.granted','station.read_all_stations.revoked']);
 assert.ok(audit.every(row=>row.target_id===users.developer.user.id));
});

test('cross-station reads never grant other-station writes and rejected requests leave data unchanged',async t=>{
 const {db,request,blobs,home,privateOther,publicOther}=await fixture(t);
 await setStationReadAccess(db,{username:'developer',enabled:true});
 async function state(){
  const rows={};
  for(const [table,key] of [['pets','id'],['pet_agents','pet_id'],['media','id'],['observations','id'],['knowledge','id'],['pet_intakes','id'],['media_batches','id'],['chats','id'],['adoption_applications','id'],['rescue_followups','id'],['audit_events','id']])rows[table]=(await db.query(`SELECT * FROM ${table} ORDER BY ${key}`)).rows;
  return {rows,blobs:[...blobs.entries()].sort(([a],[b])=>a.localeCompare(b))};
 }
 const before=await state();
 const forbidden=[
  ['POST',`/v1/pets/${privateOther.id}/profile`,{name:'不应更新',profile:{species:'cat'},published:true}],
  ['POST',`/v1/pets/${privateOther.id}/agent`,{tone:'lively',style:''}],
  ['POST',`/v1/pets/${privateOther.id}/audio`,audio,{'content-type':'audio/webm'}],
  ['POST',`/v1/pets/${privateOther.id}/observations`,{text:'不应写入',shareWithAgent:true},{'idempotency-key':randomUUID()}],
  ['POST',`/v1/pets/${privateOther.id}/visuals`,{photos:[photoUrl],shared:true},{'idempotency-key':randomUUID()}],
  ['POST',`/v1/observations/${privateOther.observationId}/retry`],
  ['POST',`/v1/observations/${privateOther.observationId}/process`],
  ['DELETE',`/v1/observations/${privateOther.observationId}`],
  ['POST',`/v1/applications/${privateOther.applicationId}/stage`,{stage:1,version:1}],
  ['POST','/v1/followups',{applicationId:publicOther.applicationId,dueAt,note:'不应安排'},{'idempotency-key':randomUUID()}],
  ['POST',`/v1/followups/${publicOther.followupId}`,{status:'completed',note:'不应更新',dueAt,version:1,requestId:randomUUID()}],
 ];
 for(const [method,path,payload,headers] of forbidden){const result=await request('developer',method,path,payload,headers);assert.equal(result.statusCode,403,method+' '+path+' '+result.body);}
 const forgedPet=await request('developer','POST','/v1/pets',{name:'不能指定他站',profile:{species:'cat'},published:false,stationId:'other'});
 assert.equal(forgedPet.statusCode,400,forgedPet.body);
 const forgedIntake=await request('developer','POST','/v1/intake/commit',{name:'不能指定他站',profile:{species:'cat'},published:false,text:'',ocrText:'',photos:[photoUrl],stationId:'other'},{'idempotency-key':randomUUID()});
 assert.equal(forgedIntake.statusCode,400,forgedIntake.body);
 assert.deepEqual(await state(),before);
 assert.equal((await request('developer','POST',`/v1/pets/${home.id}/profile`,{name:'本站可修改',profile:{species:'cat'},published:false})).statusCode,200);
 assert.equal((await request('developer','POST',`/v1/pets/${home.id}/agent`,{tone:'gentle',style:''})).statusCode,200);
 assert.equal((await request('developer','POST',`/v1/pets/${home.id}/observations`,{text:'本站新增观察'},{'idempotency-key':randomUUID()})).statusCode,202);
 assert.equal((await request('developer','POST',`/v1/followups/${home.followupId}`,{status:'completed',note:'本站可更新',dueAt,version:1,requestId:randomUUID()})).statusCode,200);
 const created=await request('developer','POST','/v1/pets',{name:'新增仍归本站',profile:{species:'cat'},published:false});
 assert.equal(created.statusCode,201,created.body);
 assert.equal((await db.query('SELECT station_id FROM pets WHERE id=$1',[created.json().id])).rows[0].station_id,'home');
 assert.equal((await db.query('SELECT station_id FROM pets WHERE id=$1',[privateOther.id])).rows[0].station_id,'other');
});

test('administrative grant rejects invalid or non-station targets without changing permissions',async t=>{
 const {db,users}=await fixture(t);
 const before=(await db.query('SELECT id,read_all_stations FROM users ORDER BY id')).rows;
 for(const input of [{username:'missing',enabled:true},{username:'applicant',enabled:true},{username:'developer',enabled:'true'},{username:'developer',enabled:true,stationId:'other'}])await assert.rejects(()=>setStationReadAccess(db,input));
 await db.query('UPDATE users SET active=false WHERE id=$1',[users['other-staff'].user.id]);
 await assert.rejects(()=>setStationReadAccess(db,{username:'other-staff',enabled:true}));
 assert.deepEqual((await db.query('SELECT id,read_all_stations FROM users ORDER BY id')).rows,before);
 assert.equal((await db.query('SELECT count(*) AS count FROM audit_events')).rows[0].count,0);
});

test('additive migration protects existing accounts and preserves grants on repeated migration',async t=>{
 const engine=new PGlite();
 const query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params);
 const db={query,connect:async()=>({query,release(){}})};
 t.after(()=>engine.close());
 await engine.exec(`CREATE TABLE stations(id text PRIMARY KEY,name text NOT NULL);
  CREATE TABLE users(id text PRIMARY KEY,username text UNIQUE NOT NULL,password_hash text NOT NULL,
   role text NOT NULL CHECK(role IN ('adopter','station')),station_id text REFERENCES stations(id),
   active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
   CHECK((role='station' AND station_id IS NOT NULL) OR (role='adopter' AND station_id IS NULL)));
  CREATE TABLE sessions(token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL);`);
 await provision(db,{username:'legacy-staff',password,role:'station',stationId:'legacy',stationName:'原有站点'});
 const session=await login(db,'legacy-staff',password);
 const existing=(await db.query('SELECT id,username,password_hash,role,station_id,active FROM users')).rows;
 await migrate(db);
 assert.deepEqual((await db.query('SELECT id,username,password_hash,role,station_id,active FROM users')).rows,existing);
 assert.equal((await db.query('SELECT read_all_stations FROM users')).rows[0].read_all_stations,false);
 const app=await createApp({db,ai:{},storage:{}});t.after(()=>app.close());
 const me=()=>app.inject({url:'/v1/me',headers:{authorization:'Bearer '+session.token}});
 assert.equal((await me()).statusCode,200);
 await setStationReadAccess(db,{username:'legacy-staff',enabled:true});
 await migrate(db);
 assert.equal((await me()).json().canReadAllStations,true);
 assert.equal((await db.query('SELECT station_id FROM users')).rows[0].station_id,'legacy');
});
