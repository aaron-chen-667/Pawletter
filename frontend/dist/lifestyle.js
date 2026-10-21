import { registerDemo } from './community.js';
export function beginRegistration(state, details) {
  // Validate without allocating an identity or creating an account yet.
  registerDemo(structuredClone(state), details);
  state.registrationDraft={...details,lifestyleDraft:state.registrationDraft?.lifestyleDraft||{}};
}
export function completeRegistration(state) {
  if(!state.registrationDraft)throw new Error('请先阅读并确认领养公约。');
  const next=structuredClone(state);
  registerDemo(next,next.registrationDraft);
  confirmLifestyle(next,next.registrationDraft.lifestyleDraft);
  delete next.registrationDraft;
  Object.assign(state,next);
  delete state.registrationDraft;
}
export const lifestyleQuestions=[
  {key:'work',title:'你平时什么时候上班？一天大约多久不在家？',hint:'可以说说通勤、居家办公或轮班安排。',sample:'工作日朝九晚六，通勤单程半小时，白天大约离家 9 小时。',label:'通常每天离家多久',options:[['unknown','还不确定'],['short','4 小时以内'],['medium','4–8 小时'],['long','8 小时以上']],value:'long'},
  {key:'routine',title:'你的作息是什么样的？通常什么时候起床、休息？',hint:'夜班、轮班或周末作息不同，都可以告诉我。',sample:'通常早上七点起床，晚上十一点睡觉，周末也差不多。',label:'作息规律',options:[['unknown','还不确定'],['regular','比较规律'],['shift','经常轮班或变化']],value:'regular'},
  {key:'free',title:'每天能固定留给它多少时间？',hint:'包括陪伴、喂食、清洁；养狗还需要安排外出。',sample:'工作日晚上有一个半小时空闲，周末能安排更多时间。',label:'每天可安排的照护时间',options:[['unknown','还不确定'],['under1','不足 1 小时'],['one2','1–2 小时'],['over2','2 小时以上']],value:'one2'},
  {key:'expectation',title:'你期待怎样的小伙伴，又有哪些事情暂时做不到？',hint:'比如安静陪伴、一起运动、慢热适应，以及能否安排每天外出。',sample:'希望是安静的成年猫，可以慢慢熟悉，不期待马上亲近。工作日很难安排多次外出。',label:'目前更期待的相处方式',options:[['unknown','先了解再决定'],['quiet','安静陪伴'],['active','一起活动或运动']],value:'quiet'},
];
export function confirmLifestyle(state,answers) {
  if(!state.account)throw new Error('请先创建领养账号。');
  const profile={answers:{},confirmedAt:Date.now()};
  for(const q of lifestyleQuestions){
    const a=answers[q.key];
    if(!a?.text?.trim()||!q.options.some(([v])=>v===a.value))throw new Error('请补充每一项回答，并确认整理结果。');
    profile.answers[q.key]={text:a.text.trim().slice(0,500),value:a.value,...(a.audio?{audio:structuredClone(a.audio)}:{})};
  }
  state.account.lifestyle=profile;
  delete state.account.lifestyleDraft;
  return profile;
}
