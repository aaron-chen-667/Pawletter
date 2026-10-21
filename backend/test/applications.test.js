import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../src/db.js';
import {provision,login} from '../src/auth.js';
import {createApp} from '../src/app.js';
test('applications snapshot shared profile, isolate station access, notify in pet voice and block unverified handover',async()=>{
 const engine=new PGlite(),query=(sql,params)=>sql.includes('CREATE TABLE')?engine.exec(sql):engine.query(sql,params),db={query,connect:async()=>({query,release(){}})};await migrate(db);
 const password='application-test-12345';const users={};for(const [username,role,stationId] of [['station-a','station','a'],['station-b','station','b'],['adopter-a','adopter',null],['adopter-b','adopter',null]]){await provision(db,{username,password,role,stationId,stationName:stationId});users[username]=await login(db,username,password);}
 const owner=users['adopter-a'].user.id;await db.query("INSERT INTO adopter_profiles(user_id,registration_key,nickname,real_name,phone,lifestyle,covenant_version) VALUES($1,$2,'申请人','测试姓名','13800000000',$3,'2026-10-22')",[owner,randomUUID(),JSON.stringify({answers:{work:{text:'朝九晚六',value:'long'}},analysis:{title:'小能手'}})]);
 const headers=name=>({authorization:'Bearer '+users[name].token});const app=await createApp({db,ai:{},storage:{}});
 try{
  const pet=(await app.inject({method:'POST',url:'/v1/pets',headers:headers('station-a'),payload:{name:'慢慢',profile:{species:'cat',character:'慢热'},published:true}})).json();
  const key=randomUUID(),post=()=>app.inject({method:'POST',url:'/v1/pets/'+pet.id+'/applications',headers:{...headers('adopter-a'),'idempotency-key':key},payload:{note:'家人同意，家里已经封窗。想问问平时吃什么。',memories:['第一次养猫'],shareProfile:true}});
  const first=await post();assert.equal(first.statusCode,201,first.body);let application=first.json();assert.equal((await post()).json().id,application.id);assert.equal(application.snapshot.phone,'13800000000');assert.equal(application.snapshot.lifestyle.answers.work.text,'朝九晚六');assert.equal(application.snapshot.verification,'pending');
  assert.equal((await app.inject({url:'/v1/applications',headers:headers('station-b')})).json().applications.length,0);assert.equal((await app.inject({url:'/v1/applications',headers:headers('adopter-b')})).json().applications.length,0);assert.equal((await app.inject({url:'/v1/applications',headers:headers('station-a')})).json().applications.length,1);
  const notification=(await app.inject({url:'/v1/pets/'+pet.id+'/chat',headers:headers('adopter-a')})).json().messages;assert.equal(notification.length,1);assert.match(notification[0].text,/我有一点点/);assert.doesNotMatch(notification[0].text,/已通过|交接完成/);
  const stage=(name,value)=>app.inject({method:'POST',url:'/v1/applications/'+application.id+'/stage',headers:headers(name),payload:{stage:value,version:application.version}});
  assert.equal((await stage('adopter-a',1)).statusCode,403);application=(await stage('station-a',1)).json();application=(await stage('station-a',2)).json();const blocked=await stage('station-a',3);assert.equal(blocked.statusCode,409,blocked.body);assert.equal(blocked.json().error,'IDENTITY_PENDING');
  await db.query("UPDATE adopter_profiles SET verification='verified' WHERE user_id=$1",[owner]);application=(await stage('station-a',3)).json();assert.equal(application.stage,3);assert.equal((await db.query('SELECT profile FROM pets WHERE id=$1',[pet.id])).rows[0].profile.adopted,true);
 }finally{await app.close();await engine.close();}
});
