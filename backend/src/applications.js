import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assert} from './errors.js';
import {transaction} from './db.js';
import {adopterProfile} from './onboarding.js';
import {readAgent} from './pet-agent.js';
function journey(pet,tone,stage){
 const intro={shy:'我有一点点开心，也有一点点紧张。',calm:'我把你的心意，悄悄记在心里了。',lively:'想到又和你靠近了一步，我有点期待！',gentle:'原来你也在认真想我们的以后呀。'}[tone]||'谢谢你认真认识我。';
 return ({0:`${intro}照顾我的人收到你的申请啦，会先认真看看，再和你联系。我们慢慢来，也可以随时看看进度。`,1:`${intro}照顾我的人已经看过申请，我们可以商量见面啦。时间和地点还要和他们确认。`,2:`${intro}见面这一步已经确认，接下来还要一起准备交接。准备好后，再带我回家吧。`,3:'交接完成啦，以后就和你一起生活了。慢慢陪我熟悉新家吧，有照护问题也可以回来问我的 AI 分身。',[-1]:'这次申请先告一段落了。谢谢你花时间认真认识我；具体原因可以和照顾我的人沟通。'})[stage];
}
export function applicationRoutes({app,db,auth,petFor}){
 async function notify(client,pet,userId,stage){const agent=await readAgent(client,pet);await client.query('INSERT INTO chats(id,user_id,pet_id,question,answer,citations) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),userId,pet.id,'',journey(pet,agent.voice.tone,stage),'[]']);}
 const projection=row=>({id:row.id,petId:row.pet_id,adopterId:row.adopter_id,stationId:row.station_id,stage:row.stage,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,snapshot:row.snapshot,note:row.note,name:row.snapshot.nickname});
 app.get('/v1/applications',{preHandler:auth},async req=>({applications:(await db.query(req.user.role==='station'?'SELECT * FROM adoption_applications WHERE station_id=$1 ORDER BY created_at DESC':'SELECT * FROM adoption_applications WHERE adopter_id=$1 ORDER BY created_at DESC',[req.user.role==='station'?req.user.station_id:req.user.id])).rows.map(projection)}));
 app.post('/v1/pets/:id/applications',{preHandler:auth},async(req,reply)=>{
  assert(req.user.role==='adopter',403,'ADOPTER_REQUIRED');const pet=await petFor(req.user,req.params.id);
  const body=z.object({note:z.string().trim().min(2).max(4000),memories:z.array(z.string().max(500)).max(50).default([]),shareProfile:z.literal(true)}).strict().parse(req.body),key=z.uuid().parse(req.headers['idempotency-key']),profile=await adopterProfile(db,req.user.id);
  const result=await transaction(db,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[pet.id+req.user.id]);
   const prior=(await client.query('SELECT * FROM adoption_applications WHERE adopter_id=$1 AND idempotency_key=$2',[req.user.id,key])).rows[0];if(prior){assert(prior.pet_id===pet.id&&prior.note===body.note,409,'IDEMPOTENCY_CONFLICT');return projection(prior);}
   const current=(await client.query('SELECT * FROM pets WHERE id=$1 FOR UPDATE',[pet.id])).rows[0];assert(current.published&&!current.profile.adopted,409,'PET_UNAVAILABLE');
   assert(!(await client.query('SELECT id FROM adoption_applications WHERE adopter_id=$1 AND pet_id=$2 AND stage>=0',[req.user.id,pet.id])).rows.length,409,'APPLICATION_EXISTS');
   const snapshot={nickname:profile.nickname,realName:profile.realName,phone:profile.phone,wechat:profile.wechat,email:profile.email,verification:profile.verification,lifestyle:profile.lifestyle,memories:body.memories,sharedAt:Date.now()},id=randomUUID();
   const row=(await client.query('INSERT INTO adoption_applications(id,pet_id,adopter_id,station_id,snapshot,note,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,pet.id,req.user.id,pet.station_id,JSON.stringify(snapshot),body.note,key])).rows[0];await notify(client,pet,req.user.id,0);return projection(row);
  });return reply.code(201).send(result);
 });
 app.post('/v1/applications/:id/stage',{preHandler:auth},async req=>{
  const body=z.object({stage:z.number().int().min(-1).max(3),version:z.number().int().positive()}).strict().parse(req.body);
  return transaction(db,async client=>{
   const row=(await client.query('SELECT * FROM adoption_applications WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];assert(row,404,'APPLICATION_NOT_FOUND');
   const station=req.user.role==='station'&&req.user.station_id===row.station_id,owner=req.user.id===row.adopter_id;
   assert(station||owner,403,'APPLICATION_FORBIDDEN');assert(row.version===body.version&&row.stage>=0&&row.stage<3,409,'APPLICATION_CHANGED');
   assert(body.stage===-1||(station&&body.stage===row.stage+1),403,'INVALID_STAGE');
   const pet=(await client.query('SELECT * FROM pets WHERE id=$1 FOR UPDATE',[row.pet_id])).rows[0];assert(!pet.profile.adopted,409,'PET_UNAVAILABLE');
   if(body.stage===3){const profile=await adopterProfile(client,row.adopter_id);assert(profile.verification==='verified',409,'IDENTITY_PENDING');await client.query("UPDATE pets SET profile=jsonb_set(profile,'{adopted}','true'::jsonb) WHERE id=$1",[pet.id]);await client.query('UPDATE adoption_applications SET stage=-1,version=version+1,updated_at=now() WHERE pet_id=$1 AND id<>$2 AND stage>=0 AND stage<3',[pet.id,row.id]);}
   const updated=(await client.query('UPDATE adoption_applications SET stage=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *',[body.stage,row.id])).rows[0];await notify(client,pet,row.adopter_id,body.stage);return projection(updated);
  });
 });
}
