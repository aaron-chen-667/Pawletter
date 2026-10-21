// Browser integration module. No secrets and no automatic upload of local demo state.
export function createPawletterClient(baseUrl, fetcher=fetch) {
  const base=baseUrl.replace(/\/$/,'');let token=null;
  async function call(path,{method='GET',body,headers={},signal}={}) {
    const binary=typeof Blob!=='undefined'&&body instanceof Blob;
    const response=await fetcher(`${base}${path}`,{method,signal:signal||AbortSignal.timeout(190000),credentials:'omit',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined&&!binary?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
    let data;try{data=await response.json();}catch{throw new Error('INVALID_RESPONSE');}
    if(!response.ok){const error=new Error(data.error||'REQUEST_FAILED');error.status=response.status;throw error;}return data;
  }
  return {
    async login(username,password){const result=await call('/v1/auth/login',{method:'POST',body:{username,password}});token=result.token;return {user:result.user,expiresAt:result.expiresAt};},
    async logout(){try{await call('/v1/auth/logout',{method:'POST'});}finally{token=null;}},
    me:()=>call('/v1/me'),
    pets:()=>call('/v1/pets'),
    createPet:body=>call('/v1/pets',{method:'POST',body}),
    updatePet:(id,body)=>call(`/v1/pets/${encodeURIComponent(id)}/profile`,{method:'POST',body}),
    agent:id=>call(`/v1/pets/${encodeURIComponent(id)}/agent`),
    updateAgent:(id,body)=>call(`/v1/pets/${encodeURIComponent(id)}/agent`,{method:'POST',body}),
    applications:()=>call('/v1/applications'),
    applicationStage:(id,stage,version)=>call(`/v1/applications/${encodeURIComponent(id)}/stage`,{method:'POST',body:{stage,version}}),
    async uploadAudio(petId,blob){return call(`/v1/pets/${encodeURIComponent(petId)}/audio`,{method:'POST',body:blob,headers:{'Content-Type':blob.type.split(';')[0]}});},
    submitObservation:(petId,body,idempotencyKey)=>call(`/v1/pets/${encodeURIComponent(petId)}/observations`,{method:'POST',body,headers:{'Idempotency-Key':idempotencyKey}}),
    processObservation:id=>call(`/v1/observations/${encodeURIComponent(id)}/process`,{method:'POST'}),
    observations:petId=>call(`/v1/pets/${encodeURIComponent(petId)}/observations`),
    withdrawObservation:id=>call(`/v1/observations/${encodeURIComponent(id)}`,{method:'DELETE'}),
    retryObservation:id=>call(`/v1/observations/${encodeURIComponent(id)}/retry`,{method:'POST'}),
    knowledge:petId=>call(`/v1/pets/${encodeURIComponent(petId)}/knowledge`),
    chat:(petId,question)=>call(`/v1/pets/${encodeURIComponent(petId)}/chat`,{method:'POST',body:{question}})
  };
}
