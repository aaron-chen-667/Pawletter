import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../dist/domain.js';
import {initializeDiscovery} from '../dist/discovery.js';
import {initializeCommunity,registerDemo,addStationRating,evaluationStatus,publicProfile,stationPets,requestFollowup,completeFollowupRequest} from '../dist/community.js';
const input={nickname:'小禾',identity:'DEMO-0001',covenant:true,privacy:true};
function setup(){const s=freshState();initializeDiscovery(s);initializeCommunity(s);return s;}
test('registration needs both agreements, accepts only demo identities and prevents duplicate accounts',()=>{
  const s=setup();
  assert.throws(()=>registerDemo(s,{...input,covenant:false}));
  assert.throws(()=>registerDemo(s,{...input,privacy:false}));
  assert.throws(()=>registerDemo(s,{...input,identity:'real-id'}));
  registerDemo(s,input);
  assert.throws(()=>registerDemo(s,input));
  s.account=null;
  assert.throws(()=>registerDemo(s,input));
  assert.equal(Object.keys(s.identityRegistry).length,1);
});
test('0 stars is a valid evaluation; wrong role/station, missing score and duplicate same-day review are rejected',()=>{
  const s=setup();registerDemo(s,input);
  const a={id:'a',adopterId:s.account.id,petId:'orange',stage:3};s.applications.push(a);
  const value={applicationId:'a',score:0,note:'本次需要进一步人工核实。'};
  assert.equal(evaluationStatus(s,a).latest,undefined);
  assert.throws(()=>addStationRating(s,value));
  s.role='rescue';s.activeStationId='garden';assert.throws(()=>addStationRating(s,value));
  s.activeStationId='warm';assert.throws(()=>addStationRating(s,{...value,score:null}));
  for(const score of [-1,6,2.5])assert.throws(()=>addStationRating(s,{...value,score}));
  addStationRating(s,value);assert.equal(evaluationStatus(s,a).latest.score,0);
  assert.throws(()=>addStationRating(s,value));
  s.day=31;assert.equal(evaluationStatus(s,a).due,true);addStationRating(s,{...value,score:5});
  assert.equal(s.ratings.length,2);assert.equal(evaluationStatus(s,a).dueDay,61);
});
test('public profile projects only authorized media; identity, note, contact, and private feedback never leak',()=>{
  const s=setup();registerDemo(s,input);const id=s.account.id;
  s.followups=[
    {id:'legacy',adopterId:id,text:'private legacy',media:[]},
    {id:'private',adopterId:id,text:'private observation',publication:{allowed:false},media:[]},
    {id:'public',adopterId:id,petId:'orange',day:1,text:'private observation',reply:'private reply',publication:{allowed:true,caption:'一起生活的小片段'},media:[{type:'photo',src:'photo.jpg'}]},
    {id:'other-user',adopterId:'someone-else',publication:{allowed:true},media:[]},
  ];
  initializeCommunity(s);assert.equal(s.followups[0].publication.allowed,false);
  s.ratings=[{adopterId:id,score:0,stationId:'warm',day:1,at:1,note:'private reason'}];
  const profile=publicProfile(s);assert.equal(profile.moments.length,1);assert.equal(profile.ratings[0].score,0);
  assert.doesNotMatch(JSON.stringify(profile),/DEMO-0001|private|identityToken|contact/);
  s.followups[2].publication.allowed=false;assert.equal(publicProfile(s).moments.length,0);
  assert.equal(s.followups.length,4);
});
test('station relationships include own pets and preserve existing state',()=>{
  const s=setup();s.followups.push({id:'old'});s.account={id:'retained',nickname:'已有用户'};
  initializeCommunity(s);
  assert.deepEqual(stationPets(s,'garden').map(p=>p.id),['tabby']);
  assert.equal(s.account.id,'retained');assert.equal(s.followups[0].publication.allowed,false);
});
test('profile links only the selected household applications and ratings without private contact fields',()=>{
  const s=setup();registerDemo(s,input);const id=s.account.id;
  s.applications=[
    {id:'active',petId:'tabby',adopterId:id,stage:1,phone:'secret-phone',wechat:'secret-wechat',email:'secret-email',conditions:'secret-condition',createdAt:3},
    {id:'done',petId:'orange',adopterId:id,stage:3,createdAt:2},
    {id:'ended',petId:'dog',adopterId:id,stage:-1},
    {id:'another',petId:'dog',adopterId:'other',stage:0}
  ];
  s.ratings=[{adopterId:id,applicationId:'done',petId:'orange',stationId:'warm',score:0,at:2,note:'secret-note'}];
  const profile=publicProfile(s,id);
  assert.deepEqual(profile.applications.map(a=>a.id),['active']);
  assert.deepEqual(profile.adoptions.map(a=>a.id),['done']);
  assert.equal(profile.ratings[0].applicationId,'done');
  assert.equal(profile.ratings[0].score,0);
  assert.doesNotMatch(JSON.stringify(profile),/secret|identityToken/);
  assert.equal(publicProfile(s,'missing').applications.length,0);
});
test('followup requests enforce station/household ownership, prevent duplicate pending requests and link replies',()=>{
  const s=setup();registerDemo(s,input);s.applications=[{id:'a',petId:'orange',adopterId:s.account.id,stage:3}];
  const values={applicationId:'a',kind:'photo',message:'请拍摄近况',dueDays:3};
  assert.throws(()=>requestFollowup(s,values));
  s.role='rescue';s.activeStationId='garden';assert.throws(()=>requestFollowup(s,values));
  s.activeStationId='warm';assert.throws(()=>requestFollowup(s,{...values,kind:'bad'}));
  const r=requestFollowup(s,values);
  assert.throws(()=>requestFollowup(s,values));
  const record={id:'response',requestId:r.id,adopterId:s.account.id,petId:'orange',stationId:'warm',resolved:false};
  assert.equal(completeFollowupRequest(s,record),false);
  s.role='user';assert.equal(completeFollowupRequest(s,{...record,adopterId:'other'}),false);
  assert.equal(completeFollowupRequest(s,{...record,petId:'tabby'}),false);
  assert.equal(completeFollowupRequest(s,record),true);
  assert.equal(r.status,'submitted');assert.equal(r.feedbackId,'response');assert.equal(record.resolved,false);
  assert.equal(completeFollowupRequest(s,record),false);
});
