import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('online UI logs in with server role, records to correct pet, preserves correction text, chats and logs out',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online'});
 for(const [name,value] of Object.entries({window:dom.window,document:dom.window.document,location:dom.window.location,navigator:dom.window.navigator,FormData:dom.window.FormData,confirm:()=>true}))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 const originalFetch=globalThis.fetch,calls=[];let role='station',failChat=false,rows=[];
 const p={id:'pet-1',name:'吐司',stationId:'station-1',profile:{species:'cat',description:'喜欢安静'}};
 globalThis.fetch=async(url,options)=>{
   const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,headers:options.headers});
   let data={};let status=200;
   if(path.endsWith('/login'))data={token:'memory-only-token',user:{id:'user',role,stationId:role==='station'?'station-1':null},expiresAt:'2099-01-01'};
   else if(path==='/v1/applications')data={applications:[]};else if(path==='/v1/pets')data={pets:[p]};
   else if(path.endsWith('/knowledge'))data={notes:rows.length?[{id:'note',quote:'今天不愿被抱。',topic:'likes',certainty:'observation',station:'本站',recorded_at:'2026-10-21'}]:[]};
   else if(path.endsWith('/observations')&&options.method==='POST'){rows=[{id:'obs',original_text:body.text,share_with_agent:body.shareWithAgent,status:'archived',created_at:'2026-10-21'}];data={id:'obs'};}
   else if(path.endsWith('/observations'))data={observations:rows};
   else if(path.endsWith('/chat')){if(failChat){status=502;data={error:'AI_UNAVAILABLE'};}else data={answer:'资料里说，今天不愿被抱。',citations:[{quote:'今天不愿被抱。',station:'本站',recorded_at:'2026-10-21'}]};}
   return new Response(JSON.stringify(data),{status});
 };
 const q=s=>document.querySelector(s),click=s=>q(s).click();
 const fill=(s,text)=>{q(s).value=text;q(s).dispatchEvent(new window.Event('input',{bubbles:true}));};
 const submit=s=>q(s).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 async function waitFor(test){for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI condition timed out');}
 try{
  await import('../dist/online.js');
  fill('[name=username]','staff');fill('[name=password]','not-a-real-password');submit('#login-form');
  await waitFor(()=>q('[data-live=voice]')&&!q('[data-live=voice]').disabled);
  assert.match(q('#app').textContent,/救助站工作台/);
  click('[data-live=voice]');await waitFor(()=>q('#observation-text'));
  fill('#observation-text','今天不愿被抱。');q('#share-agent').checked=false;q('#share-agent').dispatchEvent(new window.Event('change',{bubbles:true}));
  click('[data-live=submit-text]');await waitFor(()=>q('[data-live=correct]')&&!q('[data-live=correct]').disabled);
  const observation=calls.find(c=>c.path.endsWith('/observations')&&c.body);assert.equal(observation.body.text,'今天不愿被抱。');assert.equal(observation.body.shareWithAgent,false);assert.ok(observation.headers['Idempotency-Key']);
  click('[data-live=correct]');await waitFor(()=>q('#observation-text')?.value==='今天不愿被抱。');assert.equal(q('#share-agent').checked,false);
  click('[data-live=home]');await waitFor(()=>q('[data-live=pets]'));assert.equal(q('[data-live=pet]'),null);click('[data-live=pets]');await waitFor(()=>q('[data-live=pet]'));click('[data-live=pet]');await waitFor(()=>q('[data-live=chat]'));
  click('[data-live=chat]');fill('#chat-question','它喜欢被抱吗？');failChat=true;submit('#chat-form');
  await waitFor(()=>q('#live-error').textContent.includes('暂时'));assert.equal(q('#chat-question').value,'它喜欢被抱吗？');assert.equal(document.querySelectorAll('.chat-bubble').length,0);
  failChat=false;submit('#chat-form');await waitFor(()=>document.querySelectorAll('.chat-bubble').length===2);assert.equal(q('#chat-question').value,'');assert.match(document.querySelectorAll('.chat-bubble')[1].textContent,/今天不愿被抱/);assert.equal(q('.citation'),null);
  click('[data-live=logout]');await waitFor(()=>q('#login-form'));assert.equal(window.localStorage.length,0);assert.doesNotMatch(q('#app').textContent,/今天不愿被抱/);
  role='adopter';fill('[name=username]','adopter');fill('[name=password]','not-a-real-password');submit('#login-form');await waitFor(()=>q('[data-live=pet]'));
  assert.equal(q('[data-live=new]'),null);assert.equal(q('[data-live=voice]'),null);click('[data-live=pet]');await waitFor(()=>q('[data-live=chat]'));assert.equal(q('[data-live=correct]'),null);
 }finally{globalThis.fetch=originalFetch;dom.window.close();}
});
