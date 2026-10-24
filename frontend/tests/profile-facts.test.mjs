import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupProfileFacts,profileFactsView} from '../dist/profile-facts.js';
import {JSDOM} from 'jsdom';
import {catalogFixture} from './cloud-fixture.mjs';

const notes=[
 {topic:'health',certainty:'observation',quote:'已绝育；疫苗日期待核对。'},
 {topic:'other',certainty:'pending',quote:'对未来领养家庭的照护要求（不是宠物已经具备的能力或已经发生的行为）：每天安排散步。'},
 {topic:'likes',certainty:'ongoing',quote:'喜欢玩球。'}
];
test('facts retain uncertainty and distinguish household requirements from animal traits',()=>{
 const g=groupProfileFacts(notes);assert.equal(g.health.length,1);assert.equal(g.pending.length,1);assert.equal(g.needs.length,1);assert.equal(g.daily.length,1);
 const pet={cloud:true,character:'活泼'};
 assert.match(profileFactsView(pet,{status:'error'}),/role="alert"/);
 assert.doesNotMatch(profileFactsView(pet,{status:'error'}),/暂未公开健康/);
 assert.match(profileFactsView(pet,{status:'ready',notes:[]}),/暂未公开健康/);
 assert.doesNotMatch(profileFactsView(pet,{status:'ready',notes:[{topic:'health',quote:'<img src=x onerror=alert(1)>'}]}),/<img/);
});
test('profile fetches archives, retries failures and reloads after returning',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/?pet=orange',pretendToBeVisual:true});
 const {window}=dom;window.scrollTo=()=>{};
 for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const originalFetch=globalThis.fetch;let fail=true,calls=0,currentNotes=notes;
 globalThis.fetch=async url=>{if(String(url).endsWith('/facts')){calls++;if(fail)throw new Error('offline');return {ok:true,json:async()=>({notes:currentNotes})};}return {ok:true,json:async()=>({pets:catalogFixture})};};
 const tick=()=>new Promise(r=>setTimeout(r,30));
 try{
  await import('../dist/app.js');await tick();
  assert.match(document.querySelector('.facts-card').textContent,/未加载成功/);
  fail=false;document.querySelector('[data-action=facts-retry]').click();await tick();
  assert.match(document.querySelector('.facts-card').textContent,/已绝育；疫苗日期待核对/);
  assert.match(document.querySelector('.facts-card').textContent,/每天安排散步/);
  document.querySelector('.station-note').click();currentNotes=[];
  document.querySelector('[data-action=back]').click();await tick();
  assert.equal(calls,3);assert.doesNotMatch(document.querySelector('.facts-card').textContent,/已绝育/);
  assert.match(document.querySelector('.facts-card').textContent,/暂未公开健康/);
 }finally{globalThis.fetch=originalFetch;window.close();}
});
