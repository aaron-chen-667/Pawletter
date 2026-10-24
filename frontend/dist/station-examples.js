import {createAdopterExamples,exampleAnalysis,exampleAnswers} from './adopter-examples.js';
import {topicOf} from './pet-knowledge.js';
export const STATION_EXAMPLES_KEY='pawletter.station.examples.v13';
export const stationScenes=[['home','工作台','今日申请与宠物日常'],['empty','首次进入','录入第一位伙伴'],['new','录入新伙伴','添加素材，记录情况，确认入档'],['voice','补充','连续补充，统一确认'],['pet','长期档案','照片、习惯与健康观察'],['agent','分身表达','只调整口吻，不编写事实'],['chat','分身问答','根据有效资料回答'],['applications','领养申请','待审核、见面、交接'],['application','申请详情','生活画像与核验状态'],['failed','整理失败','保留原文，重新整理'],['followups','回访跟踪','安排回访、确认与持续跟进'],['private','私有观察','本站可见，不用于对外回答']];
export const exampleObservation='吐司平时喜欢玩羽毛逗猫棒。今天换粮后有点软便，还不确定原因。';
const stamp=()=>new Date().toISOString();
const dayOf=iso=>{const d=new Date(iso),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
const day=r=>r.observed_on||dayOf(r.created_at);
export function stationFixture(){
 const source=createAdopterExamples(),stationId='example-station';
 const pets=source.pets.slice(0,9).map(p=>({id:p.id,name:p.name,stationId,profile:{species:p.species==='dog'?'dog':'cat',description:p.intro,character:p.character,age:p.age,sex:'unknown',photoUrl:p.image},published:p.id!==source.pets[8].id}));
 const records=pets.flatMap((p,i)=>[{id:'known-'+p.id,pet_id:p.id,original_text:i===0?'平时喜欢玩羽毛逗猫棒。':p.profile.character,transcript:'',share_with_agent:true,status:'archived',created_at:stamp(),topic:'likes',certainty:'ongoing'},...(i===0?[{id:'health-'+p.id,pet_id:p.id,original_text:'今天食欲比平时少，还不确定原因。',share_with_agent:true,status:'archived',created_at:stamp(),topic:'health',certainty:'observation'},{id:'private-'+p.id,pet_id:p.id,original_text:'志愿者内部交班：今晚多留意进食，明早交接。',share_with_agent:false,status:'archived',created_at:stamp(),topic:'other',certainty:'observation'},{id:'failed-'+p.id,pet_id:p.id,original_text:'今天第一次愿意靠近志愿者。',share_with_agent:true,status:'failed',created_at:stamp(),topic:'likes',certainty:'observation'},{id:'withdrawn-'+p.id,pet_id:p.id,original_text:'喜欢激光玩具（已撤回，不再引用）。',share_with_agent:true,status:'withdrawn',created_at:stamp()}]:[])]);
 return {version:2,user:{id:'example-staff',role:'station',stationId},pets,records,voices:{},media:{},documents:{},sources:{},followups:[3,4,5].map((i,j)=>({id:'follow-example-'+i,applicationId:'station-app-'+i,petId:pets[i].id,adopterId:'example-adopter-'+i,name:['小周','阿雨','小夏'][j],dueAt:new Date(Date.now()+(j-1)*86400000).toISOString(),status:['pending','confirmation','attention'][j],version:1,updatedAt:stamp(),history:[{at:stamp(),status:['pending','confirmation','attention'][j],text:['准备第一次到家回访，了解饮食和适应情况。','已收到到家反馈，等待救助者确认。','领养者反馈食欲有变化，需要继续联系。'][j]}]})),applications:[0,1,2,3,3,3,3].map((stage,i)=>({id:'station-app-'+i,petId:pets[i].id,stage,version:1,adopterId:'example-adopter-'+i,name:['小禾','阿宁','小林','小周','阿雨','小夏','小安'][i],snapshot:{verification:i>=3?'verified':'pending',realName:'示例申请人',phone:'00000000000',wechat:'pawletter_example_'+i,email:'example'+i+'@example.invalid',lifestyle:{analysis:exampleAnalysis,answers:exampleAnswers}},note:'家中已封窗，家人同意一起照护。希望先见面，了解它平时的饮食和互动习惯。'}))};
}
export function createStationExamples(storage=globalThis.sessionStorage){
 let state=stationFixture();try{const old=JSON.parse(storage?.getItem(STATION_EXAMPLES_KEY));if(old?.version===2)state=old;}catch{}
 const copy=v=>structuredClone(v),save=()=>{try{storage?.setItem(STATION_EXAMPLES_KEY,JSON.stringify(state));}catch{}},row=id=>{const r=state.records.find(r=>r.id===id);if(!r)throw Error('OBSERVATION_NOT_ACTIVE');return r;};
 const note=(r,quote=r.original_text,i=0)=>({id:i?`${r.id}:${i}`:r.id,observation_id:r.id,topic:r.topic||topicOf(quote),certainty:r.certainty||(/可能|不确定|待确认|不清楚/.test(quote)?'pending':/平时|一直|每天|通常|习惯/.test(quote)?'ongoing':'observation'),quote,station:'暖爪救助站 · 示例',recorded_at:r.created_at});
 // Like the real worker, a new record is split into sentences so each one carries its own topic.
 const notes=r=>r.topic?[note(r)]:r.original_text.split(/(?<=[。！？；\n])/).map(t=>t.trim()).filter(Boolean).map((quote,i)=>note(r,quote,i));
 const api={
  user:()=>copy(state.user),reset(empty=false){state=stationFixture();if(empty){state.pets=[];state.records=[];state.applications=[];state.followups=[];}save();},
  stations:async()=>({stations:[{id:state.user.stationId,name:'暖爪救助站 · 示例'}]}),
  login:async()=>({user:copy(state.user)}),logout:async()=>{},me:async()=>copy(state.user),pets:async()=>({pets:copy(state.pets)}),applications:async()=>({applications:copy(state.applications)}),
  applicationStage:async(id,stage,version)=>{const a=state.applications.find(a=>a.id===id);if(!a||a.version!==version)throw Error('INVALID_INPUT');if(stage===3&&a.snapshot.verification!=='verified')throw Error('INVALID_INPUT');Object.assign(a,{stage,version:version+1});save();return copy(a);},
  setVisibility:async(id,published)=>{const p=state.pets.find(p=>p.id===id);if(!p||p.stationId!==state.user.stationId)throw Error('STATION_REQUIRED');p.published=published;save();return {ok:true};},
  // The station sees every archived note; the pet's agent only uses shared ones.
  knowledge:async id=>({notes:state.records.filter(r=>r.pet_id===id&&r.status==='archived').flatMap(notes)}),
  observations:async(id,f={})=>({observations:copy(state.records.filter(r=>r.pet_id===id&&(!f.id||r.id===f.id)&&(!f.q||(r.original_text+' '+r.transcript).includes(f.q))&&(!f.status||f.status==='all'||(f.status==='processing'?['queued','processing'].includes(r.status):r.status===f.status))&&(!f.from||day(r)>=f.from)&&(!f.to||day(r)<=f.to)).sort((a,b)=>(f.order==='asc'?1:-1)*(day(a).localeCompare(day(b))||a.created_at.localeCompare(b.created_at))).map(r=>({visuals:[],...r,observed_on:r.observed_on||null})))}),
  followups:async()=>({followups:copy(state.followups)}),
  createFollowup:async(body,key)=>{const old=state.followups.find(f=>f.key===key);if(old)return copy(old);const a=state.applications.find(a=>a.id===body.applicationId);if(!a||a.stage!==3)throw Error('INVALID_INPUT');const f={id:crypto.randomUUID(),key,...body,name:a.name,petId:a.petId,adopterId:a.adopterId,status:'pending',version:1,updatedAt:stamp(),history:[{at:stamp(),status:'pending',text:body.note}]};state.followups.push(f);save();return copy(f);},
  updateFollowup:async(id,body)=>{const f=state.followups.find(f=>f.id===id);if(f.history.some(h=>h.requestId===body.requestId))return copy(f);if(f.version!==body.version)throw Error('INVALID_INPUT');Object.assign(f,{status:body.status,dueAt:body.dueAt,version:f.version+1,updatedAt:stamp()});f.history.push({at:stamp(),status:body.status,text:body.note,requestId:body.requestId});save();return copy(f);},
  intake:async id=>({documents:copy(state.documents?.[id]||[]),source_text:state.sources?.[id]||'',visuals:copy(state.media[id]||[{url:state.pets.find(p=>p.id===id)?.profile.photoUrl,mime:'image/jpeg',caption:'救助站上传的示例照片',shared:true,createdAt:stamp()}].filter(v=>v.url))}),
  addVisuals:async(id,body,key)=>{state.media[id]||=(await api.intake(id)).visuals;if(state.media[id].some(v=>v.key===key))return {ok:true};state.media[id].push(...body.photos.map(url=>({url,mime:'image/jpeg',caption:body.caption,shared:body.shared,createdAt:stamp(),key})),...(body.video?[{url:body.video,mime:body.video.startsWith('data:video/mp4')?'video/mp4':'video/webm',caption:body.caption,shared:body.shared,createdAt:stamp(),key}]:[]));save();return {ok:true};},
  // Like the server: a record keeps the day it happened and the photos or video saved with it; a correction keeps the old media.
  submitObservation:async(petId,body,key)=>{
   const prior=state.records.find(r=>r.key===key);if(prior)return {id:prior.id};
   const previous=state;state=copy(state);
   try{
   const visuals=[...(body.photos||[]).map(url=>({url,mime:'image/jpeg'})),...(body.video?[{url:body.video,mime:body.video.startsWith('data:video/mp4')?'video/mp4':'video/webm'}]:[])];
   if(body.replacesId){const old=row(body.replacesId);old.status='withdrawn';visuals.unshift(...(old.visuals||[]));old.visuals=[];}
   const r={id:crypto.randomUUID(),pet_id:petId,original_text:body.text,share_with_agent:body.shareWithAgent,status:'queued',created_at:stamp(),observed_on:body.observedOn||null,replaces_id:body.replacesId||null,visuals,key};
   if(visuals.length){state.media[petId]||=(await api.intake(petId)).visuals;state.media[petId].push(...visuals.filter(v=>!state.media[petId].some(m=>m.url===v.url)).map(v=>({...v,shared:false,createdAt:stamp()})));}
   state.records.unshift(r);
   try{if(!storage)throw Error('STORAGE_UNAVAILABLE');storage.setItem(STATION_EXAMPLES_KEY,JSON.stringify(state));}catch{throw Error('EXAMPLE_STORAGE_FULL');}
   return {id:r.id};
   }catch(e){state=previous;throw e;}
  },
  processObservation:async id=>{row(id).status='archived';save();return {ok:true};},retryObservation:async id=>{row(id).status='queued';save();return {ok:true};},withdrawObservation:async id=>{row(id).status='withdrawn';save();return {ok:true};},
  agent:async id=>({voice:copy(state.voices[id]||{tone:'shy',style:'轻声短句，慢慢熟悉。'})}),updateAgent:async(id,voice)=>{state.voices[id]=copy(voice);save();return {voice};},
  chat:async(id,question)=>{const shared=state.records.filter(r=>r.pet_id===id&&r.status==='archived'&&r.share_with_agent).flatMap(notes);const terms=/健康|吃|粮|便|食欲/.test(question)?/健康|吃|粮|便|食欲/:/喜欢|玩|靠近|互动/;const found=shared.filter(n=>terms.test(n.quote)).slice(0,2);return {answer:found.length?'照顾我的人记下了：'+found.map(n=>n.quote).join(' ')+'（预设示例回答）':'这件事还没有记进我的有效档案，我暂时不知道。（预设示例回答）',citations:found};},
  // This deterministic preview is explicitly labelled as an example, never a real AI response.
  draftIntake:async body=>{
   const lines=body.text.split('\n').map(t=>t.replace(/^救助者口述：/,''));
   const text=lines.join('；'),ageMatch=text.match(/(?:大概|约|估计)([一二三四五六七八九十两0-9]+)岁/),skipped=text.includes('不清楚');
   const estimated=/送来的人估计|送来人估计/.test(text),nameMatch=[...text.matchAll(/(?:它叫|名字是|名字：)([^，。；\s]{1,12})/g)].at(-1);
   // Mirror the real organiser: name and age move to fields, single-moment behaviour is labelled as such.
   const clauses=lines.filter(t=>!t.startsWith('更正档案：')&&!t.startsWith('这项不清楚')).join('。').split(/[，。；\n]+/).map(t=>t.trim()).filter(t=>t&&!/名字|它叫|岁|估计的/.test(t));
   const arrival=clauses.filter(t=>/接回|捡到|救助/.test(t)),moments=clauses.filter(t=>!arrival.includes(t));
   const description=[arrival.join('，'),...moments.map(t=>/今天|刚|这次/.test(t)?`${t}（本次观察）`:t)].filter(Boolean).map(t=>t+'。').join('');
   const declined=body.declined||[],said={species:/猫|狗/,age:/岁|个月/,sex:/公|母|弟弟|妹妹/,health:/伤|病|疫苗|驱虫|绝育|体检|健康/,character:/平时|性格|黏人|亲人|胆小|活泼|安静/,likes:/喜欢|爱玩|逗猫|摸/,habits:/猫砂|厕所|睡|作息|散步/,diet:/粮|罐头|喝水|饮食/};
   const coverage=Object.fromEntries(Object.entries(said).map(([key,pattern])=>[key,declined.includes(key)?'unknown':pattern.test(text)?'covered':'missing']));
   const questions={species:'它是猫还是狗？',age:'它大概几岁？是估计的还是查过？',sex:'它是公的还是母的？',health:'它身体怎么样？有没有受伤，打过疫苗、驱虫或绝育吗？',character:'它平时是什么性格？亲人还是怕生？',likes:'它喜欢吃什么、玩什么？被摸的时候什么反应？',habits:'它的生活习惯怎么样？会用猫砂吗，作息规律吗？',diet:'它平时吃什么？食量和喝水正常吗？'};
   const ambiguity=ageMatch&&!estimated&&!skipped?'约一岁是估计的，还是有检查记录？':'',nextDimension=ambiguity?'':Object.keys(said).find(key=>coverage[key]==='missing')||'';
   return {name:nameMatch?.[1]||'',species:/猫/.test(text)?'cat':/狗/.test(text)?'dog':'unknown',description:description.slice(0,4000),character:/平时[^，。；]*/.exec(text)?.[0]||'',coverage,nextDimension,age:ageMatch?`约${ageMatch[1]}岁${estimated?'（送来人估计）':skipped?'（依据待确认）':'（估计）'}`:'',sex:/公/.test(text)?'male':/母/.test(text)?'female':'unknown',nextQuestion:ambiguity||questions[nextDimension]||'',ocrText:'',uncertainties:ageMatch&&!estimated?['年龄依据待确认']:[]};
  },
  commitIntake:async(body,key)=>{
   const prior=state.pets.find(p=>p.key===key);if(prior)return {id:prior.id};
   const next=copy(state),description=body.simple?body.text:body.profile.description;
   const p={id:crypto.randomUUID(),key,name:body.name,stationId:next.user.stationId,published:body.published,profile:{...body.profile,description,photoUrl:body.photos[0]||''}};
   next.pets.push(p);next.media[p.id]=body.photos.map(url=>({url,mime:'image/jpeg',shared:false,createdAt:stamp()}));
   next.documents||={};next.sources||={};next.sources[p.id]=body.text;
   next.documents[p.id]=(body.documents||[]).map(d=>({name:d.name,url:d.dataUrl,mime:d.dataUrl.split(';')[0].slice(5)}));
   if(body.video)next.media[p.id].push({url:body.video,mime:body.video.startsWith('data:video/mp4')?'video/mp4':'video/webm',shared:false,createdAt:stamp()});
   let observationId=null;
   // Reviewed card notes keep their topic, certainty and visibility, like the real server.
   if(body.notes)for(const n of body.notes){const id=crypto.randomUUID();observationId||=id;next.records.unshift({id,pet_id:p.id,original_text:n.quote,share_with_agent:n.shared,topic:n.topic,certainty:n.certainty,status:'archived',created_at:stamp(),key});}
   else if(description?.trim()){observationId=crypto.randomUUID();next.records.unshift({id:observationId,pet_id:p.id,original_text:description,share_with_agent:true,status:'archived',created_at:stamp(),key});}
   try{if(!storage)throw Error('STORAGE_UNAVAILABLE');storage.setItem(STATION_EXAMPLES_KEY,JSON.stringify(next));}catch{throw Error('EXAMPLE_STORAGE_FULL');}
   state=next;return {id:p.id,observationId};
  },
  createPet:async body=>api.commitIntake({...body,photos:['./assets/orange.jpg']},crypto.randomUUID()),
  uploadAudio:async()=>{throw Error('EXAMPLE_TEXT_ONLY');}
 };return api;
}
