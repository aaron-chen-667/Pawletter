import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createStationExamples,STATION_EXAMPLES_KEY} from '../dist/station-examples.js';
import {createPawletterClient} from '../dist/pawletter-api.js';

const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'Expected asynchronous request state was not reached');};

test('example intake reports a real storage quota failure without committing an in-memory-only pet',async t=>{
 const dom=new JSDOM('',{url:'https://pawletter.invalid/',storageQuota:4000});t.after(()=>dom.window.close());
 const storage=dom.window.sessionStorage,api=createStationExamples(storage);api.reset(true);
 const baseline=storage.getItem(STATION_EXAMPLES_KEY),body={simple:true,name:'待命名 配额测试',published:false,profile:{species:'cat',description:'确认后的原文。',age:'',character:'',sex:'unknown'},text:'确认后的原文。',photos:['data:image/jpeg;base64,'+'x'.repeat(6000)],documents:[]};
 await assert.rejects(api.commitIntake(body,'quota-intake-key'),/EXAMPLE_STORAGE_FULL/);
 assert.deepEqual((await api.pets()).pets,[],'Failed persistence must not leave a successful pet in memory');
 assert.equal(storage.getItem(STATION_EXAMPLES_KEY),baseline,'The previous saved example state must remain intact');
 assert.deepEqual((await createStationExamples(storage).pets()).pets,[],'Reload must agree with the current UI after failure');
 const result=await api.commitIntake({...body,photos:[]},'quota-intake-key');
 assert.ok(result.id);assert.equal((await api.pets()).pets.length,1);
 const reopened=createStationExamples(storage),pets=(await reopened.pets()).pets;
 assert.equal(pets.length,1);assert.equal(pets[0].profile.description,body.profile.description);
 assert.equal((await reopened.intake(result.id)).source_text,body.text);
 const retry=await reopened.commitIntake({...body,photos:[]},'quota-intake-key');assert.equal(retry.id,result.id);assert.equal((await reopened.pets()).pets.length,1);
});

test('a private document blob completing after logout and another login is discarded and never cached',async t=>{
 const base='https://pawletter.invalid',documentUrl=base+'/v1/pets/private-a/media/report',calls=[],created=[],revoked=[];
 let finishBlob,documentReads=0;
 const previousCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL'),previousRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:blob=>{created.push(blob);return 'blob:test-private-document-'+created.length;}});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:url=>revoked.push(url)});
 t.after(()=>{Object.defineProperty(URL,'createObjectURL',previousCreate);Object.defineProperty(URL,'revokeObjectURL',previousRevoke);});
 const client=createPawletterClient(base,async(url,options={})=>{
  calls.push({url,authorization:options.headers?.Authorization});
  if(url===base+'/v1/auth/login'){const {username}=JSON.parse(options.body);return Response.json({token:username,user:{id:username,role:'station',stationId:'station-'+username}});}
  if(url===base+'/v1/auth/logout')return Response.json({ok:true});
  if(url===base+'/v1/pets/private-a/intake')return Response.json({visuals:[],documents:[{name:'A站内部材料.pdf',url:documentUrl,mime:'application/pdf'}]});
  if(url===documentUrl){documentReads++;if(documentReads===1)return {ok:true,blob:()=>new Promise(resolve=>{finishBlob=resolve;})};return Response.json({error:'PET_NOT_FOUND'},{status:404});}
  throw Error('Unexpected endpoint '+url);
 });
 await client.login('a','test-password');const pending=client.intake('private-a');await until(()=>finishBlob);
 await client.logout();await client.login('b','test-password');finishBlob(new Blob(['A站私有PDF'],{type:'application/pdf'}));
 const oldResult=await pending;assert.equal(oldResult.documents[0].url,'');assert.equal(created.length,0,'An obsolete response must not create a blob URL');
 const newResult=await client.intake('private-a');assert.equal(newResult.documents[0].url,'');assert.equal(documentReads,2,'The new account must perform its own authorized read, not reuse an old private blob');
 assert.deepEqual(calls.filter(c=>c.url===documentUrl).map(c=>c.authorization),['Bearer a','Bearer b']);assert.deepEqual(revoked,[]);
});
