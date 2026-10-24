import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/db.js';
import {seedPublicExamples} from '../scripts/seed-public-examples.js';
import {createApp} from '../src/app.js';
test('public examples are persisted archives; replay preserves edits, privacy and withdrawals',async()=>{
 const engine=new PGlite(),query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params),db={query,connect:async()=>({query,release(){}})};
 await migrate(db);let app;
 try{
  assert.equal((await seedPublicExamples(db)).created,17);
  app=await createApp({db,ai:{},storage:{}});
  const catalog=(await app.inject('/v1/catalog')).json().pets;
  assert.equal(catalog.length,17);assert.equal(new Set(catalog.map(p=>p.stationId)).size,3);
  assert.ok(catalog.every(p=>p.stationName.includes('示例')&&p.profile.description.includes('虚构示例')&&p.profile.photoUrl.startsWith('https://')));
  assert.equal((await query('SELECT * FROM pet_agents')).rows.length,17);
  assert.equal((await query("SELECT * FROM knowledge k JOIN observations o ON k.observation_id=o.id WHERE o.share_with_agent=true AND o.status='archived'")).rows.length,51);
  assert.equal((await query('SELECT * FROM users WHERE active=true')).rows.length,0);
  await query("UPDATE pets SET name='人工修改',published=false WHERE id=$1",[catalog[0].id]);
  await query("UPDATE observations SET status='withdrawn' WHERE pet_id=$1",[catalog[0].id]);
  assert.deepEqual(await seedPublicExamples(db),{created:0,skipped:17,total:17});
  assert.equal((await query('SELECT name,published FROM pets WHERE id=$1',[catalog[0].id])).rows[0].name,'人工修改');
  assert.equal((await app.inject('/v1/catalog')).json().pets.length,16);
  assert.equal((await query("SELECT * FROM observations WHERE status='withdrawn'")).rows.length,3);
 }finally{await app?.close();await engine.close();}
});
