import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {authenticate,digest} from './auth.js';
import {transaction} from './db.js';
import {assert} from './errors.js';
import {petProfileSchema,defaultVoice} from './pet-agent.js';
import {reserveBudget} from './onboarding.js';
const intakeProfileFields={name:z.string().max(80),species:z.enum(['cat','dog','unknown']),description:z.string().max(4000),character:z.string().max(500),age:z.string().max(80),sex:z.enum(['male','female','unknown'])};
const correctionSchema=z.object({field:z.enum(Object.keys(intakeProfileFields)),quote:z.string().max(4000)}).strict();
const confirmedFieldsSchema=z.object(intakeProfileFields).partial().strict();
// Guided intake dimensions: the profile fields the agent speaks from, then the knowledge topics it cites, in asking order.
export const intakeDimensions=['species','age','sex','health','character','likes','habits','diet'];
const dimension=z.enum(intakeDimensions),coverageSchema=z.object(Object.fromEntries(intakeDimensions.map(d=>[d,z.enum(['covered','unknown','missing'])]))).partial().strict();
export const intakeDraftSchema=z.object({...intakeProfileFields,ocrText:z.string().max(6000),nextQuestion:z.string().max(200).default(''),nextDimension:z.union([dimension,z.literal('')]).default(''),coverage:coverageSchema.default({}),uncertainties:z.array(z.string().max(160)).max(10),corrections:z.array(correctionSchema).max(6).default([])}).strict();
export function validateIntakeDraft(value,{confirmedFields={},latestText='',declined=[]}={}){
 const confirmed=confirmedFieldsSchema.parse(confirmedFields),draft=intakeDraftSchema.parse({...value,corrections:[]}),corrected=new Set();
 // Every dimension gets a status; a skipped one is never asked again unless the rescuer later answers it.
 draft.coverage=Object.fromEntries(intakeDimensions.map(d=>[d,d==='species'&&draft.species!=='unknown'||draft.coverage[d]==='covered'?'covered':declined.includes(d)?'unknown':draft.coverage[d]||'missing']));
 if(draft.nextDimension&&draft.coverage[draft.nextDimension]!=='missing'){draft.nextDimension='';draft.nextQuestion='';}
 for(const item of Array.isArray(value?.corrections)?value.corrections:[]){
  const parsed=correctionSchema.safeParse(item);if(!parsed.success)continue;
  const {field,quote}=parsed.data;
  if(!Object.hasOwn(confirmed,field)||!quote.trim()||!latestText.includes(quote)||corrected.has(field))continue;
  corrected.add(field);draft.corrections.push({field,quote});
 }
 for(const [field,manualValue]of Object.entries(confirmed))if(!corrected.has(field))draft[field]=manualValue;
 return draft;
}
// Notes reviewed on the intake card are stored as written: topic, certainty and agent visibility come from the rescuer.
const reviewedNote=z.object({topic:z.enum(['habits','likes','diet','health','other']),quote:z.string().trim().min(1).max(1000),certainty:z.enum(['ongoing','observation','pending']),shared:z.boolean()}).strict();
export const jpegImage=z.string().max(1800000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);
const document=z.object({name:z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/),dataUrl:z.string().max(7000000)}).strict();
function decodeDocument(value){
 const match=value.dataUrl.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/);assert(match,400,'INVALID_DOCUMENT');
 const bytes=Buffer.from(match[2],'base64'),mime=match[1];assert(bytes.length>12&&bytes.length<=5*1024*1024,400,'INVALID_DOCUMENT');
 const valid=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':mime==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':bytes.subarray(0,5).toString()==='%PDF-';
 assert(valid,400,'INVALID_DOCUMENT');return {name:value.name,bytes,mime};
}
function decode(value,video=false){
 const match=value.match(video?/^data:(video\/(?:mp4|webm));base64,([A-Za-z0-9+/=]+)$/:/^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/);assert(match,400,'INVALID_MEDIA');
 const bytes=Buffer.from(match[2],'base64');assert(bytes.length>12&&bytes.length<=(video?10*1024*1024:1300000),400,'INVALID_MEDIA');
 assert(match[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216:match[1]==='video/mp4'?bytes.subarray(4,8).toString()==='ftyp':bytes.subarray(0,4).toString('hex')==='1a45dfa3',400,'INVALID_MEDIA');return {bytes,mime:match[1]};
}
// Photos and a video saved with a daily record join the album, stay station-only and never replace the cover.
export async function storeVisuals(client,storage,{petId,ownerId,observationId,photos=[],video},objects){
 const media=photos.map(v=>decode(v));if(video)media.push(decode(video,true));
 const existing=(await client.query('SELECT object_name FROM media WHERE pet_id=$1 AND object_name LIKE $2',[petId,`pets/${petId}/visual/%`])).rows;
 const start=existing.reduce((n,m)=>Math.max(n,Number(m.object_name.split('/').pop())+1),0);assert(start+media.length<=500,400,'MEDIA_LIMIT');
 for(let i=0;i<media.length;i++){const m=media[i],object=`pets/${petId}/visual/${start+i}`;await storage.put(object,m.bytes,m.mime);objects.push(object);await client.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size,shared,observation_id) VALUES($1,$2,$3,$4,$5,$6,false,$7)',[randomUUID(),petId,ownerId,object,m.mime,m.bytes.length,observationId]);}
}
export async function intakeRoutes(app,{db,ai,storage,origin}){
 const staff=async req=>{req.user=await authenticate(db,req);assert(req.user.role==='station',403,'STATION_REQUIRED');};
 app.post('/v1/intake/analyze',{preHandler:staff,bodyLimit:8*1024*1024,config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async req=>{
  const body=z.object({text:z.string().trim().max(12000),images:z.array(z.object({kind:z.enum(['photo','video','document']),dataUrl:jpegImage}).strict()).max(5),confirmedFields:confirmedFieldsSchema.optional(),latestText:z.string().max(4000).optional(),declined:z.array(dimension).max(intakeDimensions.length).optional()}).strict().parse(req.body);
  assert(body.text.length+(body.latestText?.length||0)+Object.values(body.confirmedFields||{}).reduce((length,value)=>length+value.length,0)<=20000,400,'INVALID_INPUT');
  assert(body.text||body.images.length,400,'EMPTY_INTAKE');body.images.forEach(i=>decode(i.dataUrl));await reserveBudget(db,'intake',10,200);
  return validateIntakeDraft(await ai.draftIntake(body),body);
 });
 app.post('/v1/intake/commit',{preHandler:staff,bodyLimit:20*1024*1024},async(req,reply)=>{
  const body=z.object({name:z.string().trim().min(1).max(80),profile:petProfileSchema,published:z.boolean(),text:z.string().max(12000),ocrText:z.string().max(6000),photos:z.array(jpegImage).max(3),video:z.string().max(14500000).optional(),documents:z.array(document).max(3).optional(),simple:z.boolean().optional(),notes:z.array(reviewedNote).max(80).optional()}).strict().parse(req.body);
  assert(!body.simple||body.text.length<=4000,400,'INVALID_INPUT');
  const key=z.string().uuid().parse(req.headers['idempotency-key']),hash=digest(JSON.stringify(body));
  const media=body.photos.map(v=>decode(v));if(body.video)media.push(decode(body.video,true));
  const documents=(body.documents||[]).map(decodeDocument),description=body.simple?body.text:body.profile.description;
  assert(media.length||documents.length||description.trim()||body.notes?.length,400,'EMPTY_INTAKE');
  const result=await transaction(db,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(73021500)');
   const prior=(await client.query('SELECT * FROM pet_intakes WHERE id=$1',[key])).rows[0];
   if(prior){assert(prior.author_id===req.user.id&&prior.request_hash===hash,409,'INTAKE_CONFLICT');return {id:prior.pet_id,observationId:prior.observation_id};}
   const id=randomUUID(),objects=[];
   try{
    const profile={...body.profile,description,photoUrl:body.photos.length?`${origin}/v1/pets/${id}/visual/0`:''};
    await client.query('INSERT INTO pets(id,station_id,name,profile,published) VALUES($1,$2,$3,$4,$5)',[id,req.user.station_id,body.name,JSON.stringify(profile),body.published]);
    await client.query('INSERT INTO pet_agents(pet_id,voice) VALUES($1,$2)',[id,JSON.stringify(defaultVoice(profile))]);
    for(let i=0;i<media.length;i++){const m=media[i],object=`pets/${id}/visual/${i}`;await storage.put(object,m.bytes,m.mime);objects.push(object);await client.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,req.user.id,object,m.mime,m.bytes.length]);}
    for(let i=0;i<documents.length;i++){const d=documents[i],object=`pets/${id}/document/${i}`;await storage.put(object,d.bytes,d.mime);objects.push(object);await client.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size,caption,shared) VALUES($1,$2,$3,$4,$5,$6,$7,false)',[randomUUID(),id,req.user.id,object,d.mime,d.bytes.length,d.name]);}
    let observationId=null;
    if(body.notes){
     // Shared and station-only notes become two archived records so the agent only ever sees the shared one.
     for(const shared of [true,false]){
      const notes=body.notes.filter(n=>n.shared===shared);if(!notes.length)continue;
      const text=notes.map(n=>n.quote).join('\n'),observation=randomUUID();
      await client.query("INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,transcript,share_with_agent,status) VALUES($1,$2,$3,$4,$5,$6,$6,$7,'archived')",[observation,id,req.user.id,shared?key:`${key}:private`,digest(text),text,shared]);
      for(const n of notes)await client.query('INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),observation,id,n.topic,n.quote,n.certainty]);
      observationId||=observation;
     }
    }else if(profile.description.trim()){observationId=randomUUID();await client.query("INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,share_with_agent) VALUES($1,$2,$3,$4,$5,$6,true)",[observationId,id,req.user.id,key,digest(profile.description),profile.description]);}
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
  const documents=(await db.query('SELECT object_name,mime,size,caption,created_at FROM media WHERE pet_id=$1 AND object_name LIKE $2 ORDER BY object_name',[p.id,`pets/${p.id}/document/%`])).rows.map(m=>({url:`${origin}/v1/pets/${p.id}/document/${m.object_name.split('/').pop()}`,name:m.caption,mime:m.mime,size:m.size,createdAt:m.created_at}));
  return {...source,visuals,documents};
 });
 app.get('/v1/pets/:id/document/:slot',{preHandler:staff},async(req,reply)=>{
  assert(/^[0-2]$/.test(req.params.slot),404,'MEDIA_NOT_FOUND');
  const p=(await db.query('SELECT * FROM pets WHERE id=$1',[req.params.id])).rows[0];assert(p&&p.station_id===req.user.station_id,403,'STATION_REQUIRED');
  const d=(await db.query('SELECT * FROM media WHERE pet_id=$1 AND object_name=$2',[p.id,`pets/${p.id}/document/${req.params.slot}`])).rows[0];assert(d,404,'MEDIA_NOT_FOUND');
  const filename=encodeURIComponent(d.caption).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return reply.header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename="document"; filename*=UTF-8''${filename}`).type(d.mime).send(await storage.read(d.object_name));
 });
 app.post('/v1/pets/:id/visuals',{preHandler:staff,bodyLimit:20*1024*1024},async(req,reply)=>{
  const body=z.object({photos:z.array(jpegImage).max(3),video:z.string().max(14500000).optional(),caption:z.string().trim().max(1000).default(''),shared:z.boolean().default(false)}).strict().parse(req.body),key=z.uuid().parse(req.headers['idempotency-key']),hash=digest(JSON.stringify(body));
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
