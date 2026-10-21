import { stationFor } from './discovery.js';
export const knowledgeTopics=[
  {key:'habits',label:'生活习惯',pattern:/习惯|作息|睡|起床|猫砂|厕所|独处|出门|散步/},
  {key:'likes',label:'喜好与互动',pattern:/喜欢|喜好|爱好|玩|逗猫|摸|抱|亲近|怕|躲/},
  {key:'diet',label:'饮食与照护',pattern:/饮食|吃|喂|粮|食物|罐头|喝水|换粮/},
  {key:'health',label:'健康观察',pattern:/肠胃|排便|便便|软便|拉肚|腹泻|呕吐|过敏|生病|健康|疫苗|绝育|症状|食欲|精神/},
  {key:'other',label:'其他观察',pattern:null}
];
export function organizeObservation(text) {
  const result=Object.fromEntries(knowledgeTopics.map(q=>[q.key,'']));
  for(const line of text.trim().split(/(?<=[。！？；\n])/).filter(x=>x.trim())){
    // Preserve verbatim statements, including negations. Health takes precedence.
    const topic=[knowledgeTopics[3],...knowledgeTopics.filter(q=>q.key!=='health'&&q.pattern)].find(q=>q.pattern.test(line))||knowledgeTopics[4];
    result[topic.key]+=(result[topic.key]?'\n':'')+line.trim();
  }
  return result;
}
export function observationEntries(text) {
  const grouped=organizeObservation(text);
  return Object.fromEntries(knowledgeTopics.map(q=>{
    const text=grouped[q.key],pending=/待核实|待确认|不清楚|不确定|没有确认|可能|怀疑/.test(text);
    return [q.key,{text,mode:'append',certainty:pending?'pending':q.key!=='health'&&/每天|一直|平时|通常|每次|长期|习惯/.test(text)?'ongoing':'observation'}];
  }));
}
export function saveUnprocessedObservation(state,petId,{media,observedOn}) {
  const pet=state.pets.find(p=>p.id===petId);
  if(state.role!=='rescue'||!pet||stationFor(pet).id!==state.activeStationId)throw new Error('仅所属救助站可以补充资料。');
  if(!media?.some(m=>m.type==='audio'||m.type==='video'||m.type==='photo'))throw new Error('请先录一段或拍下观察。');
  pet.observationSources??=[];
  pet.observationSources.push({batchId:crypto.randomUUID(),at:Date.now(),observedOn,originalText:'',media:structuredClone(media),status:'awaiting-analysis',source:stationFor(pet).name});
}
export function confirmObservation(state,petId,{entries,observedOn,media=[],originalText='',share,dateBasis='observed'}) {
  const pet=state.pets.find(p=>p.id===petId);
  if(state.role!=='rescue'||!pet||stationFor(pet).id!==state.activeStationId)throw new Error('仅所属救助站可以补充这只宠物的资料。');
  if(!share)throw new Error('请确认整理内容可供领养者通过 Agent 了解。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(observedOn)||!Number.isFinite(Date.parse(observedOn)))throw new Error('请填写观察日期。');
  const selected=knowledgeTopics.filter(q=>entries[q.key]?.text?.trim());
  if(!selected.length)throw new Error('请先补充文字整理结果；尚未转写的录音不能直接作为事实。');
  for(const q of selected)if(!['observation','ongoing','pending'].includes(entries[q.key].certainty)||!['append','replace'].includes(entries[q.key].mode))throw new Error('请确认资料类型和更新方式。');
  const at=Date.now(),batchId=crypto.randomUUID(),source=stationFor(pet).name;
  pet.knowledge??=[];
  for(const q of selected){
    const item=entries[q.key];
    if(item.mode==='replace')for(const previous of pet.knowledge.filter(n=>n.topic===q.key&&!n.supersededAt))previous.supersededAt=at;
    pet.knowledge.push({id:crypto.randomUUID(),batchId,topic:q.key,text:item.text.trim().slice(0,1000),certainty:item.certainty,observedOn,dateBasis,source,stationId:state.activeStationId,confirmedAt:at});
  }
  pet.observationSources??=[];
  pet.observationSources.push({batchId,at,observedOn,originalText,media:structuredClone(media)});
  pet.knowledgeUpdatedAt=at;
  return batchId;
}
export function knowledgeReply(pet,question) {
  const topics=knowledgeTopics.filter(q=>q.pattern?.test(question)).map(q=>q.key);
  const broad=/补充|资料库|最新观察|还有什么/.test(question);
  const notes=(pet.knowledge||[]).filter(n=>!n.supersededAt&&(broad||topics.includes(n.topic)));
  if(!notes.length)return null;
  const labels={ongoing:'长期观察',observation:'单次观察',pending:'待核实'};
  return `关于${pet.name}，照护者记录了这些信息：\n`+notes.map(n=>`${n.dateBasis==='recorded'?'记录于':'观察于'} ${n.observedOn} · ${n.source}（${labels[n.certainty]}）：${n.text}`).join('\n')+
    '\n这些是不同时间的观察；若描述不一致，请向救助站确认目前情况。'+(notes.some(n=>n.topic==='health')?'健康观察不等于诊断，持续或异常症状请联系兽医。':'');
}
