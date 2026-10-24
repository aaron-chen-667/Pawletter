import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../src/app.js';
import {migrate} from '../src/db.js';

const production='https://pawletter-adoption-h5.chenaaron668.chatgpt.site';
const preview='https://preview.example.com';
const routes=['/v1/onboarding/transcribe','/v1/onboarding/interview','/v1/onboarding/summary','/v1/auth/register'];
const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
const preflight=(app,origin)=>app.inject({method:'OPTIONS',url:'/v1/auth/register',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'Content-Type,Idempotency-Key'}});

test('default single origin still permits the production site and origin-less health checks',async()=>{
 const app=await createApp({db:{},ai:{},storage:{}});
 try{
  const cors=await preflight(app,production);
  assert.equal(cors.statusCode,204);
  assert.equal(cors.headers['access-control-allow-origin'],production);
  assert.equal((await preflight(app,preview)).headers['access-control-allow-origin'],undefined);
  const health=await app.inject('/health');assert.equal(health.statusCode,200);
  assert.equal(health.headers['access-control-allow-origin'],undefined);
 }finally{await app.close();}
});

test('both allowed origins pass CORS and all four anonymous endpoints using the same policy',async()=>{
 const engine=new PGlite(),query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params);
 const db={query,connect:async()=>({query,release(){}})};
 let app;
 try{
  await migrate(db);
  const calls={speech:0,interview:0,summary:0};
  const summary={title:'稳定陪伴',summary:'你有规律的作息。',highlights:['规律作息'],recommendations:[{type:'成年猫',reason:'仍需了解个体需求。',basedOn:['routine']}],unknowns:['居住环境待了解']};
  const answers={work:{text:'朝九晚六',value:'long'},routine:{text:'早睡早起',value:'regular'},free:{text:'每天一小时',value:'one2'},expectation:{text:'喜欢安静',value:'quiet'}};
  const ai={transcribe:async()=>{calls.speech++;return '我每天可以陪伴一小时。';},interview:async()=>{calls.interview++;return {understood:true,value:'unknown',reply:'记下了。'};},summarizeLifestyle:async()=>{calls.summary++;return summary;}};
  app=await createApp({db,ai,storage:{},origin:production,additionalOrigins:` ${preview}, ${production} `});
  for(const [index,origin] of [production,preview].entries()){
   const cors=await preflight(app,origin);
   assert.equal(cors.statusCode,204);
   assert.equal(cors.headers['access-control-allow-origin'],origin);
   assert.match(cors.headers.vary,/(^|,\s*)Origin(,|$)/i);
   assert.equal(cors.headers['access-control-allow-credentials'],undefined);
   const registration={username:`origin-user-${index}`,password:'origin-test-password',nickname:'测试用户',realName:'测试用户',phone:'13800000000',wechat:'test-user',email:'test@example.com',covenant:true,privacy:true,lifestyle:{answers,analysis:summary}};
   const requests=[
    {url:routes[0],headers:{'content-type':'audio/wav'},payload:wav,status:200},
    {url:routes[1],payload:{key:'work',text:'我还不确定'},status:200},
    {url:routes[2],payload:answers,status:200},
    {url:routes[3],headers:{'idempotency-key':randomUUID()},payload:registration,status:201}
   ];
   for(const {status,headers={},...request} of requests){
    const response=await app.inject({method:'POST',...request,headers:{...headers,origin}});
    assert.equal(response.statusCode,status,`${origin} ${request.url}: ${response.body}`);
    assert.equal(response.headers['access-control-allow-origin'],origin);
   }
  }
  assert.deepEqual(calls,{speech:2,interview:2,summary:2});
  assert.equal((await db.query('SELECT id FROM users')).rows.length,2);
 }finally{await app?.close();await engine.close();}
});

test('untrusted, missing and near-match origins cannot invoke anonymous work or receive CORS permission',async t=>{
 const rejected=[undefined,'null','https://untrusted.example.com',`${preview}.evil.example`,'https://evilpreview.example.com','https://preview.example.com:444',`http://preview.example.com`,`${production}.evil.example`];
 for(const origin of rejected)await t.test(origin??'missing Origin',async()=>{
  let calls=0;
  const unexpected=async()=>{calls++;throw new Error('Rejected origins must not reach dependencies');};
  const app=await createApp({db:{query:unexpected,connect:unexpected},ai:{transcribe:unexpected,interview:unexpected,summarizeLifestyle:unexpected},storage:{},additionalOrigins:preview});
  try{
   if(origin!==undefined){
    const cors=await preflight(app,origin);
    assert.equal(cors.headers['access-control-allow-origin'],undefined);
   }
   for(const url of routes){
    const headers={...(origin===undefined?{}:{origin}),...(url===routes[0]?{'content-type':'audio/wav'}:{})};
    const response=await app.inject({method:'POST',url,headers,payload:url===routes[0]?wav:{}});
    assert.equal(response.statusCode,403,`${url}: ${response.body}`);
    assert.equal(response.json().error,'ORIGIN_REQUIRED');
    assert.equal(response.headers['access-control-allow-origin'],undefined);
   }
   assert.equal(calls,0);
  }finally{await app.close();}
 });
});

test('invalid configured origins fail before the app is created',async()=>{
 const invalid=['','*','https://*.example.com','null','file:///tmp/example','https://example.com/path','https://user:password@example.com','https://example.com?all=1','https://example.com#fragment',true];
 for(const origin of invalid)await assert.rejects(createApp({db:{},ai:{},storage:{},origin}),/Frontend origins must be exact/);
 for(const additionalOrigins of ['*',`${preview},`,` ,${preview}`,`${preview},https://*.example.com`,`${preview},https://example.com/path`,[preview]]){
  await assert.rejects(createApp({db:{},ai:{},storage:{},additionalOrigins}),/Frontend origins must be exact/);
 }
});

test('an existing custom primary origin remains usable with a comma-separated additional list',async()=>{
 const primary='http://localhost:4178',second='https://second-preview.example.com';
 const app=await createApp({db:{},ai:{},storage:{},origin:primary,additionalOrigins:`${preview},${second}`});
 try{
  for(const origin of [primary,preview,second])assert.equal((await preflight(app,origin)).headers['access-control-allow-origin'],origin);
 }finally{await app.close();}
});


test('primary origin lists and additional origins combine under one normalized policy',async()=>{
 const second='https://second-preview.example.com';
 const app=await createApp({db:{},ai:{},storage:{},origin:`${production}/,${preview}:443`,additionalOrigins:second});
 try{
  for(const origin of [production,preview,second])assert.equal((await preflight(app,origin)).headers['access-control-allow-origin'],origin);
  assert.equal((await preflight(app,`${second}.evil.example`)).headers['access-control-allow-origin'],undefined);
 }finally{await app.close();}
});
