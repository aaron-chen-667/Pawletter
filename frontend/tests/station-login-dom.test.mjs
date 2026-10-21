import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('station entry rejects adopter account and only opens workspace after station login',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online&role=station'}),w=dom.window;
 for(const [key,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const originalFetch=globalThis.fetch;let role='adopter',loggedOut=0,petReads=0;
 globalThis.fetch=async(url)=>{
  if(url.endsWith('/login'))return Response.json({token:'test-token',user:{id:'u',role,stationId:role==='station'?'s':null}});
  if(url.endsWith('/logout')){loggedOut++;return Response.json({ok:true});}
  if(url.endsWith('/pets')){petReads++;return Response.json({pets:[]});}
  throw Error('Unexpected endpoint');
 };
 const q=s=>document.querySelector(s);
 const login=()=>{q('[name=username]').value='test';q('[name=password]').value='test-password';q('#login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 async function waitFor(fn){for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI timeout');}
 try{
  await import('../dist/online.js');assert.match(q('.topbar-title').textContent,/救助站登录/);
  login();await waitFor(()=>q('#live-error')?.textContent.includes('身份'));
  assert.equal(loggedOut,1);assert.equal(petReads,0);assert.ok(q('#login-form'));
  role='station';login();await waitFor(()=>q('[data-live=new]'));assert.match(q('.topbar-title').textContent,/救助站工作台/);assert.equal(petReads,1);
 }finally{globalThis.fetch=originalFetch;w.close();}
});
