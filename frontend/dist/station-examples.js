import {createAdopterExamples,exampleAnalysis,exampleAnswers} from './adopter-examples.js';
export const STATION_EXAMPLES_KEY='pawletter.station.examples.v12';
export const stationScenes=[['home','工作台','今日申请与宠物日常'],['empty','首次进入','录入第一位伙伴'],['new','拍摄建档','拍照 / 视频 → 口述 → 确认'],['voice','补充日常','选宠物，说一段，自动归档'],['pet','长期档案','照片、习惯与健康观察'],['agent','分身表达','只调整口吻，不编写事实'],['chat','分身问答','根据有效资料回答'],['applications','领养申请','待审核、见面、交接'],['application','申请详情','生活画像与核验状态'],['failed','整理失败','保留原文，重新整理'],['private','私有观察','本站可见，不用于对外回答']];
export const exampleObservation='吐司平时喜欢玩羽毛逗猫棒。今天换粮后有点软便，还不确定原因。';
const stamp=()=>new Date().toISOString();
export function stationFixture(){
 const source=createAdopterExamples(),stationId='example-station';
 const pets=source.pets.slice(0,6).map(p=>({id:p.id,name:p.name,stationId,profile:{species:p.species==='dog'?'dog':'cat',description:p.intro,character:p.character,age:p.age,sex:'unknown',photoUrl:p.image},published:true}));
 const records=pets.flatMap((p,i)=>[{id:'known-'+p.id,pet_id:p.id,original_text:i===0?'平时喜欢玩羽毛逗猫棒。':p.profile.character,transcript:'',share_with_agent:true,status:'archived',created_at:stamp(),topic:'likes',certainty:'ongoing'},...(i===0?[{id:'health-'+p.id,pet_id:p.id,original_text:'今天食欲比平时少，还不确定原因。',share_with_agent:true,status:'archived',created_at:stamp(),topic:'health',certainty:'observation'},{id:'private-'+p.id,pet_id:p.id,original_text:'志愿者内部交班：今晚多留意进食，明早交接。',share_with_agent:false,status:'archived',created_at:stamp(),topic:'other',certainty:'observation'},{id:'failed-'+p.id,pet_id:p.id,original_text:'今天第一次愿意靠近志愿者。',share_with_agent:true,status:'failed',created_at:stamp(),topic:'likes',certainty:'observation'},{id:'withdrawn-'+p.id,pet_id:p.id,original_text:'喜欢激光玩具（已撤回，不再引用）。',share_with_agent:true,status:'withdrawn',created_at:stamp()}]:[])]);
 return {version:1,user:{id:'example-staff',role:'station',stationId},pets,records,voices:{},applications:[0,1,2,3].map((stage,i)=>({id:'station-app-'+i,petId:pets[i].id,stage,version:1,name:['小禾','阿宁','小林','小周'][i],snapshot:{verification:i===3?'verified':'pending',realName:'示例申请人',phone:'00000000000',lifestyle:{analysis:exampleAnalysis,answers:exampleAnswers}},note:'家中已封窗，家人同意一起照护。希望先见面，了解它平时的饮食和互动习惯。'}))};
}
export function createStationExamples(storage=globalThis.sessionStorage){
 let state=stationFixture();try{const old=JSON.parse(storage?.getItem(STATION_EXAMPLES_KEY));if(old?.version===1)state=old;}catch{}
 const copy=v=>structuredClone(v),save=()=>{try{storage?.setItem(STATION_EXAMPLES_KEY,JSON.stringify(state));}catch{}},row=id=>{const r=state.records.find(r=>r.id===id);if(!r)throw Error('OBSERVATION_NOT_ACTIVE');return r;};
 const note=r=>({id:r.id,topic:r.topic||(/吃|粮|便|食欲/.test(r.original_text)?'health':'likes'),certainty:r.certainty||'observation',quote:r.original_text,station:'暖爪救助站 · 示例',recorded_at:r.created_at});
 const api={
  user:()=>copy(state.user),reset(empty=false){state=stationFixture();if(empty){state.pets=[];state.records=[];state.applications=[];}save();},
  login:async()=>({user:copy(state.user)}),logout:async()=>{},me:async()=>copy(state.user),pets:async()=>({pets:copy(state.pets)}),applications:async()=>({applications:copy(state.applications)}),
  applicationStage:async(id,stage,version)=>{const a=state.applications.find(a=>a.id===id);if(!a||a.version!==version)throw Error('INVALID_INPUT');if(stage===3&&a.snapshot.verification!=='verified')throw Error('INVALID_INPUT');Object.assign(a,{stage,version:version+1});save();return copy(a);},
  knowledge:async id=>({notes:state.records.filter(r=>r.pet_id===id&&r.status==='archived'&&r.share_with_agent).map(note)}),
  observations:async id=>({observations:copy(state.records.filter(r=>r.pet_id===id))}),
  submitObservation:async(petId,body,key)=>{const prior=state.records.find(r=>r.key===key);if(prior)return {id:prior.id};if(body.replacesId)row(body.replacesId).status='withdrawn';const r={id:crypto.randomUUID(),pet_id:petId,original_text:body.text,share_with_agent:body.shareWithAgent,status:'queued',created_at:stamp(),key};state.records.unshift(r);save();return {id:r.id};},
  processObservation:async id=>{row(id).status='archived';save();return {ok:true};},retryObservation:async id=>{row(id).status='queued';save();return {ok:true};},withdrawObservation:async id=>{row(id).status='withdrawn';save();return {ok:true};},
  agent:async id=>({voice:copy(state.voices[id]||{tone:'shy',style:'轻声短句，慢慢熟悉。'})}),updateAgent:async(id,voice)=>{state.voices[id]=copy(voice);save();return {voice};},
  chat:async(id,question)=>{const notes=(await api.knowledge(id)).notes;const terms=/健康|吃|粮|便|食欲/.test(question)?/健康|吃|粮|便|食欲/:/喜欢|玩|靠近|互动/;const found=notes.filter(n=>terms.test(n.quote)).slice(0,2);return {answer:found.length?'照顾我的人记下了：'+found.map(n=>n.quote).join(' ')+'（预设示例回答）':'这件事还没有记进我的有效档案，我暂时不知道。（预设示例回答）',citations:found};},
  draftIntake:async body=>({name:'小满',species:'cat',description:'救助者口述：平时喜欢玩逗猫棒。年龄及健康情况待确认。',character:'',age:'',sex:'unknown',nextQuestion:body.text.includes('助手提问：')&&body.text.split('救助者口述：').length>2?'':'它最近的健康情况怎么样，有没有检查记录？',ocrText:body.images.some(i=>i.kind==='document')?'示例材料：体重 3.2 kg；日期待核对。':'',uncertainties:['年龄与免疫情况还需救助者确认。']}),
  commitIntake:async(body,key)=>{let p=state.pets.find(p=>p.key===key);if(p)return {id:p.id};p={id:crypto.randomUUID(),key,name:body.name,stationId:state.user.stationId,published:body.published,profile:{...body.profile,photoUrl:body.photos[0]}};state.pets.push(p);const r=await api.submitObservation(p.id,{text:body.profile.description||'刚刚来到救助站，更多日常待补充。',shareWithAgent:true},key);await api.processObservation(r.id);save();return {id:p.id,observationId:r.id};},
  createPet:async body=>api.commitIntake({...body,photos:['./assets/orange.jpg']},crypto.randomUUID()),
  uploadAudio:async()=>{throw Error('EXAMPLE_TEXT_ONLY');}
 };return api;
}
