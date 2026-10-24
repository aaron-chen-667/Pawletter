import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

function localDraftDatabase(){
 const values=new Map();let created=false;
 return {values,open(){
  const request={};
  queueMicrotask(()=>{
   request.result={createObjectStore(){},close(){},transaction(){
    const tx={};
    function operation(run){const result={};queueMicrotask(()=>{result.result=run();result.onsuccess?.();tx.oncomplete?.();});return result;}
    tx.objectStore=()=>({get:key=>operation(()=>structuredClone(values.get(key))),put:(value,key)=>operation(()=>values.set(key,structuredClone(value))),delete:key=>operation(()=>values.delete(key))});
    return tx;
   }};
   if(!created){created=true;request.onupgradeneeded?.();}request.onsuccess?.();
  });
  return request;
 }};
}

test('intake completion blocks logout until its delayed list response opens the saved profile, then isolates the next account',async t=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online&role=station'}),w=dom.window;
 const previous=new Map(),database=localDraftDatabase(),calls=[];
 const petA={id:'private-a-pet',name:'A站新伙伴',stationId:'station-a',published:false,profile:{species:'unknown',description:'A站尚未公开的救助观察，左耳有缺口。',photoUrl:''}};
 const petB={id:'private-b-pet',name:'B站小白',stationId:'station-b',published:false,profile:{species:'dog',description:'B站自己的白色小狗。',photoUrl:''}};
 let committed=false,resolveList;
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined,authorization=options.headers?.Authorization;
  calls.push({path,body,authorization});
  if(path==='/v1/auth/login')return Response.json({token:body.username,user:{id:body.username,role:'station',stationId:'station-'+body.username}});
  if(path==='/v1/auth/logout')return Response.json({ok:true});
  if(path==='/v1/pets'){
   if(authorization==='Bearer a'&&committed)return new Promise(resolve=>{resolveList=resolve;});
   return Response.json({pets:authorization==='Bearer b'?[petB]:[]});
  }
  if(path==='/v1/stations')return Response.json({stations:[{id:authorization==='Bearer b'?'station-b':'station-a',name:'测试救助站'}]});
  if(path==='/v1/applications')return Response.json({applications:[]});
  if(path==='/v1/followups')return Response.json({followups:[]});
  if(path==='/v1/intake/analyze')return Response.json({name:petA.name,species:'unknown',description:petA.profile.description,character:'',age:'',sex:'unknown',ocrText:'',nextQuestion:'',uncertainties:[],corrections:[]});
  if(path==='/v1/intake/commit'){committed=true;return Response.json({id:petA.id});}
  if(path.startsWith(`/v1/pets/${petA.id}/`)){
   if(authorization!=='Bearer a')return Response.json({error:'PET_NOT_FOUND'},{status:404});
   if(path.endsWith('/knowledge'))return Response.json({notes:[]});
   if(path.endsWith('/observations'))return Response.json({observations:[]});
   if(path.endsWith('/intake'))return Response.json({visuals:[]});
  }
  throw Error('Unexpected request: '+path);
 };
 for(const [key,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData,confirm:()=>true,indexedDB:database,fetch:fetcher,localStorage:{getItem:key=>key==='pawletter.intake.input-mode'?'text':null,setItem(){}}})){
  previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 t.after(()=>{dom.window.close();for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const q=selector=>w.document.querySelector(selector);
 const click=selector=>{assert.ok(q(selector),`Missing ${selector}`);q(selector).click();};
 const set=(selector,value)=>{assert.ok(q(selector),`Missing ${selector}`);q(selector).value=value;q(selector).dispatchEvent(new w.Event('input',{bubbles:true}));};
 const submit=selector=>q(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const until=async(predicate,message='Expected interface state was not reached')=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),message);};
 const login=async username=>{set('[name=username]',username);set('[name=password]','not-a-real-password');submit('#login-form');await until(()=>q('[data-live=new]')&&!q('[data-live=new]').disabled);};

 await import('../dist/online.js');
 await login('a');click('[data-live=new]');await until(()=>q('#intake-answer'));
 set('#intake-answer','本站新接收的一只动物，左耳有缺口。');
 assert.equal(calls.filter(c=>c.path==='/v1/intake/analyze').length,0);
 click('[data-intake=send]');await until(()=>q('#intake-confirm')&&!q('#intake-confirm button').disabled);
 assert.equal(calls.filter(c=>c.path==='/v1/intake/commit').length,0,'Sending a message only organises the record');
 submit('#intake-confirm');await until(()=>resolveList);
 const saved=calls.find(c=>c.path==='/v1/intake/commit');
 assert.deepEqual(saved.body.photos,[]);assert.equal(saved.body.profile.species,'unknown');assert.equal(saved.body.published,false);
 assert.equal(saved.body.text,'本站新接收的一只动物，左耳有缺口。');assert.equal(saved.body.profile.description,petA.profile.description);
 click('[data-live=logout]');click('[data-live=home]');await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(calls.filter(c=>c.path==='/v1/auth/logout').length,0,'Logout must wait for completion navigation');
 assert.equal(q('#login-form'),null);assert.ok(q('#intake-confirm'));assert.equal(q('#intake-confirm button').disabled,true);

 resolveList(Response.json({pets:[petA]}));
 await until(()=>q('.topbar-title')?.textContent.includes(petA.name)&&q('[data-live=logout]')&&!q('[data-live=logout]').disabled);
 await until(()=>database.values.size===0,'The completed draft must be removed');
 assert.ok(q('#app').textContent.includes(petA.profile.description));assert.equal(q('#live-error').textContent,'');
 assert.equal(calls.filter(c=>c.path==='/v1/intake/commit').length,1);
 click('[data-live=logout]');await until(()=>q('#login-form'));
 assert.equal(calls.filter(c=>c.path==='/v1/auth/logout').length,1);
 await login('b');click('[data-live=pets]');await until(()=>q(`[data-live=pet][data-id="${petB.id}"]`));
 assert.doesNotMatch(q('#app').textContent,/A站新伙伴|A站尚未公开/);assert.ok(q('#app').textContent.includes(petB.name));
 click('[data-live=new]');await until(()=>q('#intake-answer'));
 assert.equal(q('#intake-answer').value,'');assert.equal(q('#intake-confirm'),null,'A new conversation has nothing to archive');assert.doesNotMatch(q('#app').textContent,/A站新伙伴|A站尚未公开/);
 assert.equal(calls.filter(c=>c.authorization==='Bearer b'&&c.path.includes(petA.id)).length,0);
});
