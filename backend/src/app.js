import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { authenticate, digest, login } from './auth.js';
import { ApiError, assert } from './errors.js';
import { transaction } from './db.js';
import { processOne } from './worker.js';
import { audioTypes, validAudio } from './storage.js';
import {registerAdopter,adopterProfile,reserveBudget,answerOptions,answersSchema,lifestyleSchema,analysisSchema} from './onboarding.js';
import {petProfileSchema,voiceSchema,defaultVoice,readAgent} from './pet-agent.js';
import {applicationRoutes} from './applications.js';
import {followupRoutes} from './followups.js';
import {intakeRoutes} from './intake.js';

const text = max => z.string().trim().min(1).max(max);
const observationBody = z.object({text:z.string().trim().max(12000).default(''),mediaId:z.string().uuid().optional(),shareWithAgent:z.boolean().default(false),replacesId:z.string().uuid().optional()}).strict().refine(v=>!!v.text || !!v.mediaId,'Text or audio is required');
const publicPet = row => ({id:row.id,name:row.name,stationId:row.station_id,published:row.published,profile:row.profile});
const topicWords={health:'健康|肠胃|软便|呕吐|生病|疫苗|绝育|过敏|食欲',diet:'饮食|吃|喝|粮|喂|罐头',habits:'作息|习惯|睡|独处|厕所|猫砂|散步',likes:'喜欢|玩|抱|摸|怕|躲|亲近|互动'};
export async function createApp({ db, ai, storage, workerAuth = async()=>false, origin = 'https://pawletter-adoption-h5.chenaaron668.chatgpt.site', logger = false }) {
  const allowedOrigins=[...new Set(origin.split(',').map(value=>{
    const url=new URL(value.trim());
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('INVALID_FRONTEND_ORIGIN');
    return url.origin;
  }))];
  const app = Fastify({logger,disableRequestLogging:true,bodyLimit:20*1024*1024,requestTimeout:180000,trustProxy:false});
  const deps = {db,ai,storage};
  // The public asset URL is server-owned, never accepted from an intake client.
  await app.register(cors,{origin:allowedOrigins,methods:['GET','POST','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization','Idempotency-Key'],credentials:false});
  await app.register(rateLimit,{max:60,timeWindow:'1 minute'});
  app.addContentTypeParser(audioTypes,{parseAs:'buffer'},(req,body,done)=>done(null,body));
  app.setErrorHandler((err,request,reply)=>{
    const status = err instanceof ZodError ? 400 : (err.statusCode>=400 && err.statusCode<600 ? err.statusCode : 500);
    const code = err instanceof ZodError ? 'INVALID_INPUT' : err instanceof ApiError ? err.code : status===429 ? 'RATE_LIMITED' : status===413 ? 'PAYLOAD_TOO_LARGE' : status===415 ? 'UNSUPPORTED_MEDIA' : 'REQUEST_FAILED';
    // Do not log error objects: SQL/provider errors can contain user data and credentials.
    request.log.warn({requestId:request.id,status,code},'Request failed');
    reply.code(status).send({error:code,requestId:request.id});
  });
  app.addHook('onSend',async(req,reply,payload)=>{reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');return payload;});
  app.get('/health',async()=>({ok:true,service:'pawletter-api'}));
  app.get('/ready',async(req,reply)=>{try {await db.query('SELECT 1');return {ok:true};}catch{return reply.code(503).send({ok:false});}});
  const auth = async req => { req.user = await authenticate(db,req); };
  await followupRoutes(app,{db});
  await intakeRoutes(app,{db,ai,storage,origin:process.env.WORKER_AUDIENCE||'https://pawletter-api-446222711695.asia-east1.run.app'});
  async function petFor(user,id,write=false) {
    const pet = (await db.query('SELECT * FROM pets WHERE id=$1',[id])).rows[0];
    assert(pet,404,'PET_NOT_FOUND');
    if (write) assert(user.role==='station' && user.station_id===pet.station_id,403,'STATION_REQUIRED');
    else assert(pet.published || user.station_id===pet.station_id,404,'PET_NOT_FOUND');
    return pet;
  }
  const audit = (client,user,action,id) => client.query('INSERT INTO audit_events(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)',[randomUUID(),user.id,action,id]);
  app.post('/v1/onboarding/transcribe',{bodyLimit:6*1024*1024,config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async(req,reply)=>{
    // Origin is a browser boundary, not authentication. Shared quotas bound anonymous spend.
    assert(allowedOrigins.includes(req.headers.origin),403,'ORIGIN_REQUIRED');
    const mime=req.headers['content-type']?.split(';')[0];
    assert(validAudio(req.body,mime),400,'INVALID_AUDIO_FILE');
    await transaction(db,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(73021423)');
      await client.query('DELETE FROM onboarding_speech_budget WHERE expires_at < now()');
      for(const [window,limit] of [['minute',8],['day',100]]){
        const result=await client.query(`INSERT INTO onboarding_speech_budget(bucket,used,expires_at)
          VALUES($1 || ':' || date_trunc($1,now())::text,1,date_trunc($1,now())+($2 || ' seconds')::interval)
          ON CONFLICT(bucket) DO UPDATE SET used=onboarding_speech_budget.used+1
          WHERE onboarding_speech_budget.used < $3 RETURNING used`,[window,window==='minute'?60:86400,limit]);
        assert(result.rows.length,429,'ONBOARDING_SPEECH_LIMIT');
      }
    });
    // Process in memory; this endpoint never writes recordings or answers to GCS/user records.
    try{return {text:await ai.transcribe(req.body,mime)};}catch(error){if(error.code==='AI_RATE_LIMITED'){reply.header('Retry-After','30');throw new ApiError(429,'SPEECH_PROVIDER_BUSY');}throw error;}
  });
  app.post('/v1/onboarding/interview',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{
    assert(req.headers.origin===origin,403,'ORIGIN_REQUIRED');
    const body=z.object({key:z.enum(Object.keys(answerOptions)),text:text(2000)}).strict().parse(req.body);
    await reserveBudget(db,'interview',10,200);
    const result=await ai.interview(body.key,body.text,answerOptions[body.key]);
    const parsed=z.object({understood:z.boolean(),value:z.enum(answerOptions[body.key]),reply:z.string().min(1).max(300)}).safeParse(result);
    assert(parsed.success,502,'AI_INVALID_RESPONSE');return parsed.data;
  });
  app.post('/v1/onboarding/summary',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async req=>{
    assert(req.headers.origin===origin,403,'ORIGIN_REQUIRED');
    const answers=answersSchema.parse(req.body);await reserveBudget(db,'summary',5,100);
    const result=analysisSchema.safeParse(await ai.summarizeLifestyle(answers));assert(result.success,502,'AI_INVALID_RESPONSE');return result.data;
  });
  app.post('/v1/auth/register',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    assert(req.headers.origin===origin,403,'ORIGIN_REQUIRED');
    const result=await registerAdopter(db,req.body,req.headers['idempotency-key']);return reply.code(201).send(result);
  });
  app.get('/v1/adopter/profile',{preHandler:auth},async req=>{assert(req.user.role==='adopter',403,'ADOPTER_REQUIRED');return adopterProfile(db,req.user.id);});
  app.post('/v1/adopter/profile',{preHandler:auth},async req=>{
    assert(req.user.role==='adopter',403,'ADOPTER_REQUIRED');const lifestyle=lifestyleSchema.parse(req.body);
    await db.query('UPDATE adopter_profiles SET lifestyle=$1 WHERE user_id=$2',[JSON.stringify({...lifestyle,confirmedAt:Date.now()}),req.user.id]);return adopterProfile(db,req.user.id);
  });
  app.post('/v1/adopter/preferences',{preHandler:auth},async req=>{
    assert(req.user.role==='adopter',403,'ADOPTER_REQUIRED');const body=z.object({proactive:z.boolean()}).strict().parse(req.body);
    await db.query('UPDATE adopter_profiles SET proactive_enabled=$1 WHERE user_id=$2',[body.proactive,req.user.id]);return {proactive:body.proactive};
  });
  app.post('/v1/auth/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{
    const body = z.object({username:text(64),password:z.string().min(1).max(128)}).strict().parse(req.body);
    return login(db,body.username,body.password);
  });
  app.post('/v1/auth/logout',{preHandler:auth},async req=>{await db.query('DELETE FROM sessions WHERE token_hash=$1',[digest(req.headers.authorization.slice(7))]);return {ok:true};});
  app.get('/v1/me',{preHandler:auth},async req=>({id:req.user.id,role:req.user.role,stationId:req.user.station_id}));
  app.get('/v1/catalog',async()=>({pets:(await db.query("SELECT p.*,s.name AS station_name FROM pets p JOIN stations s ON s.id=p.station_id WHERE p.published=true AND COALESCE((p.profile->>'internal')::boolean,false)=false AND p.name NOT LIKE '联调·%' ORDER BY p.created_at DESC LIMIT 100")).rows.map(row=>({...publicPet(row),stationName:row.station_name}))}));
  app.get('/v1/pets',{preHandler:auth},async req=>({pets:(await db.query(req.user.role==='station'?'SELECT * FROM pets WHERE station_id=$1 ORDER BY created_at DESC':'SELECT * FROM pets WHERE published=true OR station_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.station_id])).rows.map(publicPet)}));
  app.post('/v1/pets',{preHandler:auth},async(req,reply)=>{
    assert(req.user.role==='station',403,'STATION_REQUIRED');
    const body = z.object({name:text(80),profile:petProfileSchema,published:z.boolean().default(false)}).strict().parse(req.body);
    const id=randomUUID();
    await transaction(db,async client=>{await client.query('INSERT INTO pets(id,station_id,name,profile,published) VALUES($1,$2,$3,$4,$5)',[id,req.user.station_id,body.name,JSON.stringify(body.profile),body.published]);await client.query('INSERT INTO pet_agents(pet_id,voice) VALUES($1,$2)',[id,JSON.stringify(defaultVoice(body.profile))]);await audit(client,req.user,'pet.created',id);});
    return reply.code(201).send({id});
  });
  app.get('/v1/pets/:id',{preHandler:auth},async req=>publicPet(await petFor(req.user,req.params.id)));
  app.get('/v1/pets/:id/agent',{preHandler:auth},async req=>readAgent(db,await petFor(req.user,req.params.id)));
  app.post('/v1/pets/:id/agent',{preHandler:auth},async req=>{
    const pet=await petFor(req.user,req.params.id,true),voice=voiceSchema.parse(req.body);
    await transaction(db,async client=>{await client.query('INSERT INTO pet_agents(pet_id,voice) VALUES($1,$2) ON CONFLICT(pet_id) DO UPDATE SET voice=$2,revision=pet_agents.revision+1,updated_at=now()',[pet.id,JSON.stringify(voice)]);await audit(client,req.user,'pet.agent.updated',pet.id);});return readAgent(db,pet);
  });
  app.post('/v1/pets/:id/profile',{preHandler:auth},async req=>{
    const pet=await petFor(req.user,req.params.id,true),body=z.object({name:text(80),profile:petProfileSchema,published:z.boolean()}).strict().parse(req.body);
    await transaction(db,async client=>{await client.query("UPDATE pets SET name=$1,profile=$2::jsonb || CASE WHEN profile ? 'adopted' THEN jsonb_build_object('adopted',profile->'adopted') ELSE '{}'::jsonb END,published=$3 WHERE id=$4",[body.name,JSON.stringify(body.profile),body.published,pet.id]);await client.query('UPDATE pet_agents SET revision=revision+1,updated_at=now() WHERE pet_id=$1',[pet.id]);await audit(client,req.user,'pet.profile.updated',pet.id);});return {ok:true};
  });
  app.post('/v1/pets/:id/audio',{preHandler:auth,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
    await petFor(req.user,req.params.id,true);
    const mime=req.headers['content-type']?.split(';')[0];
    assert(validAudio(req.body,mime),400,'INVALID_AUDIO_FILE');
    const id=randomUUID(), object=`pets/${req.params.id}/audio/${id}`;
    await storage.put(object,req.body,mime);
    try { await db.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size) VALUES($1,$2,$3,$4,$5,$6)',[id,req.params.id,req.user.id,object,mime,req.body.length]); }
    catch(e) {await storage.remove(object).catch(()=>{});throw e;}
    return reply.code(201).send({id,mime,size:req.body.length});
  });
  app.get('/v1/media/:id',{preHandler:auth},async(req,reply)=>{
    const media=(await db.query('SELECT * FROM media WHERE id=$1',[req.params.id])).rows[0];assert(media,404,'MEDIA_NOT_FOUND');
    await petFor(req.user,media.pet_id,true);
    return reply.type(media.mime).send(await storage.read(media.object_name));
  });
  app.post('/v1/pets/:id/observations',{preHandler:auth},async(req,reply)=>{
    await petFor(req.user,req.params.id,true);
    const body=observationBody.parse(req.body), key=z.string().uuid().parse(req.headers['idempotency-key']);
    const hash=digest(JSON.stringify({petId:req.params.id,...body}));
    const result=await transaction(db,async client=>{
      // Same user/key cannot create duplicates, even across concurrent requests.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.id+key]);
      const existing=(await client.query('SELECT id,request_hash FROM observations WHERE author_id=$1 AND idempotency_key=$2',[req.user.id,key])).rows[0];
      if(existing){assert(existing.request_hash===hash,409,'IDEMPOTENCY_CONFLICT');return {id:existing.id,duplicate:true};}
      if(body.mediaId){const media=(await client.query('SELECT pet_id FROM media WHERE id=$1',[body.mediaId])).rows[0];assert(media?.pet_id===req.params.id,400,'MEDIA_PET_MISMATCH');}
      if(body.replacesId){
        const old=(await client.query('SELECT * FROM observations WHERE id=$1 AND pet_id=$2 FOR UPDATE',[body.replacesId,req.params.id])).rows[0];
        assert(old && old.status!=='withdrawn',409,'OBSERVATION_NOT_ACTIVE');
        await client.query("UPDATE observations SET status='withdrawn',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[old.id]);
      }
      const id=randomUUID();
      await client.query('INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,media_id,share_with_agent,replaces_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,req.params.id,req.user.id,key,hash,body.text,body.mediaId||null,body.shareWithAgent,body.replacesId||null]);
      await audit(client,req.user,body.replacesId?'observation.corrected':'observation.created',id);
      return {id,duplicate:false};
    });
    return reply.code(result.duplicate?200:202).send(result);
  });
  app.get('/v1/pets/:id/observations',{preHandler:auth},async req=>{
    await petFor(req.user,req.params.id,true);
    const q=z.object({q:z.string().max(200).default(''),status:z.enum(['all','archived','processing','failed','withdrawn']).default('all'),from:z.union([z.iso.date(),z.literal('')]).default(''),to:z.union([z.iso.date(),z.literal('')]).default(''),order:z.enum(['asc','desc']).default('desc'),id:z.string().max(100).default('')}).parse(req.query);
    return {observations:(await db.query(`SELECT id,original_text,transcript,media_id,share_with_agent,status,attempts,error_code,replaces_id,created_at,updated_at FROM observations WHERE pet_id=$1 AND ($2='' OR position(lower($2) in lower(original_text||' '||COALESCE(transcript,'')))>0) AND ($3='all' OR status=$3 OR ($3='processing' AND status='queued')) AND ($4::date IS NULL OR created_at>=($4::date::timestamp AT TIME ZONE 'Asia/Shanghai')) AND ($5::date IS NULL OR created_at<(($5::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')) AND ($6='' OR id=$6) ORDER BY created_at ${q.order==='asc'?'ASC':'DESC'},id LIMIT 100`,[req.params.id,q.q,q.status,q.from||null,q.to||null,q.id])).rows};
  });
  async function observationFor(req){const row=(await db.query('SELECT * FROM observations WHERE id=$1',[req.params.id])).rows[0];assert(row,404,'OBSERVATION_NOT_FOUND');await petFor(req.user,row.pet_id,true);return row;}
  app.post('/v1/observations/:id/process',{preHandler:auth,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{await observationFor(req);return processOne(deps,req.params.id);});
  app.post('/v1/observations/:id/retry',{preHandler:auth},async req=>{
    await observationFor(req);
    const result=await db.query("UPDATE observations SET status='queued',attempts=0,next_attempt_at=now(),error_code=NULL,updated_at=now() WHERE id=$1 AND status='failed' RETURNING id",[req.params.id]);
    assert(result.rows[0],409,'OBSERVATION_NOT_FAILED');return {ok:true};
  });
  app.delete('/v1/observations/:id',{preHandler:auth},async req=>{
    await observationFor(req);
    await transaction(db,async client=>{await client.query("UPDATE observations SET status='withdrawn',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[req.params.id]);await audit(client,req.user,'observation.withdrawn',req.params.id);});
    return {ok:true};
  });
  async function notesFor(petId,includePrivate=false,topics=null){return (await db.query(`SELECT k.id,k.observation_id,k.quote,k.topic,k.certainty,o.created_at AS recorded_at,s.name AS station
    FROM knowledge k JOIN observations o ON o.id=k.observation_id JOIN pets p ON p.id=k.pet_id JOIN stations s ON s.id=p.station_id
    WHERE k.pet_id=$1 AND o.status='archived' AND (o.share_with_agent=true OR $2::boolean=true)
    ORDER BY CASE WHEN $3::text[] IS NULL THEN 0 WHEN k.topic=ANY($3::text[]) OR k.quote ~ $4::text THEN 0 ELSE 1 END,
      o.created_at DESC,k.id LIMIT 100`,[petId,includePrivate,topics,topics?.map(topic=>topicWords[topic]).filter(Boolean).join('|')||'(?!)'])).rows;}
  app.get('/v1/pets/:id/knowledge',{preHandler:auth},async req=>{const pet=await petFor(req.user,req.params.id);return {notes:await notesFor(pet.id,req.user.station_id===pet.station_id)};});
  app.get('/v1/pets/:id/chat',{preHandler:auth},async req=>{
    const pet=await petFor(req.user,req.params.id);
    const rows=(await db.query('SELECT question,answer,citations,created_at FROM chats WHERE user_id=$1 AND pet_id=$2 ORDER BY created_at DESC LIMIT 30',[req.user.id,pet.id])).rows.reverse();
    return {messages:rows.flatMap(row=>[...(row.question?[{from:'user',text:row.question,at:row.created_at}]:[]),{from:'pet',text:row.answer,citations:row.citations,at:row.created_at}])};
  });
  app.post('/v1/pets/:id/chat',{preHandler:auth,config:{rateLimit:{max:15,timeWindow:'1 minute'}}},async req=>{
    const pet=await petFor(req.user,req.params.id), {question}=z.object({question:text(2000)}).strict().parse(req.body);
    const topics=Object.entries(topicWords).filter(([,pattern])=>new RegExp(pattern).test(question)).map(([topic])=>topic);
    const agent=await readAgent(db,pet);
    const notes=await notesFor(pet.id,false,topics.length?topics:null), result=await ai.answer({pet,agent,notes:notes.slice(0,30),question});
    // Re-read after slow inference: withdrawn/corrected material must not escape in a late answer.
    const active=await notesFor(pet.id,false,topics.length?topics:null), activeIds=new Set(active.map(n=>n.id));
    assert(notes.slice(0,30).every(n=>activeIds.has(n.id)),409,'KNOWLEDGE_CHANGED_RETRY');
    const latest=await petFor(req.user,pet.id),latestAgent=await readAgent(db,latest);
    assert(latestAgent.revision===agent.revision&&latest.name===pet.name&&JSON.stringify(latest.profile)===JSON.stringify(pet.profile),409,'KNOWLEDGE_CHANGED_RETRY');
    assert(Array.isArray(result.citationIds) && result.citationIds.every(id=>notes.slice(0,30).some(n=>n.id===id)),502,'AI_INVALID_ANSWER');
    const citations=active.filter(n=>result.citationIds.includes(n.id));
    await db.query('INSERT INTO chats(id,user_id,pet_id,question,answer,citations) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),req.user.id,pet.id,question,result.answer,JSON.stringify(citations)]);
    return {answer:result.answer,citations};
  });
  app.post('/internal/process',{config:{rateLimit:false}},async req=>{
    assert(await workerAuth(req),401,'WORKER_AUTH_REQUIRED');
    // One bounded task per request keeps Cloud Run execution inside the request lifecycle.
    return processOne(deps);
  });
  applicationRoutes({app,db,auth,petFor});
  return app;
}
