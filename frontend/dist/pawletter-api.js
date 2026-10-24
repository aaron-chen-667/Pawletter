// Browser integration module. No secrets and no automatic upload of local demo state.
export function createPawletterClient(baseUrl, fetcher=fetch) {
  const base=baseUrl.replace(/\/$/,'');let token=null,generation=0;const mediaCache=new Map();
  function clearMedia(){generation++;for(const url of mediaCache.values())URL.revokeObjectURL(url);mediaCache.clear();}
  async function visual(url){if(!url?.startsWith(base+'/v1/pets/'))return url;if(mediaCache.has(url))return mediaCache.get(url);const ticket=generation,actorToken=token;const r=await fetcher(url,{headers:actorToken?{Authorization:`Bearer ${actorToken}`}:{}});if(!r.ok||ticket!==generation||actorToken!==token)return '';const blob=await r.blob();if(ticket!==generation||actorToken!==token)return '';const value=URL.createObjectURL(blob);mediaCache.set(url,value);return value;}
  async function call(path,{method='GET',body,headers={},signal}={}) {
    const binary=typeof Blob!=='undefined'&&body instanceof Blob;
    const response=await fetcher(`${base}${path}`,{method,signal:signal||AbortSignal.timeout(190000),credentials:'omit',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined&&!binary?{'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
    let data;try{data=await response.json();}catch{throw new Error('INVALID_RESPONSE');}
    if(!response.ok){const error=new Error(data.error||'REQUEST_FAILED');error.status=response.status;throw error;}return data;
  }
  return {
    async login(username,password){const result=await call('/v1/auth/login',{method:'POST',body:{username,password}});clearMedia();token=result.token;return {user:result.user,expiresAt:result.expiresAt};},
    async logout(){clearMedia();try{await call('/v1/auth/logout',{method:'POST'});}finally{token=null;clearMedia();}},
    me:()=>call('/v1/me'),
    async pets(){const data=await call('/v1/pets');await Promise.all(data.pets.map(async p=>{if(p.profile?.photoUrl)p.profile.photoUrl=await visual(p.profile.photoUrl);}));return data;},
    followups:()=>call('/v1/followups'),
    createFollowup:(body,key)=>call('/v1/followups',{method:'POST',body,headers:{'Idempotency-Key':key}}),
    updateFollowup:(id,body)=>call(`/v1/followups/${encodeURIComponent(id)}`,{method:'POST',body}),
    addVisuals:(id,body,key)=>call(`/v1/pets/${encodeURIComponent(id)}/visuals`,{method:'POST',body,headers:{'Idempotency-Key':key}}),
    draftIntake:body=>call('/v1/intake/analyze',{method:'POST',body}),
    commitIntake:(body,key)=>call('/v1/intake/commit',{method:'POST',body,headers:{'Idempotency-Key':key}}),
    async intake(id){const data=await call(`/v1/pets/${encodeURIComponent(id)}/intake`);await Promise.all([...(data.visuals||[]),...(data.documents||[])].map(async v=>v.url=await visual(v.url)));return data;},
    createPet:body=>call('/v1/pets',{method:'POST',body}),
    updatePet:(id,body)=>call(`/v1/pets/${encodeURIComponent(id)}/profile`,{method:'POST',body}),
    async setVisibility(id,published){const pet=await call(`/v1/pets/${encodeURIComponent(id)}`);const {adopted,...profile}=pet.profile;return call(`/v1/pets/${encodeURIComponent(id)}/profile`,{method:'POST',body:{name:pet.name,profile,published}});},
    agent:id=>call(`/v1/pets/${encodeURIComponent(id)}/agent`),
    updateAgent:(id,body)=>call(`/v1/pets/${encodeURIComponent(id)}/agent`,{method:'POST',body}),
    applications:()=>call('/v1/applications'),
    applicationStage:(id,stage,version)=>call(`/v1/applications/${encodeURIComponent(id)}/stage`,{method:'POST',body:{stage,version}}),
    async uploadAudio(petId,blob){return call(`/v1/pets/${encodeURIComponent(petId)}/audio`,{method:'POST',body:blob,headers:{'Content-Type':blob.type.split(';')[0]}});},
    submitObservation:(petId,body,idempotencyKey)=>call(`/v1/pets/${encodeURIComponent(petId)}/observations`,{method:'POST',body,headers:{'Idempotency-Key':idempotencyKey}}),
    processObservation:id=>call(`/v1/observations/${encodeURIComponent(id)}/process`,{method:'POST'}),
    async observations(petId,filters={}){const data=await call(`/v1/pets/${encodeURIComponent(petId)}/observations?${new URLSearchParams(filters)}`);await Promise.all((data.observations||[]).flatMap(o=>(o.visuals||[]).map(async v=>v.url=await visual(v.url))));return data;},
    withdrawObservation:id=>call(`/v1/observations/${encodeURIComponent(id)}`,{method:'DELETE'}),
    retryObservation:id=>call(`/v1/observations/${encodeURIComponent(id)}/retry`,{method:'POST'}),
    knowledge:petId=>call(`/v1/pets/${encodeURIComponent(petId)}/knowledge`),
    chat:(petId,question)=>call(`/v1/pets/${encodeURIComponent(petId)}/chat`,{method:'POST',body:{question}})
  };
}
