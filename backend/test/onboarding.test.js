import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../src/app.js';
import {migrate} from '../src/db.js';
import {ApiError} from '../src/errors.js';
test('real adopter registration persists private profile, rejects escalation, is retry-safe and revokes sessions',async()=>{
 const engine=new PGlite(),query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params);
 const db={query,connect:async()=>({query,release(){}})};await migrate(db);
 const summary={title:'认真生活的小能手',summary:'你有稳定的陪伴时间。',highlights:['每天一小时'],recommendations:[{type:'活动需求适中的成年猫',reason:'偏好安静的陪伴，仍需了解个体需求。',basedOn:['free','expectation']}],unknowns:['居住环境待了解']};
 const ai={transcribe:async()=>{throw new ApiError(502,'AI_RATE_LIMITED');},interview:async()=>({understood:true,value:'unknown',reply:'记下了。'}),summarizeLifestyle:async()=>summary};
 const app=await createApp({db,ai,storage:{}}),origin='https://pawletter-adoption-h5.chenaaron668.chatgpt.site';
 const body={username:'new-adopter',password:'only-for-test-12345',nickname:'新用户',realName:'测试用户',phone:'13800000000',wechat:'wx-user',email:'user@example.com',covenant:true,privacy:true,lifestyle:{answers:{work:{text:'朝九晚六',value:'long'},routine:{text:'早睡早起',value:'regular'},free:{text:'每天一小时',value:'one2'},expectation:{text:'喜欢安静',value:'quiet'}},analysis:summary}};
 const key=randomUUID(),register=payload=>app.inject({method:'POST',url:'/v1/auth/register',headers:{origin,'idempotency-key':key},payload});
 try{
  assert.equal((await register({...body,verification:'verified'})).statusCode,400);
  assert.equal((await register({...body,role:'station'})).statusCode,400);
  const first=await register(body);assert.equal(first.statusCode,201,first.body);const result=first.json();
  assert.equal(result.user.role,'adopter');assert.equal(result.profile.verification,'pending');assert.equal(result.profile.consent,true);
  const retry=await register(body);assert.equal(retry.statusCode,201,retry.body);assert.equal(retry.json().user.id,result.user.id);
  const duplicate=await app.inject({method:'POST',url:'/v1/auth/register',headers:{origin,'idempotency-key':randomUUID()},payload:body});assert.equal(duplicate.statusCode,409,duplicate.body);
  const stored=(await db.query('SELECT * FROM users WHERE id=$1',[result.user.id])).rows[0];assert.notEqual(stored.password_hash,body.password);
  const headers={authorization:`Bearer ${result.token}`};
  assert.equal((await app.inject('/v1/adopter/profile')).statusCode,401);
  const profile=await app.inject({url:'/v1/adopter/profile',headers});assert.equal(profile.json().phone,body.phone);assert.equal(profile.json().lifestyle.analysis.title,summary.title);assert.equal(profile.json().password,undefined);
  assert.equal((await app.inject({method:'POST',url:'/v1/adopter/preferences',headers,payload:{proactive:false}})).statusCode,200);
  assert.equal((await app.inject({url:'/v1/adopter/profile',headers})).json().consent,false);
  const interview=await app.inject({method:'POST',url:'/v1/onboarding/interview',headers:{origin},payload:{key:'work',text:'我不确定'}});assert.equal(interview.statusCode,200,interview.body);
  assert.equal((await app.inject({method:'POST',url:'/v1/onboarding/summary',headers:{origin},payload:body.lifestyle.answers})).json().title,summary.title);
  const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
  const busy=await app.inject({method:'POST',url:'/v1/onboarding/transcribe',headers:{origin,'content-type':'audio/wav'},payload:wav});assert.equal(busy.statusCode,429);assert.equal(busy.json().error,'SPEECH_PROVIDER_BUSY');assert.equal(busy.headers['retry-after'],'30');
  await app.inject({method:'POST',url:'/v1/auth/logout',headers});assert.equal((await app.inject({url:'/v1/adopter/profile',headers})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/v1/auth/login',payload:{username:body.username,password:body.password}});assert.equal(login.statusCode,200,login.body);
 }finally{await app.close();await engine.close();}
});
