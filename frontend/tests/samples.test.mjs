import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {freshState,extractMemory,recommendations,mergeMemory} from '../dist/domain.js';
import {initializeDiscovery} from '../dist/discovery.js';
import {initializeCommunity,publicProfile} from '../dist/community.js';
import {enrichCatalog,createStory,storyCards} from '../dist/samples.js';
function base(){const s=freshState();initializeDiscovery(s);initializeCommunity(s);return s;}
test('catalog enrichment is idempotent and preserves edits, progress, consent and identity',()=>{
 const s=base();s.pets[0].name='我修改的名字';s.pets[0].status='adopted';s.pets[0].weight='用户确认的体重';s.pets.push({...s.pets[0],id:'custom'});
 s.account={id:'mine'};s.consent=false;s.followups.push({id:'my-record',publication:{allowed:false}});
 enrichCatalog(s);enrichCatalog(s);
 assert.equal(s.pets.length,18);assert.equal(new Set(s.pets.map(p=>p.id)).size,18);
 assert.equal(s.pets[0].name,'我修改的名字');assert.equal(s.pets[0].status,'adopted');assert.equal(s.pets[0].weight,'用户确认的体重');
 assert.equal(s.account.id,'mine');assert.equal(s.consent,false);assert.equal(s.followups[0].id,'my-record');
 for(const p of s.pets){assert.ok(p.station);assert.ok(existsSync(new URL('../dist/'+p.image.replace('./',''),import.meta.url)));if(p.gallery)for(const photo of p.gallery)assert.ok(existsSync(new URL('../dist/'+photo.replace('./',''),import.meta.url)));}
});
test('every story has consistent linked applications, dates, ratings, privacy and animal status',()=>{
 const now=Date.UTC(2026,9,20,12);
 for(const card of storyCards){
  const s=createStory(card.id,now);assert.equal(s.pets.length,card.id==='station-day'?19:17);assert.equal(s.sampleStory,card.id);
  for(const a of s.applications){assert.ok(s.pets.some(p=>p.id===a.petId));assert.ok(a.adopterId===s.account.id||s.demoAdopters?.some(u=>u.id===a.adopterId));assert.ok(a.createdAt<=now);if(a.stage===3)assert.equal(s.pets.find(p=>p.id===a.petId).status,'adopted');}
  for(const f of s.followups){assert.ok(f.adopterId===s.account.id||s.demoAdopters?.some(u=>u.id===f.adopterId));assert.ok(f.day<=s.day);assert.ok(f.at<=now);assert.ok(!f.repliedAt||f.repliedAt<=now);assert.ok(f.sample);}
  for(const r of s.ratings){assert.ok(s.applications.some(a=>a.id===r.applicationId&&a.stage===3));assert.ok(r.score>=0&&r.score<=5);assert.ok(r.day<=s.day);}
  assert.equal(publicProfile(s).moments.length,s.followups.filter(f=>f.adopterId===s.account.id&&f.publication.allowed).length);
 }
 assert.equal(createStory('first-cat',now).account.nickname,'阿宁');
 assert.equal(createStory('first-week',now).followups.filter(f=>f.attention&&!f.resolved).length,1);
 assert.equal(createStory('dog-life',now).ratings.length,2);
 assert.throws(()=>createStory('invalid'));
});
test('station story contains actionable queue and correct household profile ownership',()=>{
 const s=createStory('station-day');
 assert.equal(s.role,'rescue');assert.equal(s.applications.filter(a=>a.stage<3).length,4);
 assert.equal(s.followups.filter(f=>f.attention&&!f.resolved).length,2);
 assert.equal(s.pets.filter(p=>!p.confirmed).length,1);
 const cat=s.demoAdopters.find(a=>a.nickname==='小禾');
 assert.equal(publicProfile(s,cat.id).nickname,'小禾');
 assert.equal(publicProfile(s,cat.id).moments.length,1);
 assert.equal(publicProfile(s).nickname,'阿远');
 const nannan=publicProfile(s,'station-demo-toast');
 assert.equal(nannan.applications[0].petName,'吐司');assert.equal(nannan.adoptions[0].petName,'糯米');
 assert.equal(nannan.ratings.length,2);assert.equal(nannan.ratings[0].stationId,'garden');
 const saved=JSON.stringify(s);enrichCatalog(s);const enriched=JSON.stringify(s);enrichCatalog(s);assert.equal(JSON.stringify(s),enriched);
 assert.equal(s.pets.filter(p=>p.id==='nannan-mochi').length,1);
});
test('new coats participate in explicit preference matching without misreading tabby-white as tabby',()=>{
 const s=enrichCatalog(base());mergeMemory(s,extractMemory('我喜欢黑白，最好亲人一点'));assert.equal(recommendations(s)[0].pet.id,'tangyuan');
 const memories=extractMemory('我喜欢狸花白');
 assert.ok(memories.some(m=>m.text==='喜欢狸花白'));assert.ok(!memories.some(m=>m.text==='喜欢狸花'));
});
