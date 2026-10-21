export function cloudPet(row){
 const p=row.profile||{},stationRecord={id:row.stationId,name:row.stationName||'救助站',city:p.city||'位置待补充',lat:p.latitude,lng:p.longitude};
 return {id:row.id,cloud:true,name:row.name,stationId:row.stationId,station:stationRecord.name,stationRecord,city:p.city||'位置待补充',species:p.species==='dog'?'狗':'猫',sex:p.sex==='male'?'男孩子':p.sex==='female'?'女孩子':'性别待补充',age:p.age||'年龄待补充',coat:'',image:p.photoUrl||'./assets/paw.svg',tags:p.character?[p.character]:['等待认识'],character:p.character||'救助者尚未补充性格观察',mood:p.description||'慢慢认识我，也看看照顾我的人写下的记录。',intro:p.description||'救助者还在补充我的基础介绍。',health:'请查看救助者记录或向我的 AI 分身了解，未记录的情况需要确认。',unknown:'未记录的情况请与救助站确认',needs:'照护安排与领养条件需要和负责救助站共同确认',status:p.adopted?'adopted':'available',confirmed:true,active:!p.adopted,observations:[]};
}
