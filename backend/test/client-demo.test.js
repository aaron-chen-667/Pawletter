import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {migrate} from '../src/db.js';
import {seedClientDemo,demoId} from '../scripts/seed-client-demo.js';
import {createApp} from '../src/app.js';

test('client fixtures cover business states, authorize own records, and preserve edits on replay',async t=>{
 const pg=new PGlite(),query=(sql,params)=>sql.includes('CREATE TABLE')?pg.exec(sql):pg.query(sql,params),db={query,connect:async()=>({query,release(){}})};await migrate(db);
 const data=JSON.parse(await readFile(new URL('../fixtures/client-demo.json',import.meta.url),'utf8')),passwords=Object.fromEntries(data.accounts.map(a=>[a.key,'client-fixture-password']));
 const blobs=new Map(),storage={put:async(k,v)=>{assert.ok(!blobs.has(k));blobs.set(k,v);},remove:async k=>blobs.delete(k),read:async k=>blobs.get(k)},media=Object.fromEntries(data.pets.map(p=>[p.asset,Buffer.from('synthetic test bytes').toString('base64')]));
 const initial=await seedClientDemo(db,{passwords,storage,media});assert.equal(initial.counts.pets,12);assert.equal(initial.counts.accounts,9);assert.equal(initial.counts.applications,9);assert.equal(initial.counts.followups,5);assert.equal(initial.counts.media,12);
 const app=await createApp({db,storage,ai:{}});t.after(async()=>{await app.close();await pg.close();});
 const call=(method,url,payload,token)=>app.inject({method,url,...(payload?{payload}:{}),headers:token?{authorization:'Bearer '+token}:{}});
 const tokens={};for(const key of ['station','empty-station','main','new','ning']){const a=data.accounts.find(a=>a.key===key),r=await call('POST','/v1/auth/login',{username:a.username,password:passwords[key]});assert.equal(r.statusCode,200);tokens[key]=r.json().token;}
 const pets=(await call('GET','/v1/pets',null,tokens.station)).json().pets;assert.equal(pets.length,12);
 assert.equal((await call('GET','/v1/pets',null,tokens['empty-station'])).json().pets.length,0);
 const apps=(await call('GET','/v1/applications',null,tokens.station)).json().applications;assert.deepEqual([...new Set(apps.map(a=>a.stage))].sort(),[-1,0,1,2,3]);
 const followups=(await call('GET','/v1/followups',null,tokens.station)).json().followups;assert.deepEqual([...new Set(followups.map(f=>f.status))].sort(),['attention','completed','confirmation','pending']);
 assert.equal((await call('GET','/v1/applications',null,tokens.new)).json().applications.length,0);
 const mainApps=(await call('GET','/v1/applications',null,tokens.main)).json().applications;assert.equal(mainApps.length,2);assert.ok(mainApps.every(a=>a.adopterId===demoId('user:main')));
 const conversations=(await call('GET','/v1/conversations',null,tokens.main)).json().conversations;assert.ok(conversations.some(c=>c.unread>0));assert.ok(conversations.some(c=>c.unread===0));
 const facts=(await call('GET','/v1/catalog/'+demoId('pet:1')+'/facts')).json().notes;assert.ok(facts.some(n=>n.certainty==='pending'));assert.ok(!facts.some(n=>n.quote.includes('本站交班')));assert.ok(!facts.some(n=>n.quote.includes('此前误记')));
 const records=(await call('GET','/v1/pets/'+demoId('pet:1')+'/observations',null,tokens.station)).json().observations;assert.ok(records.some(r=>r.status==='failed'));assert.ok(records.some(r=>r.status==='withdrawn'));assert.ok(records.some(r=>r.replaces_id));
 const sharedKnowledge=await call('GET','/v1/pets/'+demoId('pet:1')+'/knowledge',null,tokens['empty-station']);assert.equal(sharedKnowledge.statusCode,200);assert.ok(!sharedKnowledge.body.includes('本站交班'));
 assert.equal((await call('GET','/v1/pets/'+demoId('pet:1')+'/observations',null,tokens['empty-station'])).statusCode,403);
 await query("UPDATE pets SET name='现场改过名字',published=false WHERE id=$1",[demoId('pet:1')]);
 await query("UPDATE observations SET status='withdrawn' WHERE id=$1",[demoId('note:1:0')]);
 await query('UPDATE adoption_applications SET stage=1,version=2 WHERE id=$1',[demoId('application:review')]);
 const again=await seedClientDemo(db,{passwords:{},storage,media});assert.ok(Object.values(again.counts).every(n=>n===0));assert.equal(blobs.size,12);
 assert.equal((await query('SELECT name FROM pets WHERE id=$1',[demoId('pet:1')])).rows[0].name,'现场改过名字');assert.equal((await query('SELECT stage FROM adoption_applications WHERE id=$1',[demoId('application:review')])).rows[0].stage,1);
 assert.equal((await query('SELECT status FROM observations WHERE id=$1',[demoId('note:1:0')])).rows[0].status,'withdrawn');
});
