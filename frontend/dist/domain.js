import { knowledgeReply } from './pet-knowledge.js';
export const STORAGE_KEY = 'pawletter.demo.v1';
export const stages = ['待审核', '待见面', '待交接', '已完成'];
export const seedPets = [
  { id: 'orange', name: '橘子', species: '猫', coat: '橘色', sex: '男孩子', age: '约 1 岁', image: './assets/orange.jpg', tags: ['慢热小黏猫', '已绝育', '适合耐心的你'], mood: '慢热，是我认真认识你的方式。', intro: '刚见面时，我会先偷偷观察你。等熟悉了，就想在你身边找个舒服的位置，一起发发呆。', character: '慢热、熟悉后亲人', health: '示例记录：已绝育；疫苗记录待核实', unknown: '与狗相处的情况尚未确认', needs: '愿意耐心陪伴适应，家庭成员同意领养', status: 'available', confirmed: true, active: true, station: '暖爪救助站', city: '杭州', observations: ['示例观察：陌生人靠近时会先躲开，熟悉后愿意主动靠近。'] },
  { id: 'tabby', name: '芝麻', species: '猫', coat: '狸花', sex: '女孩子', age: '约 2 岁', image: './assets/tabby.jpg', tags: ['安静观察员', '独立又温柔', '待认识'], mood: '把安静的一半，分给你。', intro: '我喜欢有阳光的窗边，也喜欢不慌不忙的陪伴。你忙你的，我在旁边就很好。', character: '安静、独立', health: '示例记录：已绝育；其他记录待确认', unknown: '与幼儿共同生活的情况待确认', needs: '提供安全的室内环境，愿意了解猫的边界', status: 'available', confirmed: true, active: true, station: '暖爪救助站', city: '杭州', observations: ['示例观察：喜欢独自休息，会主动靠近熟悉的照护者。'] },
  { id: 'dog', name: '布丁', species: '狗', coat: '金色', sex: '男孩子', age: '约 2 岁', image: './assets/dog.jpg', tags: ['快乐小太阳', '热爱散步', '亲人'], mood: '你负责出门，我负责开心。', intro: '散步、闻闻草地、陪你走一段路，是我每天最期待的事。希望你也愿意给散步留一点时间。', character: '活泼、亲人', health: '示例记录：健康及免疫情况待确认', unknown: '与猫相处的情况待确认', needs: '每天能够安排遛狗与陪伴时间', status: 'available', confirmed: true, active: true, station: '暖爪救助站', city: '杭州', observations: ['示例观察：对户外活动表现出明显兴趣。'] },
];
export function freshState() {
  return {
    version: 1, role: 'user', consent: null, pets: structuredClone(seedPets),
    memory: [{ id: 'm-city', text: '所在城市：杭州', type: 'condition', source: '示例资料 · 可修改', at: Date.now() }],
    messages: {}, read: {}, muted: [], following: [], applications: [], reviews: [], followups: [],
    day: 1, wave: 0, demoPerson: '小禾', draft: null,
  };
}
export function activePet(state, id) { return state.pets.find(p => p.id === id); }
export function recommendations(state) {
  const text = state.memory.map(m => m.text).join(' ');
  return state.pets.filter(p => p.active && p.confirmed && p.status === 'available' && !state.muted.includes(p.id)).map(p => {
    const reasons = [];
    let score = 0;
    const preferredSpecies = text.includes('喜欢狗') ? '狗' : text.includes('喜欢猫') ? '猫' : null;
    if (preferredSpecies) { score += p.species === preferredSpecies ? 5 : -8; if (p.species === preferredSpecies) reasons.push(`你喜欢${p.species}`); }
    if (text.includes('不考虑狗') && p.species === '狗') score -= 30;
    if (text.includes('不考虑猫') && p.species === '猫') score -= 30;
    if (text.includes(`喜欢${p.coat}`)) { score += 8; reasons.push(`符合你对${p.coat}的偏好`); }
    if (text.includes(`不喜欢${p.coat}`)) score -= 30;
    if (text.includes('安静') && p.character.includes('安静')) { score += 5; reasons.push('性格偏安静'); }
    if (text.includes('亲人') && p.character.includes('亲人')) { score += 3; reasons.push('熟悉后愿意亲近人'); }
    if (p.city && text.includes(p.city)) { score += 1; reasons.push('与你填写的城市相同'); }
    const lifestyle=state.account?.lifestyle?.confirmedAt?state.account.lifestyle.answers:null;
    if(lifestyle){
      const energetic=/活泼|运动需求较高|高活动需求|每天.*遛狗/.test(p.character+' '+p.needs);
      if(lifestyle.free?.value==='under1'&&energetic){score-=6;reasons.push('你的空闲时间较少，需先确认照护安排');}
      if(lifestyle.free?.value==='over2'&&energetic){score+=2;reasons.push('你确认有较充足的照护时间');}
      if(lifestyle.expectation?.value==='quiet'&&/安静|温和/.test(p.character)){score+=4;reasons.push('符合你期待的安静陪伴');}
      if(lifestyle.expectation?.value==='active'&&energetic){score+=3;reasons.push('符合你期待的一起活动');}
      if(lifestyle.work?.value==='long'&&/独立/.test(p.character)){score+=2;reasons.push('性格较独立，独处安排仍需确认');}
      if(lifestyle.routine?.value==='shift'){if(/稳定作息|规律/.test(p.needs))score-=3;reasons.push('你的作息会变化，需与站点确认照护衔接');}
    }
    return { pet: p, score, reasons: reasons.length ? reasons : ['先了解彼此，适配条件仍需确认'] };
  }).filter(x => x.score > -10).sort((a,b) => b.score - a.score);
}
export function extractMemory(text) {
  const result = [];
  const add = (value, type='preference') => result.push({id: crypto.randomUUID(), text:value, type, source:'聊天中明确表达', at:Date.now()});
  const coatNames = ['橘色', '狸花白', '狸花', '黑白', '灰色', '奶油白', '棕色虎斑', '金色', '棕白', '三色', '黑色', '浅棕', '黄白'];
  for (const name of coatNames) {
    const alias = name === '橘色' ? '(?:橘色|橘猫)' : name==='狸花'?'狸花(?!白)':name;
    if (new RegExp(`(?:不喜欢|不想养|不考虑)[^，。！？\\n]{0,4}${alias}`).test(text)) add(`不喜欢${name}`);
    else if (new RegExp(`(?:喜欢|想养|偏爱)[^，。！？\\n]{0,8}${alias}`).test(text)) add(`喜欢${name}`);
  }
  if (/(?:不喜欢|不考虑|不想养)狗/.test(text)) add('不考虑狗');
  else if (/(?:喜欢|想养|考虑)(?:一只)?狗/.test(text)) add('喜欢狗');
  if (/(?:不喜欢|不考虑|不想养)猫/.test(text)) add('不考虑猫');
  else if (/(?:喜欢|想养|考虑)(?:一只)?猫/.test(text)) add('喜欢猫');
  if (/(?:喜欢|希望|想要|最好|偏好).{0,10}安静/.test(text) && !/不喜欢安静/.test(text)) add('偏好安静的性格');
  if (/(?:喜欢|希望|想要|最好|偏好).{0,10}亲人/.test(text)) add('偏好亲人的性格');
  if (/(第一次养|没有养过|养宠新手)/.test(text)) add('第一次养宠', 'condition');
  if (/(白天上班|白天不在家|晚上才回家)/.test(text)) add('工作日白天外出', 'condition');
  if (/家里有狗/.test(text)) add('家中已有狗', 'condition');
  if (/家里有猫/.test(text)) add('家中已有猫', 'condition');
  return result;
}
export function mergeMemory(state, items) {
  for (const item of items) {
    const opposite = item.text.startsWith('不喜欢') ? item.text.replace('不喜欢','喜欢') : item.text.startsWith('喜欢') ? item.text.replace('喜欢','不喜欢') : null;
    if (opposite) state.memory = state.memory.filter(m => m.text !== opposite);
    if (item.text === '喜欢狗') state.memory=state.memory.filter(m=>m.text!=='不考虑狗');
    if (item.text === '不考虑狗') state.memory=state.memory.filter(m=>m.text!=='喜欢狗');
    if (item.text === '喜欢猫') state.memory=state.memory.filter(m=>m.text!=='不考虑猫');
    if (item.text === '不考虑猫') state.memory=state.memory.filter(m=>m.text!=='喜欢猫');
    if (!state.memory.some(m => m.text === item.text)) state.memory.push(item);
  }
}
export function addMessage(state,id,from,text,extra={}) {
  state.messages[id] ??= [];
  state.messages[id].push({id:crypto.randomUUID(),from,text,at:Date.now(),...extra});
}
export function greet(state, petId) {
  if (state.consent !== true) return null;
  const ranked = recommendations(state).filter(x => !state.messages[x.pet.id]?.length);
  const candidate = petId ? ranked.find(x => x.pet.id === petId) : ranked[0];
  if (!candidate) return null;
  addMessage(state,candidate.pet.id,'pet',`你好呀，我是${candidate.pet.name}的 AI 分身 🐾 ${candidate.pet.mood} 想不想先认识一下我？`, { greeting:true, reasons:candidate.reasons });
  state.wave++;
  return candidate.pet;
}
export function replyFor(pet,text) {
  const knowledge=knowledgeReply(pet,text);if(knowledge)return knowledge;
  if (/肠胃|软便|腹泻|过敏|呕吐/.test(text)) return `目前基础档案记录：${pet.health}。尚未记录你问到的具体情况，需要向救助站确认；不能据此判断我没有相关问题。`;
  if (/习惯|爱好|玩具|吃什么|喂什么|怎么喂|作息/.test(text)) {
    const observations=(pet.observations||[]).filter(note=>/习惯|喜欢|吃|喂|睡|玩|散步|休息/.test(note));
    return observations.length?`救助站在基础档案中记录：${observations.join('；')}。这些记录尚未标注观察日期；具体饮食和照护安排请与站点确认。`:`目前还没有这方面的具体观察记录，可以请救助站补充；已有照护要求是：${pet.needs}。`;
  }
  if (/疫苗|健康|绝育|生病/.test(text)) return `${pet.health}。我不会把未知的情况当成事实；具体记录需要救助者确认。`;
  if (/性格|亲人|慢热|安静/.test(text)) return `${pet.intro} 救助者记录的特点是「${pet.character}」。每个新环境都需要重新适应，我们可以慢慢来。`;
  if (/狗|孩子|小孩|幼儿/.test(text)) return `关于相处情况：${pet.unknown}。这个问题需要救助者进一步确认，不能只凭我的聊天口吻判断哦。`;
  if (/领养|见面|接.*回家/.test(text)) return `很开心你愿意认真了解${pet.name}。可以点下方「我想领养」，确认生活条件后交给救助站审核，再安排见面。`;
  if (/不喜欢|不考虑|不适合/.test(text)) return '谢谢你直接告诉我。适合彼此才最重要，我会尊重你的选择，也会把你明确表达的偏好记下来。';
  if (/喜欢|第一次|白天|上班/.test(text)) return `我记下你明确提到的偏好和生活条件了，可以在「我的记忆」里修改。关于${pet.name}，还需要一起了解：${pet.needs}。`;
  return `收到啦。这是场景式 Demo，目前我能介绍${pet.name}的性格、已有健康记录和领养流程。你也可以试试下面的话题；没有记录的事实，我会请救助者确认。`;
}
export function reviewConversation(state, petId, outcome='no_reply') {
  const pet = activePet(state, petId);
  const review = {
    id:crypto.randomUUID(), petId, at:Date.now(), outcome,
    summary:outcome === 'no_reply' ? '本轮未获得回复，原因未知。不能据此认定用户不喜欢。' : '用户明确表示暂不考虑；尊重选择，停止本轮联系。',
    next:'结束本轮连续触达；寻找其他条件更适配的示例用户。动物事实与角色底线保持不变。',
    candidate:'阿宁 · 杭州 · 明确喜欢慢热的猫 · 家人同意养宠',
  };
  state.reviews.unshift(review);
  if (!state.muted.includes(petId)) state.muted.push(petId);
  review.preview = `你好，我是${pet.name}的 AI 分身。听说你愿意耐心认识一只慢热的小家伙，想和你打个招呼。`;
  return review;
}
export function advanceApplication(state,id) {
  const application = state.applications.find(a=>a.id===id);
  if (!application || application.stage < 0 || application.stage >= 3) return false;
  const pet = activePet(state,application.petId);
  if (!pet || (pet.status === 'adopted' && application.stage !== 3)) return false;
  application.stage++;
  application.updatedAt=Date.now();
  if (application.stage === 3) {
    pet.status='adopted';
    pet.adoptionDay=1;
    state.applications.filter(a=>a.petId===pet.id && a.id!==id && a.stage>=0 && a.stage<3).forEach(a=>a.stage=-1);
    addMessage(state,pet.id,'pet','交接已完成，欢迎开启共同生活。以后也可以在这里记录适应情况，救助者会看到你主动提交的回访。',{system:true});
    state.day=1;
  }
  return true;
}
export function summarizeFeedback(text) {
  const attention = /不吃|不喝|呕吐|受伤|困难|担心|没精神|异常/.test(text);
  return {
    attention,
    summary: attention ? `用户反馈含需要进一步确认的问题：「${text.slice(0,100)}」。已列入救助者待办；演示系统不作诊断。` : `已收到用户观察：「${text.slice(0,120)}」。仅根据本次反馈记录，不代表已核实动物状态。`,
  };
}
