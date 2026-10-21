import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,extractMemory,mergeMemory,recommendations,greet,reviewConversation,advanceApplication,summarizeFeedback} from '../dist/domain.js';

test('主动招呼必须获得许可，且同一会话不重复招呼',()=>{
  const s=freshState();assert.equal(greet(s),null);
  s.consent=true;assert.equal(greet(s,'orange').id,'orange');
  assert.equal(greet(s,'orange'),null);
  s.consent=false;assert.equal(greet(s,'tabby'),null);
});
test('已暂停、未确认、已领养和用户屏蔽的动物不参与主动匹配',()=>{
  const s=freshState();s.pets[0].status='adopted';s.pets[1].confirmed=false;s.muted.push('dog');
  assert.deepEqual(recommendations(s),[]);
});
test('明确偏好影响推荐顺序，否定偏好不会被当作喜欢',()=>{
  const s=freshState();mergeMemory(s,extractMemory('我喜欢狸花，最好安静一点'));
  assert.equal(recommendations(s)[0].pet.id,'tabby');
  const negative=extractMemory('我不喜欢橘猫，也不考虑狗');
  assert.ok(negative.some(m=>m.text==='不喜欢橘色'));
  assert.ok(!negative.some(m=>m.text==='喜欢橘色'));
  mergeMemory(s,negative);
  assert.ok(!recommendations(s).some(m=>m.pet.id==='orange'||m.pet.id==='dog'));
});
test('用户改变明确偏好时，旧的相反记忆被替换',()=>{
  const s=freshState();mergeMemory(s,extractMemory('我喜欢橘猫'));mergeMemory(s,extractMemory('我不喜欢橘猫'));
  assert.equal(s.memory.filter(m=>m.text==='喜欢橘色').length,0);
  assert.equal(s.memory.filter(m=>m.text==='不喜欢橘色').length,1);
  mergeMemory(s,extractMemory('我不考虑狗'));mergeMemory(s,extractMemory('我喜欢狗'));
  assert.equal(s.memory.some(m=>m.text==='不考虑狗'),false);
  assert.equal(recommendations(s)[0].pet.id,'dog');
});
test('复盘不改写动物事实，未回复保持不确定',()=>{
  const s=freshState();const before=structuredClone(s.pets[0]);
  const r=reviewConversation(s,'orange');
  assert.match(r.summary,/原因未知/);
  assert.deepEqual(s.pets[0],before);
  assert.ok(s.muted.includes('orange'));
  assert.match(r.preview,/橘子/);
});
test('交接完成停止领养匹配并结束其他未完成申请',()=>{
  const s=freshState();s.consent=true;
  s.applications=[{id:'a',petId:'orange',stage:0},{id:'b',petId:'orange',stage:0}];
  assert.equal(advanceApplication(s,'a'),true);assert.equal(s.pets[0].status,'available');
  advanceApplication(s,'a');advanceApplication(s,'a');
  assert.equal(s.pets[0].status,'adopted');assert.equal(s.applications[1].stage,-1);
  assert.equal(advanceApplication(s,'a'),false);assert.equal(greet(s,'orange'),null);
  assert.equal(s.day,1);
});
test('已结束申请不能推进，缺失申请不影响状态',()=>{
  const s=freshState();s.applications=[{id:'a',petId:'orange',stage:-1}];
  assert.equal(advanceApplication(s,'a'),false);assert.equal(advanceApplication(s,'missing'),false);
  assert.equal(s.pets[0].status,'available');
});
test('风险反馈进入人工关注，正常描述不代表实际已核实',()=>{
  assert.equal(summarizeFeedback('它不吃东西，我很担心').attention,true);
  const result=summarizeFeedback('今天开始出来走走了');assert.equal(result.attention,false);assert.match(result.summary,/不代表已核实/);
});
