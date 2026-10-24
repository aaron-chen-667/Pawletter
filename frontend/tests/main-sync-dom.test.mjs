import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const pause=()=>new Promise(r=>setTimeout(r,70));
function setup(url){
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url,pretendToBeVisual:true}),w=dom.window;
 w.scrollTo=()=>{};
 for(const [key,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,history:w.history,FormData:w.FormData,localStorage:w.localStorage,sessionStorage:w.sessionStorage,requestAnimationFrame:w.requestAnimationFrame.bind(w)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 return dom;
}
test('adopter refreshes stages and restores cloud conversations for a pet absent from discovery',async()=>{
 const dom=setup('https://pawletter.invalid/'),errors=[],calls=[];
 dom.window.addEventListener('error',e=>{errors.push(e.message);e.preventDefault();});
 let stage=0;
 const profile={id:'qa',nickname:'QA',consent:false},pet={id:'hidden',name:'历史橘子',published:false,stationId:'s',profile:{species:'cat',photoUrl:'./assets/orange.jpg'}};
 const message={from:'pet',text:'见面阶段已更新',at:'2026-10-24T00:00:00.000Z'};
 globalThis.fetch=async(url,options={})=>{
  calls.push(url);let data;
  if(url.endsWith('/adopter/profile'))data=profile;
  else if(url.endsWith('/catalog'))data={pets:[]};
  else if(url.endsWith('/applications'))data={applications:[{id:'a',petId:pet.id,pet,adopterId:'qa',stage,version:stage+1}]};
  else if(url.endsWith('/conversations'))data={conversations:[{pet,lastMessage:message,readAt:null,unread:1,canChat:false}]};
  else if(url.endsWith('/chat/read')){assert.equal(JSON.parse(options.body).through,message.at);data={readAt:message.at};}
  else if(url.endsWith('/chat'))data={messages:[message]};
  else throw Error('Unexpected request '+url);
  return Response.json(data);
 };
 sessionStorage.setItem('pawletter.auth.v1',JSON.stringify({token:'mock-session',expiresAt:Date.now()+3600000}));
 try{
  await import('../dist/app.js?main-sync');await pause();
  assert.equal(document.querySelector('[data-action=profile][data-value=hidden]'),null);
  stage=1;document.querySelector('[data-action=nav][data-value=mine]').click();await pause();
  document.querySelector('[data-action=progress]').click();await pause();
  assert.match(document.querySelector('.application-card').textContent,/历史橘子/);
  assert.match(document.querySelector('.application-card').textContent,/已进入见面阶段/);
  stage=2;window.dispatchEvent(new window.Event('focus'));await pause();
  assert.match(document.querySelector('.application-card').textContent,/等待双方完成交接/);
  stage=3;window.dispatchEvent(new window.Event('focus'));await pause();
  document.querySelector('[data-action=followup]').click();await pause();
  assert.match(document.querySelector('main').textContent,/在线回访提交尚未开放/);
  assert.equal(document.querySelector('[data-action=start-checkin]'),null);
  document.querySelector('[data-action=back]').click();await pause();
  document.querySelector('[data-action=back]').click();await pause();
  document.querySelector('[data-action=nav][data-value=messages]').click();await pause();
  assert.match(document.querySelector('.message-item').textContent,/历史橘子/);
  assert.match(document.querySelector('.message-item').textContent,/见面阶段已更新/);
  document.querySelector('.message-item').click();await pause();
  assert.match(document.querySelector('.chat-stream').textContent,/见面阶段已更新/);
  assert.equal(document.querySelector('.send-button').disabled,true);
  assert.ok(calls.some(u=>u.endsWith('/chat/read')));
  assert.ok(calls.filter(u=>u.endsWith('/applications')).length>=3);
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('station tabs refresh applications submitted after login',async()=>{
 const dom=setup('https://pawletter.invalid/?mode=online&role=station');let rows=[],reads=0;
 globalThis.fetch=async url=>{
  if(url.endsWith('/login'))return Response.json({token:'mock',user:{id:'staff',role:'station',stationId:'s'}});
  if(url.endsWith('/stations'))return Response.json({stations:[{id:'s',name:'本站'}]});
  if(url.endsWith('/pets'))return Response.json({pets:[{id:'p',name:'伙伴',stationId:'s',published:true,profile:{species:'cat'}}]});
  if(url.endsWith('/applications')){reads++;return Response.json({applications:rows});}
  if(url.endsWith('/followups'))return Response.json({followups:[]});
  throw Error('Unexpected request '+url);
 };
 try{
  await import('../dist/online.js?main-sync');
  document.querySelector('[name=username]').value='mock';document.querySelector('[name=password]').value='mock-password';
  document.querySelector('#login-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await pause();
  rows=[{id:'new-app',petId:'p',stationId:'s',name:'新申请人',stage:0,version:1,note:'新提交申请',snapshot:{verification:'pending'}}];
  document.querySelector('[data-live=applications]').click();await pause();
  assert.ok(document.querySelector('[data-live=application][data-id=new-app]'));assert.ok(reads>=2);
 }finally{dom.window.close();}
});
