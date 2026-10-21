import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const base='https://pawletter-api-446222711695.asia-east1.run.app';
const origin='https://pawletter-adoption-h5.chenaaron668.chatgpt.site';
const report={};let token;
async function call(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),'Idempotency-Key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});return {status:r.status,data:await r.json()};}
const answers={work:{text:'我平时居家办公，白天离家不超过两小时。',value:'short'},routine:{text:'通常早上七点起床，晚上十一点睡觉，作息规律。',value:'regular'},free:{text:'每天有两小时以上可以安排喂食、清理和陪伴。',value:'over2'},expectation:{text:'我更期待安静的成年猫，愿意耐心陪它适应。',value:'quiet'}};
try{
 const ready=await call('/ready');report.ready=ready.status===200;
 const interview=await call('/v1/onboarding/interview',{key:'work',text:answers.work.text});report.interview={status:interview.status,understood:interview.data.understood,value:interview.data.value,error:interview.data.error};
 const summary=await call('/v1/onboarding/summary',answers);report.summary={status:summary.status,valid:!!summary.data.title&&Array.isArray(summary.data.recommendations),error:summary.data.error};
 const username='qa_'+Date.now(),password=randomBytes(24).toString('base64url');
 const registered=await call('/v1/auth/register',{username,password,nickname:'流程验收账号',realName:'流程验收',phone:'00000000000',wechat:'',email:'',covenant:true,privacy:true,lifestyle:{answers,...(summary.status===200?{analysis:summary.data}:{})}});
 token=registered.data.token;report.registration={status:registered.status,pending:registered.data.profile?.verification==='pending',consent:registered.data.profile?.consent===true};
 if(token){const profile=await call('/v1/adopter/profile');report.profile=profile.status===200&&profile.data.nickname==='流程验收账号';await call('/v1/auth/logout',{});const rejected=await call('/v1/adopter/profile');report.logoutRevoked=rejected.status===401;token=null;
 const login=await call('/v1/auth/login',{username,password});token=login.data.token;report.login=login.status===200;if(token)await call('/v1/auth/logout',{});token=null;}
 const audio=await readFile(new URL('../.local/verification.wav',import.meta.url));
 const asr=await fetch(base+'/v1/onboarding/transcribe',{method:'POST',headers:{Origin:origin,'Content-Type':'audio/wav'},body:audio,signal:AbortSignal.timeout(90000)});const text=await asr.json();report.asr={status:asr.status,hasText:!!text.text,error:text.error};
}catch(e){report.failure=e.name;}
console.log(JSON.stringify(report));
