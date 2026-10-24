import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAI} from '../src/ai.js';

const draft=extra=>({name:'橘子',species:'cat',description:'橘色短毛猫，左耳有缺口。',character:'',age:'五岁',sex:'unknown',ocrText:'',nextQuestion:'',uncertainties:[],...extra});
function provider(value){
 let request;
 const ai=createAI({AI_BASE_URL:'https://provider.invalid/v1',AI_API_KEY:'test'},async(_url,options)=>{
  request=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})};
 });
 return {ai,get request(){return request;}};
}
test('latest source evidence allows one corrected manual field while retaining the other manual fields',async()=>{
 const latestText='刚才三岁说错了，是五岁。它左耳有一个缺口。',quote='刚才三岁说错了，是五岁。';
 const mock=provider(draft({corrections:[{field:'age',quote},{field:'age',quote}]}));
 const input={text:'救助者口述：原来估计三岁。\n救助者口述：'+latestText,images:[],confirmedFields:{age:'三岁',name:'小橘'},latestText};
 const result=await mock.ai.draftIntake(input);
 assert.equal(result.age,'五岁');assert.equal(result.name,'小橘');assert.deepEqual(result.corrections,[{field:'age',quote}]);
 const payload=JSON.parse(mock.request.messages[1].content[0].text);assert.deepEqual(payload.confirmedFields,input.confirmedFields);assert.equal(payload.latestText,latestText);
});
test('fabricated, historical, empty or unconfirmed correction evidence cannot override manual values',async()=>{
 const historical='年龄是五岁。',latestText='今天吃了少量罐头。',confirmedFields={age:'三岁',name:'小橘'};
 const mock=provider(draft({corrections:[
  {field:'age',quote:'刚才三岁说错了，是五岁。'},
  {field:'age',quote:historical},
  {field:'name',quote:''},
  {field:'name',quote:'   '},
  {field:'description',quote:latestText},
  {field:'published',quote:latestText},
  {field:'name',quote:42},
 ]}));
 const result=await mock.ai.draftIntake({text:historical+'\n'+latestText,images:[],confirmedFields,latestText});
 assert.equal(result.age,'三岁');assert.equal(result.name,'小橘');assert.deepEqual(result.corrections,[]);
});
test('legacy model replies default to no corrections and preserve manual values when evidence is absent',async()=>{
 const mock=provider(draft());
 const legacy=await mock.ai.draftIntake({text:'橘色短毛猫。',images:[]});assert.equal(legacy.age,'五岁');assert.deepEqual(legacy.corrections,[]);
 const confirmed=await mock.ai.draftIntake({text:'橘色短毛猫。',images:[],confirmedFields:{age:'年龄不清楚'},latestText:'橘色短毛猫。'});assert.equal(confirmed.age,'年龄不清楚');assert.deepEqual(confirmed.corrections,[]);
});
test('guided coverage marks every dimension and never asks a dimension the rescuer declined',async()=>{
 const mock=provider(draft({coverage:{age:'covered',health:'missing',character:'covered'},nextDimension:'health',nextQuestion:'它身体怎么样？打过疫苗吗？'}));
 const asked=await mock.ai.draftIntake({text:'橘色短毛猫，送来的人说五岁，平时很亲人。',images:[]});
 assert.equal(asked.nextDimension,'health');assert.equal(asked.nextQuestion,'它身体怎么样？打过疫苗吗？');
 assert.deepEqual(asked.coverage,{species:'covered',age:'covered',sex:'missing',health:'missing',character:'covered',likes:'missing',habits:'missing',diet:'missing'});
 const declined=await mock.ai.draftIntake({text:'橘色短毛猫。健康情况不清楚。',images:[],declined:['health']});
 assert.equal(declined.coverage.health,'unknown');assert.equal(declined.nextDimension,'');assert.equal(declined.nextQuestion,'');
 assert.deepEqual(JSON.parse(mock.request.messages[1].content[0].text).declined,['health']);
});
test('legacy model replies without coverage still list every dimension as missing except a known species',async()=>{
 const legacy=await provider(draft()).ai.draftIntake({text:'橘色短毛猫。',images:[]});
 assert.equal(legacy.nextDimension,'');assert.equal(legacy.coverage.species,'covered');assert.equal(legacy.coverage.health,'missing');assert.equal(Object.keys(legacy.coverage).length,8);
});
