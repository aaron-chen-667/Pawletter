import {escapeDisplay as esc} from './display-text.js';

export function groupProfileFacts(notes=[]) {
 const groups={health:[],needs:[],pending:[],daily:[]};
 for(const note of notes){
  if(!note.quote)continue;
  const care=note.topic==='other'&&/领养(?:家庭|人|者|条件|要求)|照护要求|照护安排/.test(note.quote);
  if(note.topic==='health')groups.health.push(note);
  else if(care||note.topic==='diet')groups.needs.push(note);
  else groups.daily.push(note);
  // Care requirements describe the future household, not an uncertain animal trait.
  if(!care&&(note.certainty==='pending'||/待.{0,8}(确认|核对|核验|核实)|需.{0,20}确认|尚未确认|不确定/.test(note.quote)))groups.pending.push(note);
 }
 return groups;
}
export function profileFactsView(p,result){
 const row=(label,body)=>`<div><span>${label}</span><section>${body}</section></div>`;
 const character=row('性格观察',`<p>${esc(p.character)}</p>`);
 if(!p.cloud)return `<div class="facts-card">${character}${[['健康记录',p.health],['待确认',p.unknown],['领养需要',p.needs]].map(([k,v])=>row(k,`<p>${esc(v)}</p>`)).join('')}</div>`;
 if(!result||result.status==='loading')return `<div class="facts-card">${character}${row('档案记录','<p role="status">正在读取已归档记录…</p>')}</div>`;
 if(result.status==='error')return `<div class="facts-card">${character}${row('档案记录','<p role="alert">记录暂时未加载成功，请重试。</p><button class="text-button" data-action="facts-retry">重新加载</button>')}</div>`;
 const groups=groupProfileFacts(result.notes);
 const renderNotes=(notes,fallback)=>notes.length?notes.map(n=>`<p>${esc(n.quote)}</p>`).join(''):`<p>${fallback}</p>`;
 return `<div class="facts-card">${character}${row('健康记录',renderNotes(groups.health,'暂未公开健康记录，请向救助站了解。'))}${row('待确认',renderNotes(groups.pending,'当前公开记录未列出待确认项；未记录的信息仍需向救助站了解。'))}${row('领养需要',renderNotes(groups.needs,'暂未公开照护与领养要求，请向救助站了解。'))}${groups.daily.length?row('日常观察',renderNotes(groups.daily,'')):''}</div>`;
}
