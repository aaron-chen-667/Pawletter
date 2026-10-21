import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db.js';
import { provision } from '../src/auth.js';
import { validateExtraction, createAI, sourceSentences, resolveSelection } from '../src/ai.js';
import { processOne } from '../src/worker.js';

let engine,db,app,station,other,adopter,pet,privatePet;
const blobs=new Map(), storage={put:async(k,v)=>blobs.set(k,v),read:async k=>blobs.get(k),remove:async k=>blobs.delete(k)};
let extractOverride=null, answerOverride=null, transcribeCalls=0;
const ai={transcribe:async()=>{transcribeCalls++;return '平时喜欢玩逗猫棒。';},extract:async text=>extractOverride?extractOverride(text):[{topic:'likes',quote:text,certainty:'ongoing'}],answer:async args=>answerOverride?answerOverride(args):{answer:args.notes[0]?.quote||'暂未记录。',citationIds:args.notes.slice(0,1).map(n=>n.id)}};
const headers=token=>({authorization:`Bearer ${token}`});
const request=(token,method,url,payload,extra={})=>app.inject({method,url,headers:{...headers(token),...extra},...(payload===undefined?{}:{payload})});
const submit=async(text,extra={})=>{
 const r=await request(station,'POST',`/v1/pets/${pet}/observations`,{text,shareWithAgent:true,...extra},{'idempotency-key':randomUUID()});assert.equal(r.statusCode,202,r.body);return r.json().id;
};
before(async()=>{
 engine=new PGlite(); db={query:(...args)=>engine.query(...args),connect:async()=>({query:(...args)=>engine.query(...args),release(){}})};
 // PGlite accepts multi-statement DDL through exec; PostgreSQL uses Pool.query.
 const query=db.query; db.query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):query(sql,params);
 db.connect=async()=>({query:db.query,release(){}});
 await migrate(db); await migrate(db);
 await provision(db,{username:'station-one',password:'testing-password-one',role:'station',stationId:'s1',stationName:'暖爪救助站'});
 await provision(db,{username:'station-two',password:'testing-password-two',role:'station',stationId:'s2',stationName:'小院猫咪之家'});
 await provision(db,{username:'adopter-one',password:'testing-password-three',role:'adopter'});
 app=await createApp({db,ai,storage});
 async function signIn(username,password){const r=await app.inject({method:'POST',url:'/v1/auth/login',payload:{username,password}});assert.equal(r.statusCode,200,r.body);return r.json().token;}
 station=await signIn('station-one','testing-password-one');other=await signIn('station-two','testing-password-two');adopter=await signIn('adopter-one','testing-password-three');
 for(const published of [true,false]){const r=await request(station,'POST','/v1/pets',{name:'吐司',profile:{species:'cat'},published});assert.equal(r.statusCode,201,r.body);if(published)pet=r.json().id;else privatePet=r.json().id;}
});
after(async()=>{await app?.close();await engine?.close();});
test('anonymous onboarding speech validates audio and origin, limits shared spend and never stores media',async()=>{
 const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
 const options={method:'POST',url:'/v1/onboarding/transcribe',headers:{origin:'https://pawletter-adoption-h5.chenaaron668.chatgpt.site','content-type':'audio/wav'},payload:wav};
 const before=transcribeCalls,stored=blobs.size;
 assert.equal((await app.inject({...options,headers:{...options.headers,origin:'https://wrong.invalid'}})).statusCode,403);
 assert.equal((await app.inject({...options,payload:Buffer.from('not an audio file')})).statusCode,400);
 assert.equal((await app.inject({...options,payload:Buffer.alloc(6*1024*1024+1)})).statusCode,413);
 const result=await app.inject(options);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().text,'平时喜欢玩逗猫棒。');
 assert.equal(transcribeCalls,before+1);assert.equal(blobs.size,stored);
 await db.query("UPDATE onboarding_speech_budget SET used=100 WHERE bucket LIKE 'day:%'");
 const limited=await app.inject(options);assert.equal(limited.statusCode,429,limited.body);assert.equal(limited.json().error,'ONBOARDING_SPEECH_LIMIT');
 assert.equal(transcribeCalls,before+1);
 await db.query('DELETE FROM onboarding_speech_budget');
 transcribeCalls=before;
});
test('health, CORS and authenticated endpoints',async()=>{
 assert.equal((await app.inject('/health')).statusCode,200);
 assert.equal((await app.inject('/v1/pets')).statusCode,401);
 const cors=await app.inject({method:'OPTIONS',url:'/v1/pets',headers:{origin:'https://pawletter-adoption-h5.chenaaron668.chatgpt.site','access-control-request-method':'POST'}});
 assert.equal(cors.headers['access-control-allow-origin'],'https://pawletter-adoption-h5.chenaaron668.chatgpt.site');
 assert.equal((await request(adopter,'GET',`/v1/pets/${privatePet}`)).statusCode,404);
 assert.equal((await request(other,'POST',`/v1/pets/${pet}/observations`,{text:'喜欢玩。'},{'idempotency-key':randomUUID()})).statusCode,403);
 assert.equal((await request(adopter,'POST','/v1/pets',{name:'test'})).statusCode,403);
});
test('idempotency, automatic archive, source citations and withdrawal',async()=>{
 const key=randomUUID(), body={text:'每天喜欢玩逗猫棒。',shareWithAgent:true};
 const first=await request(station,'POST',`/v1/pets/${pet}/observations`,body,{'idempotency-key':key});assert.equal(first.statusCode,202);
 const duplicate=await request(station,'POST',`/v1/pets/${pet}/observations`,body,{'idempotency-key':key});assert.equal(duplicate.statusCode,200);assert.equal(duplicate.json().id,first.json().id);
 assert.equal((await request(station,'POST',`/v1/pets/${pet}/observations`,{...body,text:'改动。'},{'idempotency-key':key})).statusCode,409);
 const id=first.json().id;await processOne({db,ai,storage},id);
 const chat=await request(adopter,'POST',`/v1/pets/${pet}/chat`,{question:'喜欢什么？'});assert.equal(chat.statusCode,200,chat.body);assert.equal(chat.json().citations[0].quote,body.text);assert.equal(chat.json().citations[0].station,'暖爪救助站');
 assert.equal((await request(other,'DELETE',`/v1/observations/${id}`)).statusCode,403);
 await request(station,'DELETE',`/v1/observations/${id}`);
 assert.equal((await request(adopter,'GET',`/v1/pets/${pet}/knowledge`)).json().notes.length,0);
});
test('private notes stay out of adopter knowledge and Agent context',async()=>{
 const id=await submit('每天喜欢安静。',{shareWithAgent:false});await processOne({db,ai,storage},id);
 const userNotes=(await request(adopter,'GET',`/v1/pets/${pet}/knowledge`)).json().notes;assert.equal(userNotes.length,0);
 const stationNotes=(await request(station,'GET',`/v1/pets/${pet}/knowledge`)).json().notes;assert.ok(stationNotes.length>0);
 assert.equal((await request(adopter,'GET',`/v1/pets/${pet}/observations`)).statusCode,403);
});
test('question retrieval includes relevant original words when AI topic classification differs',async()=>{
 const id=await submit('每天喜欢玩逗猫棒。');
 extractOverride=async text=>[{topic:'habits',quote:text,certainty:'ongoing'}];
 try{await processOne({db,ai,storage},id);}finally{extractOverride=null;}
 const answer=await request(adopter,'POST',`/v1/pets/${pet}/chat`,{question:'它喜欢玩什么？'});
 assert.equal(answer.statusCode,200,answer.body);assert.equal(answer.json().citations[0].quote,'每天喜欢玩逗猫棒。');
 await request(station,'DELETE',`/v1/observations/${id}`);
});
test('audio uploaded to one pet cannot be assigned to another; audio stays private',async()=>{
 const bytes=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(20)]);
 const upload=await request(station,'POST',`/v1/pets/${pet}/audio`,bytes,{'content-type':'audio/webm'});assert.equal(upload.statusCode,201,upload.body);
 const mediaId=upload.json().id;
 assert.equal((await request(adopter,'GET',`/v1/media/${mediaId}`)).statusCode,403);
 assert.equal((await request(other,'GET',`/v1/media/${mediaId}`)).statusCode,403);
 assert.equal((await request(station,'POST',`/v1/pets/${privatePet}/observations`,{mediaId},{'idempotency-key':randomUUID()})).statusCode,400);
 const id=await submit('',{mediaId});await processOne({db,ai,storage},id);assert.equal(transcribeCalls,1);
 const row=(await db.query('SELECT * FROM observations WHERE id=$1',[id])).rows[0];assert.equal(row.status,'archived');assert.equal(row.transcript,'平时喜欢玩逗猫棒。');
 await request(station,'DELETE',`/v1/observations/${id}`);
});
test('correction invalidates previous material immediately and preserves history',async()=>{
 const old=await submit('每天喜欢玩球。');await processOne({db,ai,storage},old);
 const replacement=await submit('最近不喜欢玩球。',{replacesId:old});
 const status=(await db.query('SELECT status FROM observations WHERE id=$1',[old])).rows[0].status;assert.equal(status,'withdrawn');
 assert.equal((await request(adopter,'GET',`/v1/pets/${pet}/knowledge`)).json().notes.length,0);
 await processOne({db,ai,storage},replacement);
 assert.equal((await request(adopter,'GET',`/v1/pets/${pet}/knowledge`)).json().notes[0].quote,'最近不喜欢玩球。');
 await request(station,'DELETE',`/v1/observations/${replacement}`);
});
test('provider failure is queued; retry exhaustion is explicit; no fabricated knowledge',async()=>{
 const id=await submit('今天不太爱玩。');extractOverride=async()=>{throw new Error('PRIVATE_PROVIDER_RESPONSE_SECRET');};
 for(let attempt=0;attempt<4;attempt++){await db.query("UPDATE observations SET next_attempt_at=now()-interval '1 minute' WHERE id=$1",[id]);await processOne({db,ai,storage},id);}
 extractOverride=null;
 const row=(await db.query('SELECT * FROM observations WHERE id=$1',[id])).rows[0];assert.equal(row.status,'failed');assert.equal(row.error_code,'PROCESSING_FAILED');
 assert.equal((await db.query('SELECT * FROM knowledge WHERE observation_id=$1',[id])).rows.length,0);
 assert.equal((await request(station,'POST',`/v1/observations/${id}/retry`)).statusCode,200);
 await request(station,'DELETE',`/v1/observations/${id}`);
});
test('withdrawal during extraction fences stale worker writes',async()=>{
 const id=await submit('每天喜欢玩。');
 extractOverride=async text=>{await request(station,'DELETE',`/v1/observations/${id}`);return [{topic:'likes',quote:text,certainty:'ongoing'}];};
 await processOne({db,ai,storage},id);extractOverride=null;
 assert.equal((await db.query('SELECT * FROM knowledge WHERE observation_id=$1',[id])).rows.length,0);
 assert.equal((await db.query('SELECT status FROM observations WHERE id=$1',[id])).rows[0].status,'withdrawn');
});
test('withdrawal during inference blocks stale answer and its persistence',async()=>{
 const id=await submit('每天喜欢晒太阳。');await processOne({db,ai,storage},id);
 answerOverride=async({notes})=>{await request(station,'DELETE',`/v1/observations/${id}`);return {answer:'旧的回答',citationIds:[notes[0].id]};};
 const r=await request(adopter,'POST',`/v1/pets/${pet}/chat`,{question:'喜欢什么？'});answerOverride=null;assert.equal(r.statusCode,409,r.body);
 assert.equal((await db.query("SELECT id FROM chats WHERE answer='旧的回答'")).rows.length,0);
});
test('expired final lease becomes a failed task, not a permanently stuck task',async()=>{
 const id=await submit('今天喜欢安静。');await db.query("UPDATE observations SET status='processing',attempts=4,lease_until=now()-interval '1 minute' WHERE id=$1",[id]);
 await processOne({db,ai,storage},id);assert.equal((await db.query('SELECT status FROM observations WHERE id=$1',[id])).rows[0].status,'failed');
 await request(station,'DELETE',`/v1/observations/${id}`);
});
test('internal worker cannot be triggered anonymously; logout revokes token',async()=>{
 assert.equal((await app.inject({method:'POST',url:'/internal/process'})).statusCode,401);
 assert.equal((await request(other,'POST','/v1/auth/logout')).statusCode,200);
 assert.equal((await request(other,'GET','/v1/me')).statusCode,401);
});
test('extraction preserves full statements and uncertainty',()=>{
 assert.throws(()=>validateExtraction({items:[{topic:'likes',quote:'喜欢抱抱',certainty:'ongoing'}]},'不喜欢抱抱。'));
 const [note]=validateExtraction({items:[{topic:'health',quote:'今天可能有点软便。',certainty:'ongoing'}]},'今天可能有点软便。');assert.equal(note.certainty,'pending');
 assert.throws(()=>validateExtraction({items:[{topic:'likes',quote:'喜欢球。',certainty:'ongoing'}]},'喜欢绳子。'));
});
test('provider adapter uses configured model and never forwards provider error bodies',async()=>{
 let model;
 const provider=createAI({AI_BASE_URL:'https://provider.invalid/v1',AI_API_KEY:'fake-test-key',AI_CHAT_MODEL:'configured-model'},async(url,options)=>{model=JSON.parse(options.body).model;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items:[{sourceId:'s0',topic:'likes',certainty:'ongoing'}]})}}]}));});
 assert.equal((await provider.extract('每天喜欢玩。')).length,1);assert.equal(model,'configured-model');
 const failing=createAI({AI_BASE_URL:'https://provider.invalid/v1',AI_API_KEY:'fake'},async()=>new Response('private credentials',{status:401}));
 await assert.rejects(()=>failing.extract('test'),error=>error.code==='AI_PROVIDER_ERROR'&&!error.message.includes('private credentials'));
});
test('AI selects source IDs while server retains subjects, negations and multi-clause context',()=>{
 const transcript='吐司平时不喜欢抱抱。每天晚上比较活跃，白天喜欢在安静的地方睡觉。';
 const sources=sourceSentences(transcript);
 const notes=resolveSelection({items:[{sourceId:'s0',topic:'likes',certainty:'ongoing'},{sourceId:'s1',topic:'habits',certainty:'ongoing'}]},sources,transcript);
 assert.equal(notes[0].quote,'吐司平时不喜欢抱抱。');
 assert.equal(notes[1].quote,'每天晚上比较活跃，白天喜欢在安静的地方睡觉。');
 assert.throws(()=>resolveSelection({items:[{sourceId:'invented',topic:'likes',certainty:'ongoing'}]},sources,transcript));
});
