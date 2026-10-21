import { freshState } from './domain.js';
import { initializeDiscovery, stationFor, cityLocations } from './discovery.js';
import { initializeCommunity, COVENANT_VERSION } from './community.js';

export const STORY_STORAGE_KEY='pawletter.story.v1';
export const STORY_MODE_KEY='pawletter.story.active';
const DAY=86400000;
const image=name=>`./assets/${name}.jpg`;
// Add demo records once, without replacing user-created applications, media or edits.
export function populateDefaultExamples(state,now=Date.now()) {
 if(state.defaultExamplesRevision||state.sampleStory)return state;
 const seed=createStory('station-day',now),untouched=new Set(seed.pets.filter(p=>!state.applications.some(a=>a.petId===p.id)&&!state.followups.some(f=>f.petId===p.id)&&state.pets.find(x=>x.id===p.id)?.status!=='adopted').map(p=>p.id));
 const useDemoAccount=!state.account&&!state.applications.length;
 state.demoAdopters??=[];
 for(const account of seed.demoAdopters)if(!state.demoAdopters.some(a=>a.id===account.id))state.demoAdopters.push(structuredClone(account));
 if(useDemoAccount)state.account=structuredClone(seed.account);
 for(const pet of seed.pets)if(untouched.has(pet.id)){
  const existing=state.pets.find(p=>p.id===pet.id);
  if(!existing)state.pets.push(structuredClone(pet));
  else if(pet.status==='adopted')Object.assign(existing,{status:'adopted',active:false,adoptionDay:pet.adoptionDay});
 }
 for(const key of ['applications','followups','ratings','reviews'])for(const item of seed[key])if(untouched.has(item.petId)&&!state[key].some(x=>x.id===item.id))state[key].push(structuredClone(item));
 if(useDemoAccount){
  state.messages=structuredClone(seed.messages);state.day=seed.day;
  state.applications.push({id:'demo-application-cloud',adopterId:state.account.id,petId:'cloud',name:state.account.nickname,city:'杭州',email:'ayuan.demo@example.com',phone:'13800000000',wechat:'demo_ayuan',conditions:'已有养狗经验，正在评估增加陪伴与活动时间的安排。',questions:'想先了解和家中原住民的相处情况，尚未决定领养。',stage:0,createdAt:now-86400000,sample:true});
 }
 state.defaultExamplesRevision=1;
 return enrichCatalog(state);
}
// Fictional case notes, never assertions about the animals in the stock photographs.
const entries=[
  ['tangyuan','汤圆','猫','黑白','男孩子','约 1 岁 8 个月','cat-01','warm','窗边小管家','我负责看窗外，你负责慢慢回家。','亲人、好奇，见陌生人会先观察','喜欢看窗外的鸟，吃饭前会轻轻叫两声。熟悉后会在沙发另一端陪你，不太喜欢被长时间抱着。','社区车棚中被发现，由居民临时照料后转入站点。','4.2 kg','已绝育；已有两次免疫登记，接种凭证见面时核对','遇到突然的吸尘器声会躲到高处；与狗相处待确认','室内饲养、封窗，接受它不爱被抱的边界','喜欢窗边｜会用猫砂｜不爱久抱'],
  ['ash','阿灰','猫','灰色','男孩子','约 4 岁','cat-02','garden','低电量室友','今日安排：晒太阳，然后换个地方晒。','安静、慢热，需要稳定作息','我有自己的休息时间，不会一直追着你跑。你坐下来读书，我可能就靠近一点点。','原照护人无法继续照顾，由志愿者接手安置。','5.1 kg','已绝育；体检登记需要新家庭与救助者共同核对','曾记录活动量偏少，关节与体态需专业评估；不依据照片判断','愿意持续关注活动变化，避免强迫互动','安静陪伴｜成年猫｜尊重边界'],
  ['toast','吐司','猫','橘色','女孩子','约 3 岁','cat-03','warm','午睡冠军','靠近一点，可以分你半个午觉。','温和、熟悉后亲人，喜欢午睡','我喜欢松软的毯子，会把一天的大部分时间分给睡觉。醒来以后，愿意跟你玩几分钟逗猫棒。','在小区绿化带生活过，接受固定投喂后逐渐愿意亲近人。','4.6 kg','已绝育；驱虫登记齐全，免疫凭证待交接核对','和其他猫能否共享空间尚未完成长期观察','愿意缓慢适应，不强行与原住民合笼','午睡搭子｜慢慢亲近｜喜欢毯子'],
  ['pine','松松','猫','狸花','男孩子','约 2 岁 6 个月','cat-04','garden','楼梯侦察员','我先观察一下，再决定要不要贴贴。','谨慎、独立，熟悉后互动积极','新地方我会先巡逻一圈。你不用着急靠近，把玩具放在旁边，等我主动发出邀请就好。','在楼栋公共区域被发现，寻主未果后进入寄养。','4.8 kg','已绝育；本月有例行检查登记，具体报告由站点提供','与幼儿同住未测试；对开关门声音较敏感','有封闭安全空间，能耐心等待适应','独立探索｜爱爬高｜需要耐心'],
  ['rice','米粒','猫','狸花白','女孩子','约 10 个月','cat-05','warm','贴贴实习生','摸摸可以，先让我闻闻你的手。','亲人、活泼，会主动蹭熟人','熟悉以后我会用脑袋轻轻碰你的手。陪我玩一会儿，再让我自己休息，就是很好的下午。','幼猫时期由社区志愿者救助，在寄养家庭长大。','3.1 kg','已绝育；免疫记录已登记，仍需核对原始凭证','换粮后的耐受情况需持续记录；陌生猫相处待确认','每天安排互动，接受幼猫阶段的精力和探索','亲人小猫｜爱玩逗猫棒｜成长中'],
  ['wheat','麦麦','猫','棕色虎斑','女孩子','约 8 个月','cat-06','garden','好奇心满格','我的问题很多，先从你的鞋带开始。','好奇、活泼，喜欢追逐玩具','什么东西在动？让我看看。玩累了我会找一个安静角落充电，醒来又是新的探险时间。','与同窝幼猫被临时安置，目前在站点适应室内生活。','2.8 kg','免疫程序仍在按记录推进；绝育安排需与站点确认','尚未完成成年体型评估；与幼儿互动需监督','了解幼猫照护，能安排后续免疫与绝育沟通','精力充沛｜幼猫｜需要陪玩'],
  ['tea','乌龙','猫','狸花','男孩子','约 5 岁','cat-07','sun','成熟稳重派','不急，我们还有很多个普通的下午。','安静、亲人，节奏稳定','你下班回来时，我会在熟悉的位置等一会儿。不用一直逗我，安安静静坐在一起也很好。','原寄养点调整，由合作志愿者转入站点继续寻找家庭。','4.9 kg','已绝育；有口腔检查待复核项目，费用和安排需提前沟通','不保证与其他动物兼容；口腔护理需求待专业确认','接受成年动物的持续照护，愿意配合复查','成年伙伴｜安静｜需复查沟通'],
  ['cream','奶盖','猫','奶油白','男孩子','约 3 岁 6 个月','cat-08','sun','表情管理失败','看起来有点严肃，其实在等你坐下。','温和、慢热，不喜欢被突然抱起','我表情变化不大，喜欢不喜欢要看行动。熟悉后，我会选择在离你不远的地方坐下。','通过原主人求助转入寄养，正在寻找稳定的长期照护。','4.3 kg','已绝育；需进一步核对眼部与呼吸道检查记录','日常清洁和复查需求须当面确认，不能凭外表推断健康','能接受定期清洁与健康记录核对','温柔慢热｜重视日常清洁｜稳定陪伴'],
  ['cola','可乐','狗','金色','男孩子','约 3 岁','dog-01','warm','散步气氛组','出门的快乐，我可以分你一大半。','亲人、活泼，学习时注意力较好','看见牵引绳就会期待出门。散步时我想闻很多地方，你愿意陪我慢一点吗？','在社区附近被救助，经过寻主流程未找到原照护人。','24 kg','已绝育；有免疫登记，狂犬疫苗凭证需见面核对','遇到自行车容易兴奋；独处时长仍需逐步观察','能提供规律遛狗时间，愿意持续练习牵引礼仪','运动搭子｜需要遛狗｜愿意学习'],
  ['cloud','云朵','狗','棕白','女孩子','约 2 岁','dog-02','sun','聪明小雷达','今天的新任务，是认识你。','聪明、敏感，运动需求较高','新指令我学得很认真，但也会被路边的新鲜气味分心。希望你愿意和我练习，而不是只看我聪不聪明。','原家庭无法满足活动需求，经沟通转交救助站安置。','17 kg','已绝育；既往免疫信息已登记，待核对原件','对快速移动目标的反应较强；猫狗相处需专业评估','稳定的活动与训练安排，家庭成员共同参与','高活动需求｜爱学习｜敏感'],
  ['cookie','曲奇','狗','三色','女孩子','约 4 岁','dog-03','warm','气味收藏家','这条路我认识，但还想再闻一次。','外向、亲人，嗅闻兴趣强','你看风景，我闻路边。遇到新气味我会停下来很久，请给我一点探索世界的时间。','在公园周边被发现，寄养观察后进入领养流程。','11 kg','已绝育；本月体检有登记，耳部护理需求待核实','受到气味吸引时可能拉绳，独处表现还在观察','全程牵引出门，能接受持续的日常练习','嗅闻达人｜亲人｜需牵引练习'],
  ['bean','豆包','狗','黑色','男孩子','约 5 岁','dog-04','garden','慢生活合伙人','不用走很快，陪我看看路边就好。','温和、亲人，活动节奏较慢','比起跑很远，我更喜欢轻松走一小段，再在你脚边休息。我们慢慢熟悉对方的生活节奏。','原照护人因生活变动求助，暂住在志愿者家庭。','8 kg','已绝育；需核对呼吸与皮肤检查记录，不承诺无照护负担','运动耐受和日常清洁安排应与兽医、站点共同确认','理解短鼻犬照护需求，能够承担复查与日常照护','成年犬｜慢节奏｜有照护要求'],
  ['potato','土豆','狗','浅棕','女孩子','约 2 岁 8 个月','dog-06','sun','小短腿巡逻员','腿不长，想陪你的路很长。','亲人、好奇，遇陌生狗先观察','我喜欢坐在门边看你忙。出门时走走停停，回家再找个舒服的角落睡一觉。','由合作寄养家庭接力照顾，现开放预约沟通。','10.5 kg','已绝育；皮肤与呼吸情况需结合检查记录确认','与猫同住尚无可靠记录；换环境后的独处反应待观察','有规律照护时间，能理解体型与身体结构带来的需求','好奇小伙伴｜需要稳定作息｜预约沟通'],
  ['pancake','年糕','狗','黄白','男孩子','约 1 岁 6 个月','dog-07','garden','小短腿大计划','今天也想成为你回家的理由。','活泼、亲人，有主见','想一起散步，也想自己选一小段路线。你愿意温柔又坚定地陪我练习，我就愿意慢慢学。','在寄养家庭完成基础适应，由站点协助寻找长期家庭。','11.8 kg','已绝育；免疫与基础检查记录待交接核实','容易兴奋，尚未建立稳定独处习惯；不保证零吠叫','有耐心做日常训练，家庭可接受过渡期','活力短腿｜有主见｜需要练习'],
];
export const extraPets=entries.map(([id,name,species,coat,sex,age,asset,stationId,persona,mood,character,intro,rescueStory,weight,health,unknown,needs,tags],index)=>({
 id,name,species,coat,sex,age,image:image(asset),stationId,persona,mood,character,intro,rescueStory,weight,
 health:'虚构示例记录：'+health,unknown,needs,tags:tags.split('｜'),status:'available',confirmed:true,active:true,
 arrivalDate:`2026-09-${String(4+index).padStart(2,'0')}`,
 observations:[`09/${String(4+index).padStart(2,'0')} · 入站观察：${character}。`,`09/${String(8+index).padStart(2,'0')} · 熟悉环境后：${intro}`,`10/08 · 领养沟通提示：${unknown}。`],
 agentVoice:species==='猫'?'第一人称、轻松克制，不用卖惨催促领养。围绕实际观察回应，不把未知项包装成保证。':'第一人称、友好直接。介绍互动方式时同时说明活动与照护需求，不仅强调可爱。',
 gallery:id==='potato'?[image('dog-06'),image('dog-05')]:[image(asset)],
}));
export function enrichCatalog(state) {
 for(const pet of extraPets) {
  if(state.pets.some(p=>p.id===pet.id))continue;
  const copy=structuredClone(pet),station=stationFor(copy);
  copy.station=station.name;copy.city=station.city;state.pets.push(copy);
 }
 // Fill new metadata only; never overwrite the user's edited facts or status.
 const originals={
  orange:{rescueStory:'在小区车库被发现，居民照料一段时间后进入寄养。刚进站时怕脚步声，熟悉志愿者后会主动靠近。',weight:'3.9 kg',persona:'慢热小黏猫',arrivalDate:'2026-09-02'},
  tabby:{rescueStory:'在社区花园长期被固定投喂，进入寄养后逐渐适应室内环境。喜欢待在窗边观察，不太喜欢被抱起。',weight:'3.7 kg',persona:'安静观察员',arrivalDate:'2026-08-19'},
  dog:{rescueStory:'在居民区附近被志愿者接力照顾，寻主未果后进入救助站。熟悉牵引绳，看到照护者会摇尾巴。',weight:'22 kg',persona:'快乐小太阳',arrivalDate:'2026-08-28'},
 };
 for(const [id,fields] of Object.entries(originals)){const pet=state.pets.find(p=>p.id===id);if(pet)for(const [key,value] of Object.entries(fields))pet[key]??=value;}
 for(const a of state.applications||[])if(a.sample){
  a.email??=a.contact||'demo@example.com';a.phone??='13800000000';a.wechat??='demo_'+a.petId;
  a.applicantProfile??={answers:{work:{text:'工作日 9:00–18:00，通勤约半小时；白天离家较久。'},routine:{text:'通常 7:00 起床、23:00 休息，周末作息相近。'},free:{text:'工作日每天约 1–2 小时，周末可安排更多陪伴。'},expectation:{text:'希望慢慢建立信任，会与站点确认适应、照护和原住民相处安排。'}},memory:a.conditions||'愿意持续回访和沟通',submittedAt:a.createdAt};
 }
 state.catalogRevision=1;
 addAdopterHistory(state);
 return state;
}
function addAdopterHistory(s,now=Date.now()) {
 if(s.sampleStory!=='station-day'||s.adopterHistoryRevision)return s;
 const adopter=s.demoAdopters?.find(a=>a.id==='station-demo-toast');if(!adopter)return s;
 const pet={...structuredClone(s.pets.find(p=>p.id==='ash')),id:'nannan-mochi',name:'糯米',status:'adopted',active:false,adoptionDay:60,sample:true};
 s.pets.push(pet);
 const application={id:'station-history-nannan',petId:pet.id,adopterId:adopter.id,name:adopter.nickname,city:'杭州',contact:'nannan.demo@example.com',conditions:'已有成年猫照护经验，保持定期回访。',questions:'',stage:3,createdAt:now-66*DAY,sample:true};
 s.applications.push(application);
 for(const [day,score] of [[30,4],[60,5]])s.ratings.push({id:'nannan-rating-'+day,adopterId:adopter.id,applicationId:application.id,petId:pet.id,stationId:pet.stationId,score,day,at:now-(60-day)*DAY,note:'虚构回访依据：按约提交观察，后续照护安排已沟通；仅本人及负责站点可见。',sample:true});
 s.adopterHistoryRevision=1;return s;
}
export const storyCards=[
 {id:'first-cat',title:'阿宁的第一次养猫',tag:'领养前 · 沟通与见面',description:'喜欢安静的猫，白天上班，正在认真了解汤圆。4 段对话、偏好记忆和一份待见面的申请。',image:image('cat-01'),route:'messages'},
 {id:'first-week',title:'小禾与米粒的第一周',tag:'到家后 · 有进展，也有担心',description:'从躲在角落到主动靠近，7 天里有记录、有待确认问题，也有救助者的回复。',image:image('cat-05'),route:'followup',petId:'rice'},
 {id:'dog-life',title:'阿远与可乐的两个月',tag:'长期陪伴 · 回访与定期评价',description:'遛狗、适应独处、持续回访。看看 2 次评价如何留下依据，以及授权后的个人主页。',image:image('dog-01'),route:'public-profile'},
 {id:'station-day',title:'暖爪救助站的一天',tag:'救助者身份 · 完整工作台',description:'4 份进行中的申请、2 个到家家庭、待回复回访、到期评价和待确认档案。进入即可处理。',image:image('cat-03'),route:'work'},
];
export function createStory(id,now=Date.now()) {
 const card=storyCards.find(s=>s.id===id);if(!card)throw new Error('未知示例故事');
 if(id==='station-day')return createStationStory(now);
 const s=enrichCatalog(freshState());initializeDiscovery(s);initializeCommunity(s);
 s.sampleStory=id;s.sampleStoryTitle=card.title;s.consent=true;
 const nickname=id==='first-cat'?'阿宁':id==='first-week'?'小禾':'阿远';
 s.account={id:'story-user-'+id,nickname,identityToken:'DEMO-0001',verification:'demo',covenantVersion:COVENANT_VERSION,acceptedAt:now-70*DAY};
 s.identityRegistry={'DEMO-0001':s.account.id};s.demoPerson=nickname;
 const stamp=(days,h=0)=>now-days*DAY+h*3600000;
 const talk=(petId,lines)=>{s.messages[petId]=lines.map(([from,text],i)=>({id:`${id}-${petId}-${i}`,from,text,at:stamp(2, i/4),sample:true}));s.read[petId]=0;};
 const memory=(text,type='preference')=>({id:'story-memory-'+text,text,type,source:'虚构人物在示例对话中明确表达',at:stamp(3)});
 const application=(petId,stage,days,conditions,questions)=>({id:'story-app-'+petId,petId,adopterId:s.account.id,name:nickname,city:'杭州',contact:`${id}@example.com`,conditions,questions,stage,createdAt:stamp(days),sample:true});
 if(id==='first-cat'){
  s.memory=[memory('所在城市：杭州','condition'),memory('偏好安静的性格'),memory('喜欢黑白'),memory('工作日白天外出','condition'),memory('第一次养宠','condition')];
  s.following=['tangyuan','tabby','ash'];
  talk('tangyuan',[['pet','你好，我是汤圆的 AI 分身。听说你喜欢黑白猫，我先替自己打个招呼。'],['user','我第一次养猫，白天要上班，晚上七点左右回家。'],['pet','我先记下你的作息。救助者观察到我会自己在窗边待着，但换到新家能否适应独处还要慢慢确认。你家里有安全的封窗吗？'],['user','有封窗，室友也同意。我希望猫安静一点，不一定非要抱着。'],['pet','这点很适合继续了解：我熟悉后会靠近人，但不喜欢久抱。我们可以先约一次见面，也看看你准备的生活空间。'],['user','周六下午可以去见它吗？我想先看看它和陌生人相处。'],['pet','领养意向已经提交并通过初步沟通，当前等待见面。具体时间仍需要你和站点负责人确认。']]);
  talk('tabby',[['pet','我是芝麻的 AI 分身。喜欢安静陪伴的话，也可以先认识一下我。'],['user','你会一直粘着人吗？'],['pet','照护者的观察是我比较独立，喜欢靠近熟人，但不是一直求抱抱。与幼儿同住的情况还没有确认。']]);
  talk('ash',[['pet','阿灰来报到。今天的主要工作是找个阳光刚好的位置。'],['user','年纪大一点是不是就更适合新手？'],['pet','年龄不能直接代表照护难度。我有活动量偏少的记录，需要结合体检进一步了解；如果愿意继续认识，可以让救助者详细说明。']]);
  talk('cola',[['pet','我是可乐的 AI 分身，喜欢出门慢慢闻一闻。你平时能给散步留多少时间？'],['user','现在还没有稳定遛狗时间，这次先考虑猫。'],['pet','明白，生活节奏合适更重要。我会尊重你的选择，暂停这轮主动联系。']]);
  s.muted=['cola'];
  s.applications=[application('tangyuan',1,3,'杭州合租，两位室友已同意；阳台已封窗；工作日 9:00–18:00 外出，晚间和周末在家。','第一次养猫；希望先了解适应环境时的反应、疫苗凭证和交接用品。')];
  s.reviews=[{id:'story-review-cola',petId:'cola',outcome:'declined',at:stamp(1),summary:'阿宁明确表示目前没有稳定遛狗时间，先考虑猫。已尊重选择并暂停本轮联系。',next:'后续优先选择明确有规律遛狗时间的示例对象，不改变动物的活动需求。',candidate:'小林（虚构）· 杭州 · 早晚可遛狗 · 家人同意',preview:'你好，我是可乐的 AI 分身。听说你喜欢户外散步，想先聊聊你的日常节奏。'}];
 } else {
  const petId=id==='first-week'?'rice':'cola',p=s.pets.find(p=>p.id===petId),isCat=id==='first-week';
  s.day=isCat?7:60;p.adoptionDay=s.day;p.status='adopted';p.active=false;s.activeStationId=p.stationId;
  s.memory=[memory('所在城市：杭州','condition'),memory(isCat?'喜欢狸花白':'喜欢狗'),memory('家庭成员同意领养','condition')];
  s.following=[petId];
  s.applications=[application(petId,3,s.day+6,isCat?'与家人同住，封窗已完成，单独准备安静房间；每天安排互动时间。':'两位家庭成员轮流照护，能安排早晚出门；已沟通独处训练和医疗预算。','已见面并核对交接清单，后续按约定回访。')];
  const records=isCat?[
   [1,'到家后先待在纸箱后面，晚上出来喝了一点水。我没有追着摸，给它留了安静的房间。','收到，先按交接时约定的方式观察。请继续记录饮水、进食和活动；有异常及时联系专业人员。',false,false],
   [2,'今天早上用了猫砂，吃了一些原来那款粮。有人经过门口还是会躲，但听到我的声音会看过来。','谢谢具体的记录。先维持熟悉的环境，别急着增加互动强度。',false,false],
   [3,'愿意追逗猫棒两三分钟了，玩完自己回窝。第一次在我旁边睡了一小会儿。','这是一段你观察到的进展，继续尊重它想休息的信号。',false,true],
   [5,'饭量比昨天少了一些，我有点担心。精神看起来还可以，想请你们一起确认。','已收到，会人工跟进。请补充开始变化的时间和实际食量；持续异常或出现其他不适时及时联系兽医。',true,false],
   [7,'今天会主动过来蹭手，也愿意在客厅转一圈。最近进食变化的记录已补充，想确认下一步怎么观察。','',true,false],
  ]:[
   [1,'第一晚会在门边走来走去。我照着交接清单布置了休息区，短暂出门闻了闻就回家。','收到，先稳定作息，记录进食、休息和出门的反应。有困难随时沟通。',false,false],
   [7,'牵引时还会冲着新气味走。今天练习了几次停下来等我，回家后在垫子上睡着了。','不要求一次做到，保持温和一致的引导，出门时注意牵引和环境。',false,true],
   [14,'尝试短时间独处时有叫声，邻居提醒了我。我担心影响别人，想和你们商量后续安排。','已记录，需要继续了解具体时长和触发情况。我们会人工沟通，必要时请专业训练人员评估。',true,false],
   [30,'这一个月坚持了早晚外出。独处仍在练习，家人分担照护，记录都整理给你们了。','已完成本期回访。日常照护记录完整，独处适应仍需持续跟进，下期继续核对。',false,true],
   [60,'第二个月的反馈来了：出门等人的次数多了，独处时的情况也做了记录。我把下月的出差照护安排一起同步。','本期记录已收到，临时照护人和交接安排已沟通。继续按约定回访，有变化及时联系。',false,true],
  ];
  s.followups=records.map(([day,text,reply,attention,allowed],i)=>({id:`story-feedback-${id}-${day}`,petId,adopterId:s.account.id,stationId:p.stationId,day,text,reply,attention,resolved:!!reply,summary:attention?'本条观察仍需人工确认；不能据此作出诊断。':'已记录用户本次观察，不代表已独立核实动物状态。',at:stamp(s.day-day,-2),repliedAt:reply?stamp(s.day-day,-1):undefined,media:[{type:'photo',src:p.image}],publication:{allowed,caption:isCat?'从一点点信任开始':'把普通的散步，走成我们的日常',consentedAt:stamp(s.day-day),sample:true},sample:true}));
  talk(petId,[['pet',`我是${p.name}的 AI 分身。交接完成后，我会继续陪你整理日常；实际情况需要你主动记录。`],['user',isCat?'它已经愿意在我身边待一会儿了，但吃得少的情况还想问问。':'这两个月过得很快，我把遛狗和独处的记录都交给站点了。'],['pet',isCat?'可以把开始变化的时间、实际进食和其他观察一起提交。站点会看到你主动发送的回访，需要专业判断时请及时联系兽医。':'我看到你已提交的本地回访记录。站点评价与后续安排可以在「我的」查看，公开的日常只显示你逐条授权的部分。']]);
  if(!isCat)s.ratings=[{day:30,score:4,note:'本期按时回访，能提供连续观察。独处适应仍有困难，已约定继续记录与沟通。'},{day:60,score:5,note:'本期回访及时，照护分工和临时安排清晰；对上一期问题持续反馈。该评分仅代表本期人工评价。'}].map(r=>({...r,id:'story-rating-'+r.day,adopterId:s.account.id,applicationId:s.applications[0].id,petId,stationId:p.stationId,at:stamp(s.day-r.day),sample:true}));
 }
 s.location={...cityLocations['杭州'],source:'demo'};
 return s;
}
function createStationStory(now) {
 const s=createStory('dog-life',now),cat=createStory('first-week',now);
 s.role='rescue';s.sampleStory='station-day';s.sampleStoryTitle='暖爪救助站的一天';s.activeStationId='warm';
 s.demoAdopters=[structuredClone(s.account),structuredClone(cat.account)];
 const rice=s.pets.find(p=>p.id==='rice');rice.status='adopted';rice.active=false;rice.adoptionDay=60;
 const dayMap={1:1,2:7,3:14,5:30,7:60};
 s.applications.push({...cat.applications[0],createdAt:now-66*DAY});
 for(const f of cat.followups){
  const day=dayMap[f.day];s.followups.push({...f,day,at:now-(60-day)*DAY-7200000,repliedAt:f.reply?now-(60-day)*DAY-3600000:undefined});
 }
 // Two independent households need a human reply, not an automatic health judgement.
 const latestDog=s.followups.find(f=>f.petId==='cola'&&f.day===60);
 Object.assign(latestDog,{text:'下周有三天出差，家人临时不能照护。我想先和站点确认熟悉的临时照护方案，不想仓促送去陌生环境。',attention:true,resolved:false,reply:'',publication:{allowed:false},summary:'照护安排发生变化，需要站点人工沟通；尚未确认临时方案。'});
 s.ratings=s.ratings.filter(r=>r.day!==60);
 s.ratings.push({id:'station-rating-rice-30',adopterId:cat.account.id,applicationId:cat.applications[0].id,petId:'rice',stationId:'warm',score:4,day:30,at:now-30*DAY,note:'前期回访较完整；进食变化已提示继续观察并及时寻求专业帮助，下期核对后续情况。',sample:true});
 const queue=[
  ['orange','阿宁',0,'西湖区合租，室友同意；封窗完成，工作日白天外出。','第一次养猫，想了解独处适应与交接物品。',2],
  ['tangyuan','小夏',0,'与伴侣同住，已沟通家庭分工；有独立房间供适应。','家里有一只成年猫，希望了解隔离与见面安排。',1],
  ['toast','南南',1,'家庭成员同意，照护时间充足，愿意接受慢热适应期。','初审已通过，周末见面的具体时间待站点确认。',4],
  ['cookie','林林',2,'每天可安排两次外出，已经见面，正在核对牵引用品与照护交接。','需确认免疫凭证和交接清单，尚未实际带回家。',6],
 ];
 for(const [petId,name,stage,conditions,questions,days] of queue){
  const adopterId='station-demo-'+petId;
  s.demoAdopters.push({id:adopterId,nickname:name,verification:'demo'});
  s.applications.push({id:'station-application-'+petId,petId,adopterId,name,city:'杭州',contact:`${petId}.demo@example.com`,conditions,questions,stage,createdAt:now-days*DAY,sample:true});
 }
 s.pets.push({id:'station-draft-cat',name:'待命名小伙伴',species:'猫',coat:'待确认',sex:'待确认',age:'待确认',image:image('cat-06'),tags:['新入站','待确认'],mood:'先把真实的我，认真记录下来。',intro:'救助者还在确认我的资料，暂时不会参与新的领养匹配。',character:'刚入站，性格待观察',health:'尚未核对健康记录',unknown:'年龄、性别、免疫与绝育情况均待核实',needs:'待救助者确认',status:'paused',confirmed:false,active:false,stationId:'warm',station:'暖爪救助站',city:'杭州',observations:['虚构入站草稿：照片已提交，口述资料还在确认。'],sample:true});
 s.reviews=[{id:'station-review',petId:'orange',outcome:'no_reply',at:now-DAY,summary:'上一位示例用户在招呼后没有回复，原因未知。未连续追问，也没有推断对方讨厌猫。',next:'下一轮优先考虑明确愿意耐心陪伴慢热猫、且家人同意的对象。事实档案保持不变。',candidate:'阿宁（虚构）· 杭州 · 第一次养猫 · 愿意慢慢认识',preview:'你好，我是橘子的 AI 分身。听说你愿意耐心认识一个慢热的小伙伴，想先跟你说声你好。'}];
 return addAdopterHistory(s,now);
}
