import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

test('cross-station readers filter every workspace list, inspect private details, and only edit their own station',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online&role=station'}),w=dom.window;
 const originalFetch=globalThis.fetch,originalConfirm=globalThis.confirm;
 for(const [key,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData,confirm:()=>true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 let privileged=true;
 const stations=[{id:'own',name:'原有救助站'},{id:'other',name:'另一救助站'},{id:'empty',name:'空白救助站'}];
 const pets=[
  {id:'own-pet',name:'本站伙伴',stationId:'own',published:false,profile:{species:'cat',description:'本站私有档案'}},
  {id:'private-pet',name:'他站私有伙伴',stationId:'other',published:false,profile:{species:'cat',description:'他站私有档案',photoUrl:'https://pawletter-api-446222711695.asia-east1.run.app/v1/pets/private-pet/visual/0'}},
  {id:'public-pet',name:'他站公开伙伴',stationId:'other',published:true,profile:{species:'cat',description:'他站公开档案'}}
 ];
 const snapshot={verification:'verified',realName:'申请人',phone:'00000000000',lifestyle:{analysis:{title:'生活画像',summary:'已确认的资料'},answers:{}}};
 const applications=[
  {id:'own-app',petId:'own-pet',stationId:'own',stage:0},
  {id:'other-app',petId:'private-pet',stationId:'other',stage:0},
  {id:'own-done',petId:'own-pet',stationId:'own',stage:3},
  {id:'other-done',petId:'public-pet',stationId:'other',stage:3},
  {id:'other-unplanned',petId:'private-pet',stationId:'other',stage:3}
 ].map(a=>({...a,name:a.id,adopterId:a.id,version:1,snapshot,note:'申请说明'}));
 const followups=[
  {id:'own-followup',applicationId:'own-done',petId:'own-pet',stationId:'own',status:'pending'},
  {id:'other-followup',applicationId:'other-done',petId:'public-pet',stationId:'other',status:'confirmation'}
 ].map(f=>({...f,name:f.id,dueAt:'2026-10-25T12:00:00Z',updatedAt:'2026-10-24T12:00:00Z',version:1,history:[{at:'2026-10-24T12:00:00Z',status:f.status,text:'已有回访记录'}]}));
 const calls=[],writes=[];
 const permitted=rows=>rows.filter(r=>privileged||r.stationId==='own');
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname,method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;
  calls.push({path,method,body,headers:options.headers});
  if(path==='/v1/auth/login')return Response.json({token:'test-token',user:{id:'reader',role:'station',stationId:'own',canReadAllStations:privileged}});
  if(path==='/v1/auth/logout')return Response.json({ok:true});
  if(path==='/v1/stations')return Response.json({stations:privileged?stations:stations.filter(s=>s.id==='own')});
  if(method==='GET'&&path==='/v1/pets')return Response.json({pets:permitted(pets)});
  if(path==='/v1/applications')return Response.json({applications:permitted(applications)});
  if(path==='/v1/followups'&&method==='GET')return Response.json({followups:permitted(followups)});
  if(method!=='GET'){
   writes.push({path,method,body});
   if(path==='/v1/pets/own-pet/profile'){pets[0].published=body.published;return Response.json({ok:true});}
   if(path==='/v1/pets/public-pet/chat')return Response.json({answer:'公开资料回答',citations:[]});
   if(path==='/v1/pets'){pets.push({id:'new-pet',stationId:'own',...body});return Response.json({id:'new-pet'});}
   throw Error('Unexpected write: '+method+' '+path);
  }
  const id=path.split('/')[3];
  if(path.endsWith('/visual/0'))return new Response(new Blob(['private-image'],{type:'image/jpeg'}));
  if(path.endsWith('/knowledge'))return Response.json({notes:[{id:'note-'+id,observation_id:'record-'+id,quote:'内部知识-'+id,topic:'health',certainty:'observation',station:stations.find(s=>s.id===pets.find(p=>p.id===id)?.stationId)?.name,recorded_at:'2026-10-24T12:00:00Z'}]});
  if(path.endsWith('/observations'))return Response.json({observations:[{id:'record-'+id,pet_id:id,original_text:'私有原始记录-'+id,share_with_agent:false,status:'failed',created_at:'2026-10-24T12:00:00Z'}]});
  if(path.endsWith('/intake'))return Response.json({source_text:'原始口述-'+id,ocr_text:'材料识别-'+id,visuals:id==='private-pet'?[{url:'https://pawletter-api-446222711695.asia-east1.run.app/v1/pets/private-pet/visual/0',mime:'image/jpeg',shared:false,caption:'私有影像'}]:[]});
  if(path.endsWith('/agent'))return Response.json({voice:{tone:'shy',style:'他站分身设定'}});
  const pet=pets.find(p=>path==='/v1/pets/'+p.id);if(pet)return Response.json(pet);
  throw Error('Unexpected read: '+path);
 };
 const q=s=>document.querySelector(s),qa=s=>Array.from(document.querySelectorAll(s));
 const until=async(fn,label='UI condition')=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn(),label+': '+q('#app').textContent);};
 const click=(action,id)=>{const el=q(`[data-live="${action}"]${id?`[data-id="${id}"]`:''}`);assert.ok(el,action);el.click();};
 const submit=el=>el.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const login=async()=>{q('[name=username]').value='reader';q('[name=password]').value='test-password';submit(q('#login-form'));await until(()=>q('.station-nav'));};
 const home=async()=>{click('home');await until(()=>q('[data-live=refresh]'));};
 const scope=value=>{q('#station-filter').value=value;q('#station-filter').dispatchEvent(new w.Event('change',{bubbles:true}));};
 const metric=(view,filter)=>Number(q(`[data-live=metric][data-view="${view}"][data-filter="${filter}"] strong`).textContent);
 const forgedAction=async(action,id)=>{const b=document.createElement('button');b.dataset.live=action;if(id)b.dataset.id=id;q('#app').append(b);b.click();await new Promise(r=>setTimeout(r,0));b.remove();};
 const forgedForm=async(id,fields={})=>{const f=document.createElement('form');f.id=id;for(const [name,value] of Object.entries(fields)){const i=document.createElement('input');i.name=name;i.value=value;f.append(i);}q('#app').append(f);submit(f);await new Promise(r=>setTimeout(r,0));f.remove();};
 try{
  await import('../dist/online.js');await login();
  assert.equal(q('#station-filter').value,'');assert.equal(qa('#station-filter option').length,4);
  assert.equal(metric('pets','all'),3);assert.equal(metric('applications','0'),2);assert.equal(metric('followups','pending'),2);
  scope('empty');assert.equal(metric('pets','all'),0);assert.equal(metric('applications','0'),0);assert.equal(metric('followups','pending'),0);
  scope('other');assert.equal(metric('pets','all'),2);assert.equal(metric('applications','0'),1);assert.equal(metric('followups','pending'),1);assert.equal(metric('followups','confirmation'),1);
  click('pets');await until(()=>q('[data-live=pet]'));assert.deepEqual(qa('[data-live=pet]').map(b=>b.dataset.id),['private-pet','public-pet']);assert.match(q('main').textContent,/另一救助站/);
  click('applications');await until(()=>q('[data-live=application]'));assert.equal(qa('[data-live=application]').length,3);
  click('followups');await until(()=>q('[data-live=followup]'));assert.deepEqual(qa('[data-live=followup]').map(b=>b.dataset.id),['other-followup']);assert.equal(q('[data-live=followup-new]'),null);assert.ok(q('[data-live=application][data-id=other-unplanned]'));

  click('pets');click('pet','private-pet');await until(()=>q('#record-panel')?.textContent.includes('私有原始记录-private-pet'));
  assert.match(q('main').textContent,/原始口述-private-pet/);assert.match(q('main').textContent,/材料识别-private-pet/);assert.ok(q('.gallery-rail img').src.startsWith('blob:'));
  assert.equal(calls.find(c=>c.path.endsWith('/visual/0')).headers.Authorization,'Bearer test-token');
  for(const action of ['voice','media','toggle-visibility','retry','correct','withdraw','chat'])assert.equal(q(`[data-live=${action}]`),null,action);
  const before=writes.length;
  for(const action of ['voice','media','toggle-visibility','retry','correct','withdraw','submit-text','retry-submit','chat'])await forgedAction(action,'record-private-pet');
  await forgedForm('agent-voice-form',{tone:'lively',style:'forbidden'});await forgedForm('chat-form',{question:'forbidden'});await forgedForm('intake-confirm');
  assert.equal(writes.length,before);assert.ok(q('#record-panel'));
  click('agent');await until(()=>q('main').textContent.includes('他站分身设定'));assert.equal(q('#agent-voice-form'),null);assert.equal(q('[data-live=voice]'),null);

  await home();scope('other');click('applications');click('application','other-app');await until(()=>q('.contact-details'));
  assert.equal(q('[data-live=application-next]'),null);assert.equal(q('[data-live=application-close]'),null);
  await forgedAction('application-next');await forgedAction('application-close');assert.equal(writes.length,before);
  await home();click('followups');click('followup','other-followup');await until(()=>q('main').textContent.includes('已有回访记录'));
  assert.equal(q('#followup-form'),null);await forgedForm('followup-form',{note:'forbidden',dueAt:'2026-10-26T12:00'});await forgedAction('followup-new','other-unplanned');assert.equal(writes.length,before);

  await home();click('pets');click('pet','public-pet');await until(()=>q('[data-live=chat]'));click('chat');q('#chat-question').value='你好';submit(q('#chat-form'));await until(()=>q('main').textContent.includes('公开资料回答'));assert.equal(writes.at(-1).path,'/v1/pets/public-pet/chat');
  await home();scope('own');click('applications');click('application','own-app');await until(()=>q('[data-live=application-next]'));assert.ok(q('[data-live=application-close]'));
  await home();click('followups');click('followup','own-followup');await until(()=>q('#followup-form'));
  await home();click('pets');click('pet','own-pet');await until(()=>q('[data-live=correct]'));
  for(const action of ['voice','media','toggle-visibility','retry','correct','withdraw','chat'])assert.ok(q(`[data-live=${action}]`),action);
  click('toggle-visibility');await until(()=>q('[role=switch]')?.getAttribute('aria-checked')==='true');assert.equal(writes.at(-1).path,'/v1/pets/own-pet/profile');
  click('voice');await until(()=>q('#voice-pet'));assert.deepEqual(qa('#voice-pet option').map(o=>o.value),['own-pet']);
  const invalid=document.createElement('option');invalid.value='private-pet';q('#voice-pet').append(invalid);q('#voice-pet').value='private-pet';q('#voice-pet').dispatchEvent(new w.Event('change',{bubbles:true}));
  await home();scope('other');click('new');await until(()=>q('.intake-flow'));assert.match(q('.topbar-title').textContent,/原有救助站/);
  // The legacy creation submit path still sends no selected station or target override.
  await forgedForm('pet-form',{name:'新伙伴',species:'cat',description:'新建档案'});await until(()=>q('#voice-pet option[value=new-pet]'));
  const create=writes.find(c=>c.path==='/v1/pets');assert.ok(create);assert.equal('stationId' in create.body,false);assert.equal(pets.find(p=>p.id==='new-pet').stationId,'own');

  await home();assert.equal(q('#station-filter').value,'own');stations.push({id:'future',name:'新加入救助站'});click('refresh');await until(()=>q('#station-filter option[value=future]'));scope('future');assert.equal(metric('pets','all'),0);
  click('logout');await until(()=>q('#login-form'));privileged=false;await login();assert.equal(q('#station-filter'),null);
  assert.equal(metric('pets','all'),2);click('pets');assert.deepEqual(qa('[data-live=pet]').map(b=>b.dataset.id),['own-pet','new-pet']);
  assert.doesNotMatch(q('main').textContent,/他站私有伙伴|他站公开伙伴/);
 }finally{globalThis.fetch=originalFetch;globalThis.confirm=originalConfirm;w.close();}
});
