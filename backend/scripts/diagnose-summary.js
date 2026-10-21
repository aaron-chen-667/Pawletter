import {createAI} from '../src/ai.js';
import {analysisSchema} from '../src/onboarding.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const env=JSON.parse(input);input='';
const fetcher=async(...args)=>{const r=await fetch(...args);if(r.ok){const d=await r.clone().json();console.log(JSON.stringify({status:r.status,finish:d.choices?.[0]?.finish_reason,length:d.choices?.[0]?.message?.content?.length}));}return r;};
const answers={work:{text:'我平时居家办公，白天离家不超过两小时。',value:'short'},routine:{text:'通常早上七点起床，晚上十一点睡觉，作息规律。',value:'regular'},free:{text:'每天有两小时以上可以安排喂食、清理和陪伴。',value:'over2'},expectation:{text:'我更期待安静的成年猫，愿意耐心陪它适应。',value:'quiet'}};
try{const result=await createAI(env,fetcher).summarizeLifestyle(answers);const parsed=analysisSchema.safeParse(result);console.log(JSON.stringify({valid:parsed.success,issues:parsed.error?.issues.map(i=>({path:i.path,code:i.code})),keys:Object.keys(result)}));}catch(e){console.log(JSON.stringify({error:e.code||e.name}));}
