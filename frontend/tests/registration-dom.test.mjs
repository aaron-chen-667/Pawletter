import {catalogFixture} from './cloud-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {freshState,STORAGE_KEY} from '../dist/domain.js';
const analysis={title:'忙里忙外的小能手',summary:'白天工作，晚上安排陪伴。',highlights:['规律作息'],recommendations:[{type:'性格稳定的成年猫',reason:'符合你期待的安静陪伴',basedOn:['expectation']}],unknowns:['居住环境待了解']};
test('guest gate, real registration, private profile, default greeting and server logout form one journey',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/?flow=register&v=9',pretendToBeVisual:true});
 const {window}=dom;window.scrollTo=()=>{};const realFetch=globalThis.fetch;let registered,profile,logout=0;
 const response=data=>({ok:true,status:200,json:async()=>data});
 const fetcher=async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;if(url.endsWith('/catalog'))return response({pets:catalogFixture});if(url.endsWith('/applications'))return response({applications:[]});
  if(url.endsWith('/interview'))return response({understood:!body.text.includes('hhhhh'),value:'unknown',reply:'谢谢你告诉我。'});
  if(url.endsWith('/summary'))return response(analysis);
  if(url.endsWith('/register')){registered=body;profile={id:'account-1',nickname:body.nickname,realName:body.realName,phone:body.phone,verification:'pending',consent:true,lifestyle:{...body.lifestyle,confirmedAt:Date.now()}};return response({token:'session-token',expiresAt:new Date(Date.now()+3600000).toISOString(),profile});}
  if(url.endsWith('/logout')){logout++;return response({ok:true});}
  throw new Error('Unexpected endpoint '+url);
 };
 for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,FormData:window.FormData,fetch:fetcher,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const original=freshState();original.account={id:'legacy',nickname:'旧演示用户'};const saved=JSON.stringify(original);localStorage.setItem(STORAGE_KEY,saved);
 const until=async fn=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert.ok(fn());};
 const submit=form=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 try{
  await import('../dist/app.js');
  await until(()=>document.querySelector('[data-action=follow]'));assert.ok(document.querySelector('.discovery-app'));assert.equal(document.querySelector('#register-form'),null);
  document.querySelector('[data-action=follow]').click();assert.match(document.querySelector('#overlay').textContent,/前往注册/);assert.equal(document.querySelector('#register-form'),null);
  document.querySelector('#overlay [data-action=register]').click();const form=document.querySelector('#register-form');assert.ok(form);assert.equal(form.querySelector('[name=identity]'),null);assert.doesNotMatch(form.textContent,/测试身份|测试环境/);
  for(const [name,value] of Object.entries({nickname:'新领养人',username:'newadopter',password:'private-password-123',realName:'验收用户',phone:'13800000000'}))form.elements[name].value=value;
  form.elements.covenant.checked=true;form.elements.privacy.checked=true;submit(form);
  assert.ok(document.querySelector('#lifestyle-answer-form'));assert.equal(document.querySelector('select'),null);assert.equal(document.querySelector('[data-action=lifestyle-sample]'),null);
  assert.equal(sessionStorage.getItem('pawletter.auth.v1'),null);
  for(const text of ['每天离家八小时','早七晚十一，作息规律','晚上可以陪伴两小时','想认识安静的成年猫']){
   const f=document.querySelector('#lifestyle-answer-form');f.elements.answer.value=text;submit(f);await until(()=>!document.querySelector('#lifestyle-answer')?.disabled);
  }
  await until(()=>document.querySelector('[data-action=lifestyle-confirm]'));
  assert.match(document.querySelector('.persona-hero').textContent,/忙里忙外的小能手/);assert.match(document.querySelector('.persona-recommendation').textContent,/依据/);
  document.querySelector('[data-action=lifestyle-confirm]').click();await until(()=>document.querySelector('.discovery-app'));
  assert.equal(registered.username,'newadopter');assert.equal(registered.lifestyle.analysis.title,analysis.title);assert.equal(registered.identity,undefined);
  assert.equal(localStorage.getItem(STORAGE_KEY),saved);
  const persisted=[...Array(sessionStorage.length)].map((_,i)=>sessionStorage.getItem(sessionStorage.key(i))).join('');assert.doesNotMatch(persisted,/private-password|13800000000|验收用户/);
  document.querySelector('[data-action=nav][data-value=mine]').click();assert.match(document.querySelector('#app').textContent,/新领养人/);assert.match(document.querySelector('#app').textContent,/实名待核验/);
  document.querySelector('[data-action=logout]').click();document.querySelector('[data-action=close-modal]').click();assert.equal(logout,0);
  document.querySelector('[data-action=logout]').click();document.querySelector('[data-action=confirm-logout]').click();await until(()=>sessionStorage.getItem('pawletter.auth.v1')===null);
  assert.equal(logout,1);await until(()=>document.querySelector('.discovery-app'));
  document.querySelector('[data-action=nav][data-value=mine]').click();assert.equal(document.querySelector('[data-action=logout]'),null);assert.doesNotMatch(document.querySelector('#app').textContent,/新领养人/);
 }finally{globalThis.fetch=realFetch;window.close();}
});