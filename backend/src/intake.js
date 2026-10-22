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
  const visuals=(await db.query('SELECT object_name,mime FROM media WHERE pet_id=$1 AND object_name LIKE $2 ORDER BY object_name',[p.id,`pets/${p.id}/visual/%`])).rows.map(m=>({url:`${origin}/v1/pets/${p.id}/visual/${m.object_name.split('/').pop()}`,mime:m.mime}));
  return {...source,visuals};
 });
 app.get('/v1/pets/:id/visual/:slot',async(req,reply)=>{
  assert(/^\d$/.test(req.params.slot),404,'MEDIA_NOT_FOUND');const p=(await db.query('SELECT * FROM pets WHERE id=$1',[req.params.id])).rows[0];assert(p,404,'PET_NOT_FOUND');
  if(!p.published){const user=await authenticate(db,req);assert(user.station_id===p.station_id,403,'STATION_REQUIRED');}
  const m=(await db.query('SELECT * FROM media WHERE pet_id=$1 AND object_name=$2',[p.id,`pets/${p.id}/visual/${req.params.slot}`])).rows[0];assert(m,404,'MEDIA_NOT_FOUND');return reply.header('Cache-Control','private, no-store').type(m.mime).send(await storage.read(m.object_name));
 });
}
