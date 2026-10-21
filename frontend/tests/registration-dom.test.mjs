import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {freshState,STORAGE_KEY} from '../dist/domain.js';

test('registration experience completes covenant and lifestyle without replacing existing records',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/?flow=register',pretendToBeVisual:true});
 const {window}=dom;window.scrollTo=()=>{};
 for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,FormData:window.FormData,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const original=freshState();original.account={id:'existing-adopter',nickname:'原来的用户'};
 const saved=JSON.stringify(original);localStorage.setItem(STORAGE_KEY,saved);
 const submit=form=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 try{
  await import('../dist/app.js');
  const form=document.querySelector('#register-form');assert.ok(form);
  form.elements.nickname.value='体验新用户';form.elements.covenant.checked=true;form.elements.privacy.checked=true;
  submit(form);
  assert.ok(document.querySelector('#lifestyle-answer-form'));
  assert.equal(JSON.parse(sessionStorage.getItem('pawletter.registration.v1')).account,null);
  for(let i=0;i<4;i++){
   document.querySelector('[data-action=lifestyle-sample]').click();
   submit(document.querySelector('#lifestyle-answer-form'));
  }
  assert.equal(document.querySelectorAll('.lifestyle-answer').length,4);
  document.querySelector('[data-action=lifestyle-confirm]').click();
  const registered=JSON.parse(sessionStorage.getItem('pawletter.registration.v1'));
  assert.equal(registered.account.nickname,'体验新用户');
  assert.equal(Object.keys(registered.account.lifestyle.answers).length,4);
  assert.equal(registered.registrationDraft,undefined);
  assert.equal(localStorage.getItem(STORAGE_KEY),saved);
  assert.ok(document.querySelector('.discovery-app'));
  document.querySelector('[data-action=nav][data-value=mine]').click();
  assert.match(document.querySelector('#app').textContent,/体验新用户/);
  document.querySelector('[data-action=logout]').click();
  assert.ok(document.querySelector('[data-action=confirm-logout]'));
  document.querySelector('[data-action=close-modal]').click();assert.ok(document.querySelector('[data-action=logout]'));
  document.querySelector('[data-action=logout]').click();document.querySelector('[data-action=confirm-logout]').click();
  await new Promise(resolve=>setImmediate(resolve));
  const guest=JSON.parse(sessionStorage.getItem('pawletter.registration.v1'));
  assert.equal(guest.account,null);assert.equal(guest.signedOut,true);assert.equal(guest.defaultExamplesRevision,1);
  assert.equal(JSON.parse(sessionStorage.getItem('pawletter.registration.v1.signed-out')).account.nickname,'体验新用户');
  assert.equal(localStorage.getItem(STORAGE_KEY),saved);
  document.querySelector('[data-action=nav][data-value=mine]').click();
  assert.equal(document.querySelector('[data-action=logout]'),null);assert.ok(document.querySelector('[data-action=register]'));
 }finally{window.close();}
});
