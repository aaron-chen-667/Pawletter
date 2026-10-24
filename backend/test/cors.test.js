import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';

const official='https://pawletter-adoption-h5.chenaaron668.chatgpt.site';
const preview='https://pawletter-preview.g1251020624.chatgpt.site';
const origin=` ${official}/, ${preview}:443/,${preview} `;

test('both preview origins pass CORS and anonymous origin checks without database or AI work',async t=>{
 let databaseCalls=0,aiCalls=0;
 const db={query:async()=>{databaseCalls++;throw new Error('Unexpected database work');},connect:async()=>{databaseCalls++;throw new Error('Unexpected database work');}};
 const ai={summarizeLifestyle:async()=>{aiCalls++;throw new Error('Unexpected AI work');}};
 const app=await createApp({db,ai,storage:{},origin});t.after(()=>app.close());
 for(const allowed of [official,preview]){
  const preflight=await app.inject({method:'OPTIONS',url:'/v1/pets',headers:{origin:allowed,'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
  assert.equal(preflight.statusCode,204,preflight.body);
  assert.equal(preflight.headers['access-control-allow-origin'],allowed);
  assert.match(preflight.headers['access-control-allow-headers'],/Authorization/i);
  const health=await app.inject({url:'/health',headers:{origin:allowed}});
  assert.equal(health.statusCode,200);assert.equal(health.headers['access-control-allow-origin'],allowed);
  for(const url of ['/v1/auth/register','/v1/onboarding/summary']){
   const invalid=await app.inject({method:'POST',url,headers:{origin:allowed},payload:{}});
   assert.equal(invalid.statusCode,400,allowed+' '+url+' '+invalid.body);
   assert.equal(invalid.json().error,'INVALID_INPUT');
   assert.equal(invalid.headers['access-control-allow-origin'],allowed);
  }
 }
 for(const disallowed of ['https://untrusted.example',undefined]){
  const headers=disallowed?{origin:disallowed}:{};
  if(disallowed){
   const preflight=await app.inject({method:'OPTIONS',url:'/v1/pets',headers:{...headers,'access-control-request-method':'GET'}});
   assert.equal(preflight.headers['access-control-allow-origin'],undefined);
  }
  for(const url of ['/v1/auth/register','/v1/onboarding/summary']){
   const blocked=await app.inject({method:'POST',url,headers,payload:{}});
   assert.equal(blocked.statusCode,403,url+' '+blocked.body);
   assert.equal(blocked.json().error,'ORIGIN_REQUIRED');
   assert.equal(blocked.headers['access-control-allow-origin'],undefined);
  }
 }
 assert.equal(databaseCalls,0);assert.equal(aiCalls,0);
});

test('invalid configured origins fail before an API instance accepts requests',async()=>{
 for(const invalid of ['', '*', 'not-a-url', 'javascript:alert(1)', 'ftp://example.com', `${official}/path`, `${official}?query=1`, `${official}#fragment`, 'https://user:password@example.com', `${official},`]){
  await assert.rejects(()=>createApp({db:{},ai:{},storage:{},origin:invalid}),undefined,invalid||'empty origin');
 }
});
