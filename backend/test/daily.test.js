import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/db.js';
import {provision,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
let engine,db,app,station,other,petId;
const blobs=new Map(),storage={put:async(k,v)=>blobs.set(k,v),read:async k=>blobs.get(k),remove:async k=>blobs.delete(k)};
const request=(token,method,url,payload,extra={})=>app.inject({method,url,headers:{authorization:`Bearer ${token}`,...extra},...(payload===undefined?{}:{payload})});
const jpeg='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216]),Buffer.alloc(30)]).toString('base64');
const video='data:video/webm;base64,'+Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(30)]).toString('base64');
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const daysAgo=n=>new Date(Date.now()-n*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
before(async()=>{
 engine=new PGlite();const query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params);db={query,connect:async()=>({query,release(){}})};await migrate(db);
 const password='daily-record-test-123';
 for(const [username,stationId] of [['daily-one','d1'],['daily-two','d2']])await provision(db,{username,password,role:'station',stationId,stationName:stationId});
 station=(await login(db,'daily-one',password)).token;other=(await login(db,'daily-two',password)).token;
 app=await createApp({db,ai:{},storage});
 const created=await request(station,'POST','/v1/intake/commit',{name:'小橘',profile:{species:'cat',description:'橘猫。'},published:false,text:'橘猫。',ocrText:'',photos:[jpeg]},{'idempotency-key':randomUUID()});
 assert.equal(created.statusCode,201,created.body);petId=created.json().id;
});
after(async()=>{await app?.close();await engine?.close();});
const submit=(body,key=randomUUID(),token=station)=>request(token,'POST',`/v1/pets/${petId}/observations`,body,{'idempotency-key':key});
const list=async(query='')=>(await request(station,'GET',`/v1/pets/${petId}/observations${query}`)).json().observations;

test('a daily record keeps when it happened, its photos and video, and leaves the cover alone',async()=>{
 const cover=(await request(station,'GET',`/v1/pets/${petId}`)).json().profile.photoUrl,key=randomUUID();
 const body={text:'今天第一次主动靠过来了。',shareWithAgent:true,observedOn:daysAgo(2),photos:[jpeg],video};
 const saved=await submit(body,key);assert.equal(saved.statusCode,202,saved.body);
 assert.equal((await submit(body,key)).json().id,saved.json().id,'A retried save is not duplicated');
 const record=(await list()).find(r=>r.id===saved.json().id);
 assert.equal(record.observed_on,daysAgo(2));assert.deepEqual(record.visuals.map(v=>v.mime),['image/jpeg','video/webm']);
 assert.match(record.visuals[0].url,new RegExp(`/v1/pets/${petId}/visual/\\d+$`));
 assert.equal((await request(station,'GET',new URL(record.visuals[0].url).pathname)).statusCode,200);
 assert.equal((await request(station,'GET',`/v1/pets/${petId}`)).json().profile.photoUrl,cover);
 const album=(await request(station,'GET',`/v1/pets/${petId}/intake`)).json().visuals;assert.equal(album.length,3,'New media also joins the album');
 assert.ok(album.filter(v=>v.mime!=='image/jpeg'||v.shared===false).length>=2,'Daily media stays station-only');
});

test('records sort and filter by the day they happened, and entries without a date fall back to the entry day',async()=>{
 await submit({text:'上周的事。',observedOn:daysAgo(7)});await submit({text:'今天的事，没填日期。'});
 const rows=await list();assert.equal(rows[0].observed_on,null);assert.equal(rows.at(-1).observed_on,daysAgo(7));
 const week=await list(`?from=${daysAgo(8)}&to=${daysAgo(6)}`);assert.deepEqual(week.map(r=>r.original_text),['上周的事。']);
});

test('future dates and other stations are rejected without storing files',async()=>{
 const stored=blobs.size,tomorrow=new Date(Date.now()+2*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
 assert.equal((await submit({text:'明天的事。',observedOn:tomorrow,photos:[jpeg]})).statusCode,400);
 assert.equal((await submit({text:'别站的照片。',photos:[jpeg]},randomUUID(),other)).statusCode,403);
 assert.equal((await submit({text:'坏照片。',photos:['data:image/jpeg;base64,AAAA']})).statusCode,400);
 assert.equal(blobs.size,stored);
});

test('a correction replaces the old record and keeps its photos',async()=>{
 const first=(await submit({text:'它不吃罐头。',observedOn:daysAgo(3),photos:[jpeg]})).json().id;
 const fixed=await submit({text:'它只是不吃鸡肉味罐头。',observedOn:daysAgo(3),replacesId:first});assert.equal(fixed.statusCode,202,fixed.body);
 const rows=await list();
 assert.equal(rows.find(r=>r.id===first).status,'withdrawn');assert.deepEqual(rows.find(r=>r.id===first).visuals,[]);
 const corrected=rows.find(r=>r.id===fixed.json().id);assert.equal(corrected.replaces_id,first);assert.equal(corrected.visuals.length,1);assert.equal(corrected.observed_on,daysAgo(3));
});


test('media-only supplements archive without inventing knowledge or requiring an event date',async()=>{
 const saved=await submit({photos:[jpeg],video});assert.equal(saved.statusCode,202,saved.body);
 const id=saved.json().id,result=await request(station,'POST',`/v1/observations/${id}/process`);
 assert.equal(result.statusCode,200,result.body);assert.equal(result.json().error,undefined,'Media alone does not need ASR or text extraction');
 const record=(await list()).find(r=>r.id===id);assert.equal(record.status,'archived');assert.equal(record.original_text,'');assert.equal(record.observed_on,null);assert.equal(record.visuals.length,2);
 assert.equal((await db.query('SELECT * FROM knowledge WHERE observation_id=$1',[id])).rows.length,0);
 assert.equal((await submit({text:'',photos:[]})).statusCode,400,'A completely empty addition is still rejected');
});
