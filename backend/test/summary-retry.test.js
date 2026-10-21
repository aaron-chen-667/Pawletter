import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAI} from '../src/ai.js';
test('summary repairs invalid structure once, never invents a local persona or retries provider rate limits',async()=>{
 let count=0;const value={title:'温柔后勤官',summary:'根据回答整理。',highlights:[],recommendations:[{type:'成年猫',reason:'喜欢安静陪伴',basedOn:['expectation']}],unknowns:[]};
 const ai=createAI({AI_BASE_URL:'https://provider.invalid/v1',AI_API_KEY:'test'},async()=>({ok:true,json:async()=>({choices:[{message:{content:++count===1?'not json':JSON.stringify(value)}}]})}));
 assert.deepEqual(await ai.summarizeLifestyle({}),value);assert.equal(count,2);
 count=0;const busy=createAI({AI_BASE_URL:'https://provider.invalid/v1',AI_API_KEY:'test'},async()=>{count++;return {ok:false,status:429};});await assert.rejects(busy.summarizeLifestyle({}),e=>e.code==='AI_RATE_LIMITED');assert.equal(count,1);
});
