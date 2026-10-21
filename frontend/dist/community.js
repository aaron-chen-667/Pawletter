import { stations, stationFor } from './discovery.js';

export const COVENANT_VERSION = '2026-10-demo';
export function initializeCommunity(state) {
  state.account ??= null;
  state.identityRegistry ??= {};
  state.ratings ??= [];
  state.followupRequests ??= [];
  state.stationRequests ??= [];
  state.activeStationId ??= 'warm';
  // Existing records stay private. Migration never infers publication consent.
  for (const record of state.followups) record.publication ??= { allowed:false };
}
export function registerDemo(state, {nickname, identity, covenant, privacy}) {
  if (!covenant || !privacy) throw new Error('请阅读并同意领养公约和身份信息保密规则。');
  if (!nickname?.trim()) throw new Error('请填写主页昵称。');
  if (!['DEMO-0001','DEMO-0002'].includes(identity)) throw new Error('本 Demo 仅支持示例身份，不接收真实证件。');
  if (state.account || state.identityRegistry[identity]) throw new Error('该演示身份已有账号，请使用已有账号；一人只对应一个账号。');
  const account = {id:crypto.randomUUID(),nickname:nickname.trim().slice(0,20),identityToken:identity,verification:'demo',covenantVersion:COVENANT_VERSION,acceptedAt:Date.now()};
  state.account=account;state.identityRegistry[identity]=account.id;
  // A legacy demo has one local user; associate only its existing unowned records.
  for(const a of state.applications) a.adopterId ??= account.id;
  for(const f of state.followups) f.adopterId ??= account.id;
  return account;
}
export function stationPets(state,id) {return state.pets.filter(p=>stationFor(p).id===id);}
export function adoptionDay(state,petId) {return state.pets.find(p=>p.id===petId)?.adoptionDay??state.day;}
export function evaluationStatus(state, application) {
  const latest=state.ratings.filter(r=>r.applicationId===application.id).at(-1);
  return {latest, dueDay:latest?latest.day+30:30, due:adoptionDay(state,application.petId)>=(latest?latest.day+30:30)};
}
export function addStationRating(state, {applicationId, score, note}) {
  if(state.role!=='rescue') throw new Error('请由负责该领养的救助站提交评价。');
  const a=state.applications.find(a=>a.id===applicationId&&a.stage===3);
  const pet=a&&state.pets.find(p=>p.id===a.petId);
  if(!pet||!a.adopterId||stationFor(pet).id!==state.activeStationId) throw new Error('仅所属站点可评价已完成交接的实名演示账号。');
  if(score===null||score===undefined||score===''||!Number.isInteger(Number(score))||Number(score)<0||Number(score)>5) throw new Error('请选择 0–5 星；未评价不等于 0 星。');
  if(!note?.trim()) throw new Error('请写下本次回访的事实依据与后续安排。');
  const status=evaluationStatus(state,a);
  const day=adoptionDay(state,pet.id);
  if(status.latest&&status.latest.day===day) throw new Error('今天已提交评价，可在下一次回访后继续评价。');
  const record={id:crypto.randomUUID(),adopterId:a.adopterId,applicationId:a.id,petId:pet.id,stationId:state.activeStationId,score:Number(score),note:note.trim().slice(0,500),day,at:Date.now()};
  state.ratings.push(record);return record;
}
export function publicProfile(state,adopterId=state.account?.id) {
  const id=adopterId,account=state.account?.id===id?state.account:state.demoAdopters?.find(a=>a.id===id);
  // A public projection deliberately excludes contacts, identity, care notes and review reasons.
  const applications=id?state.applications.filter(a=>a.adopterId===id).map(a=>{
    const pet=state.pets.find(p=>p.id===a.petId);
    return {id:a.id,petId:a.petId,petName:pet?.name||'档案待补充',image:pet?.image,stationId:pet?stationFor(pet).id:null,stage:a.stage,createdAt:a.createdAt};
  }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)):[];
  return {
    nickname:account?.nickname||state.applications.find(a=>id&&a.adopterId===id)?.name||'还没有创建主页',
    applications:applications.filter(a=>a.stage>=0&&a.stage<3),
    adoptions:applications.filter(a=>a.stage===3),
    ratings:id?state.ratings.filter(r=>r.adopterId===id).map(({score,stationId,day,at,petId,applicationId})=>({score,stationId,day,at,petId,applicationId})).sort((a,b)=>(a.at||0)-(b.at||0)):[],
    moments:id?state.followups.filter(f=>f.adopterId===id&&f.publication?.allowed===true).map(f=>({id:f.id,petId:f.petId,day:f.day,media:f.media||[],caption:f.publication.caption||'一起生活的小片段',sample:!!f.sample})):[],
  };
}
export const stationDetails = {
  warm:{tagline:'让每一次暂住，都离家更近一点。',about:'我们照顾等待领养的猫狗，记录真实的性格与生活习惯。先慢慢认识，再通过沟通、见面和交接，一起确认适不适合成为家人。',cover:'./assets/orange.jpg',tags:['猫狗救助','预约见面','持续回访']},
  garden:{tagline:'在小院里，等一个属于自己的家。',about:'这里是以猫咪为主的示例救助站。我们关注它们的适应节奏，也帮助第一次养猫的家庭了解照护需求，让每一次相遇多一点耐心。',cover:'./assets/tabby.jpg',tags:['猫咪之家','性格观察','新手沟通']},
  sun:{tagline:'陪它多走一段，也陪你迎接新家人。',about:'我们为等待领养的小伙伴建立档案，帮助领养者了解运动、陪伴与日常照护需求。领养后继续通过用户主动提交的日常保持联系。',cover:'./assets/dog.jpg',tags:['猫狗救助','照护沟通','到家陪伴']},
};
export function stationById(id) {return stations.find(s=>s.id===id);}

export function requestFollowup(state,{applicationId,kind,message,dueDays}) {
  const a=state.applications.find(a=>a.id===applicationId&&a.stage===3);
  const pet=a&&state.pets.find(p=>p.id===a.petId);
  if(state.role!=='rescue'||!pet||!a.adopterId||stationFor(pet).id!==state.activeStationId)throw new Error('仅负责该领养的站点可发起回访。');
  if(!['photo','video','audio','any'].includes(kind)||![1,3,7].includes(Number(dueDays))||!message?.trim())throw new Error('请选择素材类型、回复时间，并说明回访内容。');
  state.followupRequests??=[];
  if(state.followupRequests.some(r=>r.applicationId===a.id&&r.status==='pending'))throw new Error('这位领养者还有待回复的回访，请等待反馈后再发起。');
  const request={id:crypto.randomUUID(),applicationId:a.id,adopterId:a.adopterId,petId:a.petId,stationId:state.activeStationId,kind,message:message.trim().slice(0,300),createdAt:Date.now(),dueAt:Date.now()+Number(dueDays)*86400000,status:'pending'};
  state.followupRequests.push(request);return request;
}
export function completeFollowupRequest(state,record) {
  const r=state.followupRequests?.find(r=>r.id===record.requestId);
  if(state.role!=='user'||!r||r.status!=='pending'||record.adopterId!==r.adopterId||state.account?.id!==r.adopterId||record.petId!==r.petId||record.stationId!==r.stationId)return false;
  r.status='submitted';r.feedbackId=record.id;r.submittedAt=Date.now();return true;
}
