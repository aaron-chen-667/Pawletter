import {catalogFixture} from './cloud-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {freshState,STORAGE_KEY} from '../dist/domain.js';
test('saved pets use recall cards; only completed adoptions belonging to this user appear beside their avatar',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/',pretendToBeVisual:true});
 const {window}=dom;window.scrollTo=()=>{};
 for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const state=freshState(),[one,two,three]=state.pets;state.defaultExamplesRevision=1;state.account={id:'me',nickname:'用户'};
 state.following=[one.id,two.id];one.status='adopted';state.passed=[one.id,two.id];
 state.applications=[{petId:one.id,adopterId:'me',stage:3},{petId:two.id,adopterId:'someone-else',stage:3},{petId:three.id,adopterId:'me',stage:2}];
 sessionStorage.setItem('pawletter.user.me',JSON.stringify(state));sessionStorage.setItem('pawletter.auth.v1',JSON.stringify({token:'fixture',expiresAt:Date.now()+60000}));catalogFixture[0].profile.adopted=true;globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/catalog')?{pets:catalogFixture}:url.endsWith('/applications')?{applications:state.applications}:url.endsWith('/chat')?{messages:[]}:{id:'me',nickname:'用户',consent:false}});
 try{
  await import('../dist/app.js');await new Promise(r=>setTimeout(r,30));
  assert.equal(document.querySelector('.discovery-meta'),null);
  assert.match(document.querySelector('.station-origin').textContent,/照顾我的救助站/);
  assert.deepEqual([...document.querySelectorAll('.discovery-tabs button')].map(b=>b.dataset.value),['nearby','swipe','saved']);
  document.querySelector('[data-action=discovery-mode][data-value=swipe]').click();assert.match(document.querySelector('.chance-intro').textContent,/下一位心动/);
  document.querySelector('[data-action=discovery-mode][data-value=saved]').click();
  assert.equal(document.querySelector('#swipe-card'),null);assert.equal(document.querySelector('.swipe-actions'),null);assert.equal(document.querySelectorAll('.saved-pet-card').length,2);
  assert.match(document.querySelector('.saved-pet-card').textContent,/已找到家/);
  document.querySelector('.saved-pet-actions [data-action=profile]').click();document.querySelector('[data-action=back]').click();
  assert.equal(document.querySelectorAll('.saved-pet-card').length,2);
  document.querySelector('[data-action=nav][data-value=mine]').click();
  const avatars=document.querySelectorAll('.family-pet');assert.equal(avatars.length,1);assert.equal(avatars[0].dataset.value,one.id);
  avatars[0].click();assert.ok(document.querySelector('.chat-app'));
  document.querySelector('[data-action=back]').click();
  document.querySelector('[data-action=public-profile]').click();
  const publicPets=document.querySelectorAll('.public-profile-hero .family-pet');
  assert.equal(publicPets.length,1);assert.equal(publicPets[0].dataset.value,one.id);
  assert.equal(document.querySelector('.family-chat').dataset.value,one.id);
  document.querySelector('.family-chat').click();assert.ok(document.querySelector('.chat-app'));
 }finally{window.close();}
});
