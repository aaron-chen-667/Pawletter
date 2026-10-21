// Run in the application image with its runtime identity. Emit status only, never secrets.
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = pathToFileURL(process.cwd() + '/');
const { connectDatabase } = await import(new URL('src/db.js', root));
const { createStorage } = await import(new URL('src/storage.js', root));
const { createAI } = await import(new URL('src/ai.js', root));
const db = connectDatabase(), storage = createStorage(), ai = createAI();
let failures = 0;
async function check(name, run) {
  try { await run(); console.log(JSON.stringify({check:name,ok:true})); }
  catch(e) { failures++; console.log(JSON.stringify({check:name,ok:false,code:/^[A-Z_]{3,50}$/.test(e.code || '')?e.code:'VERIFICATION_FAILED'})); }
}
await check('database', async()=>{await db.query('SELECT id FROM observations LIMIT 1');});
await check('private_storage', async()=>{
  const key=`system/verification/${randomUUID()}.txt`, content=Buffer.from('pawletter-connectivity-check');
  try {await storage.put(key,content,'text/plain');if(!(await storage.read(key)).equals(content))throw new Error('Mismatch');}
  finally {await storage.remove(key);}
});
await check('ai_extraction',async()=>{
  const notes=await ai.extract('每天喜欢玩逗猫棒。');
  if(!notes.length)throw new Error('No extracted notes');
});
await check('agent_answer',async()=>{
  const result=await ai.answer({pet:{name:'联调测试宠物'},notes:[{id:'verification-note',quote:'每天喜欢玩逗猫棒。',topic:'likes',certainty:'ongoing',station:'测试站点',recorded_at:'2026-10-21'}],question:'它平时喜欢玩什么？'});
  if(!result.citationIds.includes('verification-note'))throw new Error('Missing citation');
});
if(process.env.VERIFY_AUDIO_OBJECT){
  await check('speech_transcription_and_extraction',async()=>{
    const key=process.env.VERIFY_AUDIO_OBJECT;
    if(!key.startsWith('system/verification/'))throw new Error('Invalid probe object');
    try {
      const transcript=await ai.transcribe(await storage.read(key),'audio/wav');
      const notes=await ai.extract(transcript);
      if(!notes.length || !transcript.includes('逗猫棒'))throw new Error('Speech content mismatch');
    } finally {await storage.remove(key);}
  });
}
await db.end();
if(failures)process.exitCode=1;
