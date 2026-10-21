import {createStory} from './samples.js';
import {stationFor} from './discovery.js';
export const EXAMPLES_KEY='pawletter.examples.v11';
export const exampleAnswers={work:{text:'我平时朝九晚六，通勤半小时，晚上和周末在家。',value:'long'},routine:{text:'早上七点起床，晚上十一点睡觉，周末也比较规律。',value:'regular'},free:{text:'工作日有一到两小时陪伴，家人可以分担喂食和清理。',value:'one2'},expectation:{text:'想认识性格稳定的成年猫，愿意尊重它慢热的节奏。',value:'quiet'}};
export const exampleAnalysis={title:'忙里忙外的温柔后勤官',summary:'白天认真工作，晚上认真陪伴。你偏爱安静、慢慢建立信任的相处方式，也愿意和家人分担照护。规律的日常是开始，独处时的安排还需要和救助者一起确认。',highlights:['作息规律','每天留出陪伴时间','愿意慢慢建立信任'],recommendations:[{type:'性格稳定、喜欢安静的成年猫',reason:'更接近你期待的相处节奏；仍需核对这只猫的独处反应与日常照护需求。',basedOn:['routine','expectation']},{type:'活动需求适中的成年犬',reason:'如果能落实每天出门和家人协作，可以进一步了解；现在还不能据此确定适合。',basedOn:['free']}],unknowns:['具体居住空间与封窗情况','工作时间的照护安排']};
export const exampleScenes=[
 ['meet','附近与随缘遇见','17 只猫狗，有性格、有故事','orange'],
 ['saved','喜欢的小伙伴','照片列表，随时回来认识它','tangyuan'],
 ['messages','和宠物分身聊天','7 段往来，体验不同口吻','tabby'],
 ['apply','准备申请','生活画像与一句话补充','ash'],
 ['progress','领养进度','待审核、见面、交接到完成','toast'],
 ['mine','我的与宠物家人','两位已到家伙伴就在身旁','rice'],
 ['lifestyle','生活画像','称号、聚合分析与推荐理由','tabby'],
 ['register','新用户注册访谈','预填示例资料，体验完整流程','orange'],
 ['followup','到家日记','图文回访、待确认与救助者回复','rice'],
 ['public-profile','公开个人主页','成功领养、评分与授权日常','cola'],
 ['ratings','评价与回访安排','两期评价，查看具体依据','cola'],
 ['stations','认识救助站','三个站点，看看照顾它的人','cookie'],
 ['memory','偏好与记忆','来源清楚，可修改、可删除','orange'],
 ['account','身份与领养公约','查看账号说明与约定','tangyuan'],
];
export function createAdopterExamples(now=Date.now()){
 const state=createStory('dog-life',now),cats=createStory('first-cat',now),week=createStory('first-week',now);
 const owner='example-adopter-xiaohe';state.role='user';state.sampleStory='adopter-examples';state.sampleStoryTitle='小禾的领养故事';state.exampleData=true;state.consent=true;state.day=60;
 state.account={id:owner,nickname:'小禾',realName:'示例用户',phone:'00000000000',email:'xiaohe@example.com',wechat:'',verification:'pending',covenantVersion:'示例公约',acceptedAt:now-70*86400000,lifestyle:{answers:structuredClone(exampleAnswers),analysis:structuredClone(exampleAnalysis),confirmedAt:now}};
 state.location.source='example';state.demoPerson='小禾';state.demoAdopters=[];state.following=['orange','tangyuan','tabby','ash','dog'];state.memory=[...cats.memory,{id:'example-memory-care',text:'家人愿意一起分担照护','type':'condition',source:'示例访谈中主动表达',at:now-86400000}];
 state.messages={...state.messages,...cats.messages,...week.messages};
 state.applications.push(...cats.applications,...week.applications,
  {id:'example-app-orange',petId:'orange',stage:0,createdAt:now-86400000,conditions:'已完成封窗，愿意给慢热的它留出适应空间。',questions:'想了解平时吃的粮与喜欢的互动。'},
  {id:'example-app-toast',petId:'toast',stage:2,createdAt:now-6*86400000,conditions:'已见面，正在核对免疫记录、用品与交接安排。',questions:'接回家前还需要准备什么？'});
 state.followups.push(...week.followups);
 for(const a of state.applications)Object.assign(a,{adopterId:owner,name:'小禾',sample:true,stationId:stationFor(state.pets.find(p=>p.id===a.petId)).id,version:1,snapshot:structuredClone(state.account),note:a.conditions+' '+a.questions});
 for(const f of state.followups)f.adopterId=owner;
 for(const r of state.ratings)r.adopterId=owner;
 const rice=state.pets.find(p=>p.id==='rice');rice.status='adopted';rice.active=false;rice.adoptionDay=7;
 for(const p of state.pets){p.sample=true;p.exampleData=true;p.stationRecord=stationFor(p);}
 for(const [id,text] of [['orange','听说你认真看过我的档案，还提交了申请，我有一点点开心。照顾我的人会先和你聊聊，我们慢慢来。'],['toast','我们已经见过面啦。交接还要核对资料和用品，等照顾我的人与你确认好，再一起回家。']])state.messages[id]=[{id:'example-message-'+id,from:'pet',text,at:now-3600000,sample:true}];
 state.followupRequests=[{id:'example-followup-request',applicationId:state.applications.find(a=>a.petId==='rice').id,petId:'rice',adopterId:owner,stationId:rice.stationId,kind:'photo',message:'想看看米粒这周的进食与适应情况，方便时拍一张近照，再说说你的观察。',status:'pending',createdAt:now-86400000,dueAt:now+2*86400000,sample:true}];
 state.applicationDrafts={ash:{note:'家里已经封窗，家人同意领养。工作日我白天上班，晚上可以陪伴，想先了解它的日常照护与适应需求。'}};
 return state;
}
export function createExampleAccount(getState){
 const state=()=>getState();
 return {
  hasSession:()=>false,clear(){},logout:async()=>({ok:true}),profile:async()=>structuredClone(state().account),
  catalog:async()=>({pets:[]}),applications:async()=>({applications:structuredClone(state().applications)}),
  history:async id=>({messages:structuredClone(state().messages[id]||[])}),
  chat:async(id,question)=>{const p=state().pets.find(p=>p.id===id);if(!p)throw new Error('示例宠物不存在');const text=/健康|疫苗|绝育|吃|粮|肠胃/.test(question)?p.health:/家|申请|领养|见面/.test(question)?p.needs:/喜欢|性格|陪|摸|抱/.test(question)?p.character+'。'+p.intro:p.intro;return {answer:'我是'+p.name+'。'+text+' 这是预设示例回复，你可以继续看看我的档案。',citations:[{quote:p.observations?.[0]||p.character,station:'示例档案 · '+p.station}]};},
  apply:async(id,body)=>({id:'example-application-'+Date.now(),petId:id,adopterId:state().account.id,stationId:stationFor(state().pets.find(p=>p.id===id)).id,name:state().account.nickname,stage:0,version:1,createdAt:Date.now(),snapshot:structuredClone(state().account),note:body.note,sample:true}),
  applicationStage:async(id,stage)=>{const a=state().applications.find(a=>a.id===id);if(!a)throw new Error('未找到示例申请');return {...a,stage,version:a.version+1};},
  preferences:async proactive=>({proactive}),
  saveLifestyle:async lifestyle=>({...state().account,lifestyle:{...lifestyle,confirmedAt:Date.now()}}),
  interview:async()=>({understood:true,value:'unknown',reply:'示例助手：记下啦，再看看下一项日常。'}),
  summary:async()=>structuredClone(exampleAnalysis),
  register:async body=>({...createAdopterExamples().account,nickname:body.nickname,lifestyle:{...body.lifestyle,confirmedAt:Date.now()}}),
  login:async()=>{throw new Error('示例体验无需登录；请返回正式界面使用真实账号。');},
 };
}

