const BASE='https://pawletter-api-446222711695.asia-east1.run.app';
const KEY='pawletter.auth.v1';
export function createAdopterAccount(fetcher=fetch,storage=sessionStorage){
 let token=null;
 try{const saved=JSON.parse(storage.getItem(KEY));if(saved?.expiresAt>Date.now())token=saved.token;else storage.removeItem(KEY);}catch{}
 function clear(){token=null;try{storage.removeItem(KEY);}catch{}}
 async function call(path,{body,headers={}}={}){
  const response=await fetcher(BASE+path,{method:body===undefined?'GET':'POST',credentials:'omit',signal:AbortSignal.timeout(70000),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let result;try{result=await response.json();}catch{throw new Error('服务暂时不可用，请稍后重试。');}
  if(!response.ok){if(response.status===401)clear();const error=new Error(({USERNAME_TAKEN:'这个登录账号已被使用，请更换或直接登录。',INVALID_CREDENTIALS:'账号或密码不正确。',SESSION_EXPIRED:'登录已过期，请重新登录。',AUTH_REQUIRED:'请先登录。',PROFILE_NOT_FOUND:'这个账号尚未建立领养者资料。',INVALID_INPUT:'请检查填写内容和必填项。',AI_RATE_LIMITED:'Agent 暂时繁忙，请稍后重试。',SPEECH_PROVIDER_BUSY:'语音服务暂时繁忙，请等 30 秒后重试。',ONBOARDING_LIMIT:'操作较频繁，请稍后再试。',RATE_LIMITED:'操作较频繁，请稍后再试。'})[result.error]||'暂时没有完成，请稍后重试。');error.status=response.status;throw error;}return result;
 }
 function accept(result){token=result.token;try{storage.setItem(KEY,JSON.stringify({token,expiresAt:new Date(result.expiresAt).getTime()}));}catch{}return result.profile;}
 return {
  hasSession:()=>!!token,
  register:async(body,key)=>accept(await call('/v1/auth/register',{body,headers:{'Idempotency-Key':key}})),
  login:async(username,password)=>{const result=await call('/v1/auth/login',{body:{username,password}});accept(result);if(result.user.role!=='adopter'){await call('/v1/auth/logout',{body:{}}).catch(()=>{});clear();throw new Error('请从身份切换进入救助站登录。');}try{return await call('/v1/adopter/profile');}catch(error){await call('/v1/auth/logout',{body:{}}).catch(()=>{});clear();throw error;}},
  profile:()=>call('/v1/adopter/profile'),
  catalog:()=>call('/v1/catalog'),
  facts:id=>call('/v1/catalog/'+encodeURIComponent(id)+'/facts'),
  history:id=>call('/v1/pets/'+encodeURIComponent(id)+'/chat'),
  chat:(id,question)=>call('/v1/pets/'+encodeURIComponent(id)+'/chat',{body:{question}}),
  applications:()=>call('/v1/applications'),
  apply:(id,body,key)=>call('/v1/pets/'+encodeURIComponent(id)+'/applications',{body,headers:{'Idempotency-Key':key}}),
  applicationStage:(id,stage,version)=>call('/v1/applications/'+encodeURIComponent(id)+'/stage',{body:{stage,version}}),
  saveLifestyle:body=>call('/v1/adopter/profile',{body}),
  preferences:proactive=>call('/v1/adopter/preferences',{body:{proactive}}),
  logout:async()=>{await call('/v1/auth/logout',{body:{}});clear();},
  clear,
  interview:(key,text)=>call('/v1/onboarding/interview',{body:{key,text}}),
  summary:answers=>call('/v1/onboarding/summary',{body:answers})
 };
}
