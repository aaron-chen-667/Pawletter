import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/db.js';
import {provision,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
let engine,db,app,station,other,adopter;
const ai={};
const blobs=new Map(),storage={put:async(k,v)=>blobs.set(k,v),read:async k=>blobs.get(k),remove:async k=>blobs.delete(k)};
const request=(token,method,url,payload,extra={})=>app.inject({method,url,headers:{authorization:`Bearer ${token}`,...extra},...(payload===undefined?{}:{payload})});
before(async()=>{
 engine=new PGlite();const query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params);db={query,connect:async()=>({query,release(){}})};await migrate(db);
 const password='intake-boundary-test-123';
 for(const [username,role,stationId] of [['intake-one','station','s1'],['intake-two','station','s2'],['intake-adopter','adopter',null]])await provision(db,{username,password,role,stationId,stationName:stationId});
 station=(await login(db,'intake-one',password)).token;other=(await login(db,'intake-two',password)).token;adopter=(await login(db,'intake-adopter',password)).token;
 app=await createApp({db,ai,storage});
});
after(async()=>{await app?.close();await engine?.close();});
test('analysis accepts confirmed fields, filters unsupported corrections and limits total text',async()=>{
 const draft={name:'',species:'cat',description:'橘色短毛猫。',character:'',age:'五岁',sex:'unknown',ocrText:'',uncertainties:[]};
 let calls=0,received;
 ai.draftIntake=async body=>{calls++;received=body;return {...draft,corrections:[{field:'age',quote:'刚才三岁说错了，是五岁。'},{field:'name',quote:'刚才三岁说错了，是五岁。'}]};};
 const input={text:'橘色猫，先手动确认三岁。\n刚才三岁说错了，是五岁。',images:[],confirmedFields:{age:'三岁'},latestText:'刚才三岁说错了，是五岁。'};
 const analyzed=await request(station,'POST','/v1/intake/analyze',input);assert.equal(analyzed.statusCode,200,analyzed.body);assert.deepEqual(received,input);
 assert.equal(analyzed.json().age,'五岁');assert.deepEqual(analyzed.json().corrections,[{field:'age',quote:input.latestText}]);
 const legacy=await request(station,'POST','/v1/intake/analyze',{text:'橘色短毛猫。',images:[]});assert.equal(legacy.statusCode,200,legacy.body);assert.deepEqual(legacy.json().corrections,[]);
 const tooLong=await request(station,'POST','/v1/intake/analyze',{text:'甲'.repeat(12000),images:[],latestText:'乙'.repeat(4000),confirmedFields:{description:'丙'.repeat(4000),age:'一'}});assert.equal(tooLong.statusCode,400,tooLong.body);
 const unknown=await request(station,'POST','/v1/intake/analyze',{...input,confirmedFields:{published:'true'}});assert.equal(unknown.statusCode,400,unknown.body);assert.equal(calls,2);
});
test('text-only intake keeps unknown details, creates no media, and can be retried and edited',async()=>{
 const body={name:'待命名 001',profile:{species:'unknown',description:'左前爪是白色，今天住在本站第三间隔离屋。',photoUrl:'https://untrusted.invalid/photo.jpg'},published:false,text:'还没取名，左前爪是白色，今天住在本站第三间隔离屋。年龄和性别不清楚。',ocrText:'',photos:[]},key=randomUUID(),stored=blobs.size;
 const first=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':key});assert.equal(first.statusCode,201,first.body);const id=first.json().id;
 const retry=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':key});assert.equal(retry.statusCode,201,retry.body);assert.deepEqual(retry.json(),first.json());
 assert.equal((await request(other,'POST','/v1/intake/commit',body,{'idempotency-key':key})).statusCode,409);
 assert.equal((await request(station,'POST','/v1/intake/commit',{...body,name:'另一个名字'},{'idempotency-key':key})).statusCode,409);
 const saved=(await request(station,'GET',`/v1/pets/${id}`)).json();assert.equal(saved.published,false);assert.equal(saved.profile.species,'unknown');assert.equal(saved.profile.photoUrl,'');assert.equal(saved.profile.age,'');assert.equal(saved.profile.sex,'unknown');
 const source=(await request(station,'GET',`/v1/pets/${id}/intake`)).json();assert.equal(source.source_text,body.text);assert.deepEqual(source.visuals,[]);assert.equal(blobs.size,stored);
 assert.equal((await db.query('SELECT * FROM observations WHERE pet_id=$1',[id])).rows.length,1);assert.equal((await db.query('SELECT * FROM pet_agents WHERE pet_id=$1',[id])).rows.length,1);
 assert.equal((await request(adopter,'GET',`/v1/pets/${id}`)).statusCode,404);assert.equal((await request(station,'GET',`/v1/pets/${id}/visual/0`)).statusCode,404);
 const edit=await request(station,'POST',`/v1/pets/${id}/profile`,{name:saved.name,profile:{...saved.profile,description:'左前爪是白色，现在住在本站第四间隔离屋。'},published:false});assert.equal(edit.statusCode,200,edit.body);
});
test('intake requires some identifying material and never treats a video as the profile photo',async()=>{
 const body={name:'待命名 002',profile:{species:'unknown'},published:false,text:'',ocrText:'',photos:[]};
 const empty=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':randomUUID()});assert.equal(empty.statusCode,400,empty.body);assert.equal(empty.json().error,'EMPTY_INTAKE');
 const video='data:video/webm;base64,'+Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(20)]).toString('base64');
 const result=await request(station,'POST','/v1/intake/commit',{...body,video},{'idempotency-key':randomUUID()});assert.equal(result.statusCode,201,result.body);const id=result.json().id;
 const saved=(await request(station,'GET',`/v1/pets/${id}`)).json();assert.equal(saved.profile.photoUrl,'');assert.equal(result.json().observationId,null);
 const visuals=(await request(station,'GET',`/v1/pets/${id}/intake`)).json().visuals;assert.equal(visuals.length,1);assert.equal(visuals[0].mime,'video/webm');
 assert.equal((await request(station,'GET',`/v1/pets/${id}/visual/0`)).headers['content-type'],'video/webm');
});
test('simple intake stores exactly the confirmed text and leaves legacy description behavior unchanged',async()=>{
 const text='  它叫小满，约 2 岁，尚未确认。\n没有发现伤口，不代表已经检查过。  ';
 const body={simple:true,name:'小满',profile:{species:'cat',description:'AI 改写的内容不应覆盖最终文字。'},published:false,text,ocrText:'',photos:[]};
 const result=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':randomUUID()});assert.equal(result.statusCode,201,result.body);const id=result.json().id;
 assert.equal((await request(station,'GET',`/v1/pets/${id}`)).json().profile.description,text);
 assert.equal((await request(station,'GET',`/v1/pets/${id}/intake`)).json().source_text,text);
 assert.equal((await db.query('SELECT original_text FROM observations WHERE id=$1',[result.json().observationId])).rows[0].original_text,text);
 const legacy=await request(station,'POST','/v1/intake/commit',{...body,simple:false},{'idempotency-key':randomUUID()});assert.equal(legacy.statusCode,201,legacy.body);
 assert.equal((await db.query('SELECT original_text FROM observations WHERE id=$1',[legacy.json().observationId])).rows[0].original_text,body.profile.description);
 const empty=await request(station,'POST','/v1/intake/commit',{...body,text:''},{'idempotency-key':randomUUID()});assert.equal(empty.statusCode,400);assert.equal(empty.json().error,'EMPTY_INTAKE');
 assert.equal((await request(station,'POST','/v1/intake/commit',{...body,text:'甲'.repeat(4001)},{'idempotency-key':randomUUID()})).statusCode,400);
});
const documentData=(mime,bytes)=>`data:${mime};base64,${bytes.toString('base64')}`;
const pdf=Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
test('a document-only intake retains its file privately even after the pet is published',async()=>{
 const body={simple:true,name:'待命名材料',profile:{species:'unknown',description:'未确认的 OCR 不能变成首次记录。'},published:false,text:'',ocrText:'',photos:[],documents:[{name:'交接记录（原件）.pdf',dataUrl:documentData('application/pdf',pdf)}]},key=randomUUID(),stored=blobs.size;
 const first=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':key});assert.equal(first.statusCode,201,first.body);const id=first.json().id;
 const retry=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':key});assert.deepEqual(retry.json(),first.json());assert.equal(blobs.size,stored+1);assert.equal(first.json().observationId,null);
 const saved=(await request(station,'GET',`/v1/pets/${id}`)).json();assert.equal(saved.profile.photoUrl,'');assert.equal(saved.profile.description,'');
 const source=(await request(station,'GET',`/v1/pets/${id}/intake`)).json();assert.deepEqual(source.visuals,[]);assert.equal(source.documents.length,1);assert.equal(source.documents[0].name,body.documents[0].name);assert.equal(source.documents[0].mime,'application/pdf');assert.equal(source.documents[0].size,pdf.length);
 const path=new URL(source.documents[0].url).pathname,download=await request(station,'GET',path);assert.equal(download.statusCode,200,download.body);assert.equal(download.headers['content-type'],'application/pdf');assert.match(download.headers['content-disposition'],/^attachment;/);assert.match(download.headers['content-disposition'],/filename\*=UTF-8''/);assert.deepEqual(download.rawPayload,pdf);
 assert.equal((await db.query('SELECT shared FROM media WHERE pet_id=$1',[id])).rows[0].shared,false);
 const publish=await request(station,'POST',`/v1/pets/${id}/profile`,{name:saved.name,profile:saved.profile,published:true});assert.equal(publish.statusCode,200,publish.body);
 assert.equal((await app.inject({method:'GET',url:path})).statusCode,401);assert.equal((await request(other,'GET',path)).statusCode,403);assert.equal((await request(adopter,'GET',path)).statusCode,403);
 assert.equal((await request(other,'GET',`/v1/pets/${id}/intake`)).statusCode,403);assert.equal((await request(station,'GET',`/v1/pets/${id}/visual/0`)).statusCode,404);
 const conflict=await request(station,'POST','/v1/intake/commit',{...body,documents:[{...body.documents[0],name:'另一份.pdf'}]},{'idempotency-key':key});assert.equal(conflict.statusCode,409);
});
test('document upload accepts image formats and validates type, limits and names before storage',async()=>{
 const documents=[['image/jpeg',Buffer.concat([Buffer.from([255,216]),Buffer.alloc(20)])],['image/png',Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(20)])],['image/webp',Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),Buffer.alloc(20)])]].map(([mime,bytes],i)=>({name:`材料 ${i}`,dataUrl:documentData(mime,bytes)}));
 const base={simple:true,name:'图片材料',profile:{species:'unknown'},published:false,text:'',ocrText:'',photos:[],documents};
 const valid=await request(station,'POST','/v1/intake/commit',base,{'idempotency-key':randomUUID()});assert.equal(valid.statusCode,201,valid.body);
 const source=(await request(station,'GET',`/v1/pets/${valid.json().id}/intake`)).json();assert.deepEqual(source.documents.map(d=>d.mime),['image/jpeg','image/png','image/webp']);assert.deepEqual(source.visuals,[]);
 const stored=blobs.size,invalids=[
  [{name:'假图片.jpg',dataUrl:documentData('image/jpeg',pdf)}],
  [{name:'网页.html',dataUrl:documentData('text/html',Buffer.from('<html>unexpected</html>'))}],
  [{name:'坏\n文件.pdf',dataUrl:documentData('application/pdf',pdf)}],
  [{name:'过大.pdf',dataUrl:documentData('application/pdf',Buffer.concat([pdf,Buffer.alloc(5*1024*1024)]))}],
  [...documents,documents[0]],
 ];
 for(const documents of invalids){const bad=await request(station,'POST','/v1/intake/commit',{...base,documents},{'idempotency-key':randomUUID()});assert.equal(bad.statusCode,400,bad.body);}
 assert.equal(blobs.size,stored);
});
test('failed attachment storage rolls back the new pet and removes earlier stored files',async()=>{
 const body={simple:true,name:'不能留下半份档案',profile:{species:'unknown'},published:false,text:'只有经确认的记录。',ocrText:'',photos:[],documents:[{name:'第一份.pdf',dataUrl:documentData('application/pdf',pdf)},{name:'第二份.pdf',dataUrl:documentData('application/pdf',pdf)}]},beforePets=(await db.query('SELECT count(*) AS count FROM pets')).rows[0].count,stored=blobs.size,put=storage.put;
 storage.put=async(k,v)=>{if(k.endsWith('/document/1'))throw Error('storage unavailable');return put(k,v);};
 try{const failed=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':randomUUID()});assert.equal(failed.statusCode,500);}
 finally{storage.put=put;}
 assert.equal((await db.query('SELECT count(*) AS count FROM pets')).rows[0].count,beforePets);assert.equal(blobs.size,stored);
});
test('reviewed card notes are archived as written, and station-only notes never reach the agent',async()=>{
 const notes=[{topic:'likes',quote:'平时最爱追逗猫棒。',certainty:'ongoing',shared:true},{topic:'health',quote:'疫苗记录待核实。',certainty:'pending',shared:true},{topic:'other',quote:'送来的人电话已存交接表。',certainty:'observation',shared:false}];
 const body={name:'桔子',profile:{species:'cat',description:'平时最爱追逗猫棒。疫苗记录待核实。'},published:false,text:'原始口述。',ocrText:'',photos:[],notes},key=randomUUID();
 const first=await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':key});assert.equal(first.statusCode,201,first.body);const id=first.json().id;
 assert.deepEqual((await request(station,'POST','/v1/intake/commit',body,{'idempotency-key':key})).json(),first.json());
 const records=(await db.query('SELECT share_with_agent,status,original_text FROM observations WHERE pet_id=$1 ORDER BY share_with_agent DESC',[id])).rows;
 assert.deepEqual(records.map(r=>[r.share_with_agent,r.status]),[[true,'archived'],[false,'archived']]);
 const station_notes=(await request(station,'GET',`/v1/pets/${id}/knowledge`)).json().notes.map(n=>[n.topic,n.quote,n.certainty]).sort();
 assert.deepEqual(station_notes,notes.map(n=>[n.topic,n.quote,n.certainty]).sort());
 assert.equal((await db.query("SELECT count(*)::int AS n FROM observations WHERE pet_id=$1 AND status='queued'",[id])).rows[0].n,0,'Reviewed notes are not re-classified by the worker');
 const published=await request(station,'POST',`/v1/pets/${id}/profile`,{name:'桔子',profile:(await request(station,'GET',`/v1/pets/${id}`)).json().profile,published:true});assert.equal(published.statusCode,200,published.body);
 const adopterNotes=(await request(adopter,'GET',`/v1/pets/${id}/knowledge`)).json().notes.map(n=>n.quote);
 assert.deepEqual(adopterNotes.sort(),['平时最爱追逗猫棒。','疫苗记录待核实。'].sort());
 const bad=await request(station,'POST','/v1/intake/commit',{...body,notes:[{...notes[0],topic:'secrets'}]},{'idempotency-key':randomUUID()});assert.equal(bad.statusCode,400);
});
test('guided coverage reopens a declined dimension once the rescuer answers it',async()=>{
 ai.draftIntake=async()=>({name:'',species:'cat',description:'打过疫苗。',character:'',age:'',sex:'unknown',ocrText:'',uncertainties:[],coverage:{health:'covered'}});
 const analyzed=await request(station,'POST','/v1/intake/analyze',{text:'健康不清楚。\n后来想起来打过疫苗。',images:[],declined:['health','sex']});
 assert.equal(analyzed.statusCode,200,analyzed.body);assert.equal(analyzed.json().coverage.health,'covered');assert.equal(analyzed.json().coverage.sex,'unknown');
});


test('daily Agent analysis is owner-only, uses active notes and never writes records before confirmation',async()=>{
 const petId=randomUUID(),obs=randomUUID(),withdrawn=randomUUID();
 await db.query('INSERT INTO pets(id,station_id,name,profile) VALUES($1,$2,$3,$4)',[petId,'s1','分析测试伙伴',JSON.stringify({species:'cat'})]);
 for(const [id,status,quote]of [[obs,'archived','疫苗时间不清楚。'],[withdrawn,'withdrawn','已撤回的信息。']]){
  await db.query('INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,status) VALUES($1,$2,(SELECT id FROM users WHERE username=$3),$4,$5,$6,$7)',[id,petId,'intake-one',id,'hash',quote,status]);
  await db.query('INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,petId,'health',quote,'pending']);
 }
 let seen,calls=0;ai.reviewObservation=async body=>{seen=body;calls++;return {reply:'先保留为本次观察。',nextQuestion:'这是今天观察到的吗？'};};
 const url='/v1/pets/'+petId+'/observations/analyze',body={text:'今天吃得少。',images:[],history:[{text:'最近食欲变化。',question:'什么时候观察到的？'}],observedOn:'2026-10-24'};
 assert.equal((await request(adopter,'POST',url,body)).statusCode,403);
 assert.equal((await request(other,'POST',url,body)).statusCode,403);
 assert.equal((await app.inject({method:'POST',url,payload:body})).statusCode,401);
 assert.equal(calls,0);
 const response=await request(station,'POST',url,body);assert.equal(response.statusCode,200,response.body);assert.match(response.json().reply,/本次观察/);
 assert.equal(seen.pet.name,'分析测试伙伴');assert.deepEqual(seen.history,body.history);assert.equal(seen.notes.length,1);assert.equal(seen.notes[0].certainty,'pending');assert.equal(seen.notes[0].quote,'疫苗时间不清楚。');
 assert.equal((await db.query('SELECT * FROM observations WHERE pet_id=$1',[petId])).rows.length,2);
 assert.equal((await request(station,'POST',url,{...body,images:[{kind:'photo',dataUrl:'data:image/jpeg;base64,AAAA'}]})).statusCode,400);
 assert.equal(calls,1);
 const jpeg='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216]),Buffer.alloc(30)]).toString('base64');
 assert.equal((await request(station,'POST',url,{...body,text:'',images:[{kind:'video',dataUrl:jpeg}],replacesId:obs})).statusCode,200);assert.equal(seen.images[0].kind,'video');assert.equal(seen.original.original_text,'疫苗时间不清楚。');
 assert.equal((await request(station,'POST',url,{...body,replacesId:withdrawn})).statusCode,409);
 ai.reviewObservation=async()=>({reply:42});const invalid=await request(station,'POST',url,body);assert.equal(invalid.statusCode,502);assert.equal(invalid.json().error,'AI_INVALID_RESPONSE');
});
