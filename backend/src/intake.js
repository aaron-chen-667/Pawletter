import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {authenticate,digest} from './auth.js';
import {transaction} from './db.js';
import {assert} from './errors.js';
import {petProfileSchema,defaultVoice} from './pet-agent.js';
import {reserveBudget} from './onboarding.js';
export const intakeDraftSchema=z.object({name:z.string().max(80),species:z.enum(['cat','dog','unknown']),description:z.string().max(4000),character:z.string().max(500),age:z.string().max(80),sex:z.enum(['male','female','unknown']),ocrText:z.string().max(6000),nextQuestion:z.string().max(200).default(''),uncertainties:z.array(z.string().max(160)).max(10)}).strict();
const image=z.string().max(1800000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
function decode(value,video=false){
 const match=value.match(video?/^data:(video\/(?:mp4|webm));base64,([A-Za-z0-9+/=]+)$/:/^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/);assert(match,400,'INVALID_MEDIA');
 const bytes=Buffer.from(match[2],'base64');assert(bytes.length>12&&bytes.length<=(video?10*1024*1024:1300000),400,'INVALID_MEDIA');
 assert(match[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216:match[1]==='video/mp4'?bytes.subarray(4,8).toString()==='ftyp':bytes.subarray(0,4).toString('hex')==='1a45dfa3',400,'INVALID_MEDIA');return {bytes,mime:match[1]};
}
export async function intakeRoutes(app,{db,ai,storage,origin}){
 const staff=async req=>{req.user=await authenticate(db,req);assert(req.user.role==='station',403,'STATION_REQUIRED');};
 app.post('/v1/intake/analyze',{preHandler:staff,bodyLimit:8*1024*1024,config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async req=>{
  const body=z.object({text:z.string().trim().max(12000),images:z.array(z.object({kind:z.enum(['photo','video','document']),dataUrl:image}).strict()).max(5)}).strict().parse(req.body);
  assert(body.text||body.images.length,400,'EMPTY_INTAKE');body.images.forEach(i=>decode(i.dataUrl));await reserveBudget(db,'intake',10,200);
  return intakeDraftSchema.parse(await ai.draftIntake(body));
 });
 app.post('/v1/intake/commit',{preHandler:staff,bodyLimit:20*1024*1024},async(req,reply)=>{
  const body=z.object({name:z.string().trim().min(1).max(80),profile:petProfileSchema,published:z.boolean(),text:z.string().max(12000),ocrText:z.string().max(6000),photos:z.array(image).min(1).max(3),video:z.string().max(14500000).optional()}).strict().parse(req.body);
  const key=z.string().uuid().parse(req.headers['idempotency-key']),hash=digest(JSON.stringify(body));
  const media=body.photos.map(v=>decode(v));if(body.video)media.push(decode(body.video,true));
  const result=await transaction(db,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(73021500)');
   const prior=(await client.query('SELECT * FROM pet_intakes WHERE id=$1',[key])).rows[0];
   if(prior){assert(prior.author_id===req.user.id&&prior.request_hash===hash,409,'INTAKE_CONFLICT');return {id:prior.pet_id,observationId:prior.observation_id};}
   const id=randomUUID(),objects=[];
   try{
    const profile={...body.profile,photoUrl:`${origin}/v1/pets/${id}/visual/0`};
    await client.query('INSERT INTO pets(id,station_id,name,profile,published) VALUES($1,$2,$3,$4,$5)',[id,req.user.station_id,body.name,JSON.stringify(profile),body.published]);
    await client.query('INSERT INTO pet_agents(pet_id,voice) VALUES($1,$2)',[id,JSON.stringify(defaultVoice(profile))]);
    for(let i=0;i<media.length;i++){const m=media[i],object=`pets/${id}/visual/${i}`;await storage.put(object,m.bytes,m.mime);objects.push(object);await client.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,req.user.id,object,m.mime,m.bytes.length]);}
    let observationId=null;
    if(profile.description.trim()){observationId=randomUUID();await client.query("INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,share_with_agent) VALUES($1,$2,$3,$4,$5,$6,true)",[observationId,id,req.user.id,key,digest(profile.description),profile.description]);}
    await client.query('INSERT INTO pet_intakes(id,author_id,pet_id,request_hash,source_text,ocr_text,observation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[key,req.user.id,id,hash,body.text,body.ocrText,observationId]);
    await client.query('INSERT INTO audit_events(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)',[randomUUID(),req.user.id,'pet.intake.confirmed',id]);
    return {id,observationId};
   }catch(e){await Promise.allSettled(objects.map(o=>storage.remove(o)));throw e;}
  });return reply.code(201).send(result);
 });
 app.get('/v1/pets/:id/intake',{preHandler:staff},async req=>{
  const p=(await db.query('SELECT * FROM pets WHERE id=$1',[req.params.id])).rows[0];assert(p&&p.station_id===req.user.station_id,403,'STATION_REQUIRED');
  const source=(await db.query('SELECT source_text,ocr_text FROM pet_intakes WHERE pet_id=$1',[p.id])).rows[0]||{};
  const visuals=(await db.query('SELECT object_name,mime,caption,shared,created_at FROM media WHERE pet_id=$1 AND object_name LIKE $2 ORDER BY created_at DESC,object_name',[p.id,`pets/${p.id}/visual/%`])).rows.map(m=>({url:`${origin}/v1/pets/${p.id}/visual/${m.object_name.split('/').pop()}`,mime:m.mime,caption:m.caption,shared:m.shared,createdAt:m.created_at}));
  return {...source,visuals};
 });
 app.post('/v1/pets/:id/visuals',{preHandler:staff,bodyLimit:20*1024*1024},async(req,reply)=>{
  const body=z.object({photos:z.array(image).max(3),video:z.string().max(14500000).optional(),caption:z.string().trim().max(1000).default(''),shared:z.boolean().default(false)}).strict().parse(req.body),key=z.uuid().parse(req.headers['idempotency-key']),hash=digest(JSON.stringify(body));
  const media=body.photos.map(v=>decode(v));if(body.video)media.push(decode(body.video,true));assert(media.length,400,'EMPTY_MEDIA');
  await transaction(db,async c=>{
   const p=(await c.query('SELECT * FROM pets WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];assert(p&&p.station_id===req.user.station_id,403,'STATION_REQUIRED');
   const old=(await c.query('SELECT * FROM media_batches WHERE id=$1',[key])).rows[0];if(old){assert(old.pet_id===p.id&&old.owner_id===req.user.id&&old.request_hash===hash,409,'IDEMPOTENCY_CONFLICT');return;}
   const existing=(await c.query('SELECT object_name FROM media WHERE pet_id=$1 AND object_name LIKE $2',[p.id,`pets/${p.id}/visual/%`])).rows;const start=existing.reduce((n,m)=>Math.max(n,Number(m.object_name.split('/').pop())+1),0);assert(start+media.length<=500,400,'MEDIA_LIMIT');const objects=[];
   try{for(let i=0;i<media.length;i++){const m=media[i],object=`pets/${p.id}/visual/${start+i}`;await storage.put(object,m.bytes,m.mime);objects.push(object);await c.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size,caption,shared) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),p.id,req.user.id,object,m.mime,m.bytes.length,body.caption,body.shared]);}
    await c.query('INSERT INTO media_batches(id,pet_id,owner_id,request_hash) VALUES($1,$2,$3,$4)',[key,p.id,req.user.id,hash]);
    if(!p.profile.photoUrl&&body.photos.length&&body.shared)await c.query("UPDATE pets SET profile=jsonb_set(profile,'{photoUrl}',to_jsonb($1::text)) WHERE id=$2",[`${origin}/v1/pets/${p.id}/visual/${start}`,p.id]);
   }catch(e){await Promise.allSettled(objects.map(o=>storage.remove(o)));throw e;}
  });return reply.code(201).send({ok:true});
 });
 app.get('/v1/pets/:id/visual/:slot',async(req,reply)=>{
  assert(/^\d{1,3}$/.test(req.params.slot),404,'MEDIA_NOT_FOUND');const p=(await db.query('SELECT * FROM pets WHERE id=$1',[req.params.id])).rows[0];assert(p,404,'PET_NOT_FOUND');
  const m=(await db.query('SELECT * FROM media WHERE pet_id=$1 AND object_name=$2',[p.id,`pets/${p.id}/visual/${req.params.slot}`])).rows[0];assert(m,404,'MEDIA_NOT_FOUND');
  if(!p.published||!m.shared){const user=await authenticate(db,req);assert(user.station_id===p.station_id,403,'STATION_REQUIRED');}
  return reply.header('Cache-Control','private, no-store').type(m.mime).send(await storage.read(m.object_name));
 });
}
