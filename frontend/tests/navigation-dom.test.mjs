import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {freshState,STORAGE_KEY} from '../dist/domain.js';
test('public entry defaults to adopter; header identity routes stations to login without duplicate banners',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/',pretendToBeVisual:true});
 const {window}=dom;window.scrollTo=()=>{};
 for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const oldState=freshState();oldState.role='rescue';localStorage.setItem(STORAGE_KEY,JSON.stringify(oldState));
 try{
  await import('../dist/app.js');
  assert.ok(document.querySelector('.discovery-app'));
  const locationButton=document.querySelector('.header-location');assert.match(locationButton.textContent,/附近 20 km/);assert.doesNotMatch(locationButton.textContent,/设置/);
  locationButton.click();assert.match(document.querySelector('#modal-title').textContent,/在哪里遇见/);document.querySelector('[data-action=close-modal]').click();
  document.querySelector('[data-action=nav][data-value=messages]').click();assert.equal(document.querySelector('header [data-action=demo]'),null);assert.equal(document.querySelector('header [data-action=identity]'),null);
  document.querySelector('[data-action=nav][data-value=mine]').click();assert.equal(document.querySelector('.online-entry'),null);assert.equal(document.querySelector('[data-action=role][data-value=rescue]'),null);
  document.querySelector('header [data-action=identity]').click();
  const stationLink=document.querySelector('.identity-options a');assert.equal(stationLink.getAttribute('href'),'?mode=online&role=station');assert.match(stationLink.textContent,/救助站/);
  document.querySelector('[data-action=identity-adopter]').click();assert.equal(document.querySelector('.modal-sheet'),null);
 }finally{window.close();}
});
