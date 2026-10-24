import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {connectDatabase,transaction} from '../src/db.js';
import {hashPassword,digest} from '../src/auth.js';
import {defaultVoice} from '../src/pet-agent.js';
import {createStorage} from '../src/storage.js';
export const demoId=key=>{const h=createHash('sha256').update('pawletter-client-demo-v1:'+key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const fixture=()=>readFile(new URL('../fixtures/client-demo.json',import.meta.url),'utf8').then(JSON.parse);
const avatar=(name,i)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${['#e8dcff','#d6efe7','#ffe8cd','#d7e6fb'][i%4]}"/><circle cx="48" cy="37" r="17" fill="#52617a"/><path d="M19 86c0-35 58-35 58 0" fill="#52617a"/></svg>`);
const lifestyles=(nickname,i)=>({answers:{work:{text:i%2?'居家办公较多，白天可以安排短时间照看。':'工作日朝九晚六，家人可分担白天照护。',value:i%2?'short':'long'},routine:{text:'作息规律，周末愿意留出时间陪伴。',value:'regular'},free:{text:'每天可安排一到两小时互动和照护。',value:'one2'},expectation:{text:i%2?'愿意陪伴散步和互动，也尊重它休息。':'希望安静陪伴，愿意给慢热的伙伴适应时间。',value:i%2?'active':'quiet'}},analysis:{title:i%2?'认真陪伴的散步搭子':'温柔耐心的安静室友',summary:`${nickname}有稳定的照护安排，愿意结合动物的实际习惯调整互动节奏。领养前仍需要共同确认防逃逸和独处安排。`,highlights:['家人共同同意','有固定陪伴时间','愿意配合回访'],recommendations:[{type:i%2?'活动需求适中的成年狗':'性格安静的成年猫',reason:'与确认的日常照护节奏接近，仍需实际见面了解。',basedOn:['free','expectation']}],unknowns:['具体独处安排需双方确认']}});

// Explicit administrator-run fixture import. Only stable demo-owned IDs are written;
// reruns never change passwords, edited records, stages or withdrawn memories.
export async function seedClientDemo(db,{passwords,media={},storage,now=new Date()}={}){
 const data=await fixture(),station=demoId('station'),emptyStation=demoId('empty-station'),objects=[];
 const ago=(days,hours=0)=>new Date(+now-days*86400000+hours*3600000).toISOString();
 try{return await transaction(db,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(73022510)');
  const counts={accounts:0,pets:0,observations:0,knowledge:0,applications:0,followups:0,chats:0,media:0};
  await c.query('INSERT INTO stations(id,name) VALUES($1,$2),($3,$4) ON CONFLICT(id) DO NOTHING',[station,data.stationName,emptyStation,'新站入驻 · 客户演示']);
  for(const [i,a]of data.accounts.entries()){
   const id=demoId('user:'+a.key),existing=(await c.query('SELECT id,username FROM users WHERE id=$1 OR username=$2',[id,a.username])).rows;
   if(existing.length){if(existing.length!==1||existing[0].id!==id||existing[0].username!==a.username)throw Error('DEMO_ID_CONFLICT');}
   else{await c.query('INSERT INTO users(id,username,password_hash,role,station_id) VALUES($1,$2,$3,$4,$5)',[id,a.username,await hashPassword(passwords[a.key]),a.role,a.role==='station'?(a.key==='station'?station:emptyStation):null]);counts.accounts++;}
   if(a.role==='adopter')await c.query("INSERT INTO adopter_profiles(user_id,registration_key,nickname,real_name,phone,wechat,email,lifestyle,verification,covenant_version,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'demo-fixture-not-real-identity',$10) ON CONFLICT(user_id) DO NOTHING",[id,demoId('registration:'+a.key),a.nickname,'演示人物 · '+a.nickname,'0000000'+String(i).padStart(4,'0'),'demo_only_'+a.key,a.key+'@example.invalid',JSON.stringify(lifestyles(a.nickname,i)),a.verified?'verified':'pending',ago(60)]);
  }
  const author=demoId('user:station');
  for(const [index,p]of data.pets.entries()){
   const id=demoId('pet:'+p.key),profile={...p.profile,adopted:p.adopted};
   const inserted=await c.query('INSERT INTO pets(id,station_id,name,profile,published,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING id',[id,station,p.name,JSON.stringify(profile),p.published,ago(65-index)]);
   if(!inserted.rows.length)continue;counts.pets++;
   const voice=defaultVoice(profile);voice.tone=['shy','calm','lively','gentle'][index%4];
   await c.query('INSERT INTO pet_agents(pet_id,voice) VALUES($1,$2)',[id,JSON.stringify(voice)]);
   for(const [n,note]of p.notes.entries()){
    const oid=demoId(`note:${p.key}:${n}`),at=ago(note.daysAgo);
    await c.query("INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,transcript,share_with_agent,status,observed_on,created_at,updated_at) VALUES($1,$2,$3,$1,$4,$5,$5,$6,'archived',$7,$8,$8)",[oid,id,author,digest(note.quote),note.quote,note.shared,at.slice(0,10),at]);counts.observations++;
    await c.query('INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[demoId('knowledge:'+oid),oid,id,note.topic,note.quote,note.certainty,at]);counts.knowledge++;
   }
   const source=p.notes.filter(n=>n.shared).map(n=>n.quote).join('\n');
   await c.query('INSERT INTO pet_intakes(id,author_id,pet_id,request_hash,source_text,ocr_text,observation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[demoId('intake:'+p.key),author,id,digest(source),source,'',demoId(`note:${p.key}:0`),ago(60-index)]);
   if(media[p.asset]&&storage){const object=`pets/${id}/visual/0`,bytes=Buffer.from(media[p.asset],'base64');await storage.put(object,bytes,'image/jpeg');objects.push(object);await c.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size,shared,caption,observation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[demoId('cover:'+p.key),id,author,object,'image/jpeg',bytes.length,p.published,'客户演示照片素材',demoId(`note:${p.key}:0`),ago(25)]);counts.media++;}
  }
  if(media['pawletter-film.webm']&&storage){
   const pet=demoId('pet:1'),mid=demoId('video'),exists=(await c.query('SELECT id FROM media WHERE id=$1',[mid])).rows.length;
   if(!exists){const object=`pets/${pet}/visual/1`,bytes=Buffer.from(media['pawletter-film.webm'],'base64');await storage.put(object,bytes,'video/webm');objects.push(object);await c.query('INSERT INTO media(id,pet_id,owner_id,object_name,mime,size,shared,caption) VALUES($1,$2,$3,$4,$5,$6,false,$7)',[mid,pet,author,object,'video/webm',bytes.length,'流程演示短片（非本宠物实拍）']);counts.media++;}
  }
  // Failed and withdrawn sources demonstrate retry, filtering and an auditable correction.
  for(const [key,status,text,days]of [['failed','failed','今天主动靠近了新的照护者，尚未确认是否会持续。',0],['old','withdrawn','此前误记为每天喜欢被抱。',9],['corrected','archived','更正：它平时喜欢靠近熟悉的人，但不喜欢被抱起。',8]]){
   const oid=demoId('special:'+key),id=demoId('pet:1'),at=ago(days);
   const inserted=await c.query('INSERT INTO observations(id,pet_id,author_id,idempotency_key,request_hash,original_text,transcript,share_with_agent,status,error_code,attempts,replaces_id,observed_on,created_at,updated_at) VALUES($1,$2,$3,$1,$4,$5,$5,true,$6,$7,$8,$9,$10,$11,$11) ON CONFLICT(id) DO NOTHING RETURNING id',[oid,id,author,digest(text),text,status,status==='failed'?'AI_UNAVAILABLE':null,status==='failed'?3:0,key==='corrected'?demoId('special:old'):null,at.slice(0,10),at]);
   if(inserted.rows.length){counts.observations++;if(key==='corrected'){await c.query('INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty) VALUES($1,$2,$3,$4,$5,$6)',[demoId('special:knowledge'),oid,id,'likes',text,'ongoing']);counts.knowledge++;}}
  }
  for(const a of data.applications){
   const user=data.accounts.find(u=>u.key===a.user),ui=data.accounts.indexOf(user),p=data.pets.find(p=>p.key===a.pet),id=demoId('application:'+a.key),petId=demoId('pet:'+a.pet),userId=demoId('user:'+a.user);
   const snapshot={nickname:user.nickname,realName:'演示人物 · '+user.nickname,phone:'0000000'+String(ui).padStart(4,'0'),wechat:'demo_only_'+user.key,email:user.key+'@example.invalid',verification:user.verified?'verified':'pending',lifestyle:lifestyles(user.nickname,ui),memories:['愿意按动物实际状态调整相处方式','家人共同参与照护'],avatarUrl:avatar(user.nickname,ui),sharedAt:Date.parse(ago(a.daysAgo)),demoData:true,pet:{id:petId,name:p.name,stationId:station,stationName:data.stationName,published:p.published,profile:p.profile}};
   const inserted=await c.query('INSERT INTO adoption_applications(id,pet_id,adopter_id,station_id,snapshot,note,stage,version,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$1,$9,$9) ON CONFLICT(id) DO NOTHING RETURNING id',[id,petId,userId,station,JSON.stringify(snapshot),a.note,a.stage,a.stage<0?2:a.stage+1,ago(a.daysAgo)]);
   if(!inserted.rows.length)continue;counts.applications++;
   const notifications=['照顾我的人收到申请啦，会认真看看你的照护安排。','已经进入见面阶段，具体时间和地点请和救助站确认。','见面已确认，接下来一起核对交接事项。','交接完成啦，慢慢陪我熟悉新家吧。'];
   for(let stage=0;stage<=(a.stage<0?0:a.stage);stage++){await c.query('INSERT INTO chats(id,user_id,pet_id,question,answer,citations,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[demoId(`notification:${a.key}:${stage}`),userId,petId,'',notifications[stage],'[]',ago(a.daysAgo+3-stage)]);counts.chats++;}
   if(a.stage<0){await c.query('INSERT INTO chats(id,user_id,pet_id,question,answer,citations,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[demoId('notification:'+a.key+':ended'),userId,petId,'','这次申请先告一段落，谢谢你认真认识我。','[]',ago(a.daysAgo)]);counts.chats++;}
   if(a.followup){const due=a.followup==='pending'?ago(a.key==='pending'?1:-1):a.followup==='completed'?ago(2):ago(0),note=data.followupNotes[a.followup];const history=[{at:ago(a.daysAgo-1),action:'scheduled',text:'交接后安排适应期回访。',actor:'救助站'},{at:ago(a.followup==='completed'?2:0),action:'recorded',text:note,status:a.followup,dueAt:due,actor:'救助站'}];await c.query('INSERT INTO rescue_followups(id,application_id,due_at,status,version,history,idempotency_key,request_hash,created_at,updated_at) VALUES($1,$2,$3,$4,2,$5,$1,$6,$7,$8)',[demoId('followup:'+a.key),id,due,a.followup,JSON.stringify(history),digest(note),ago(a.daysAgo-1),ago(0)]);counts.followups++;}
  }
  // Seeded conversation is curated fixture history, not claimed to be a live inference.
  for(const key of ['1','2','3','6']){
   const p=data.pets.find(p=>p.key===key),id=demoId('chat:'+key),user=demoId('user:main'),pet=demoId('pet:'+key);
   const result=await c.query('INSERT INTO chats(id,user_id,pet_id,question,answer,citations,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id',[id,user,pet,'你平时喜欢什么？',p.notes[0].quote.replace(/^平时/,'我平时').replace(/^每天/,'我每天'),JSON.stringify([{id:demoId('knowledge:'+demoId(`note:${key}:0`)),quote:p.notes[0].quote,station:data.stationName}]),ago(key==='1'?0:3)]);counts.chats+=result.rows.length;
   if(key==='2')await c.query('INSERT INTO chat_reads(user_id,pet_id,read_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[user,pet,ago(0)]);
  }
  await c.query('INSERT INTO audit_events(id,actor_id,action,target_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[demoId('audit'),author,'client_demo.seeded.synthetic_identity',station]);
  return {version:data.version,counts,stationId:station,emptyStationId:emptyStation,accounts:data.accounts.map(a=>({key:a.key,username:a.username,role:a.role,id:demoId('user:'+a.key)})),pets:data.pets.map(p=>({id:demoId('pet:'+p.key),key:p.key,name:p.name}))};
 });}catch(error){await Promise.allSettled(objects.map(name=>storage.remove(name)));throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=connectDatabase(),storage=createStorage();
 try{const input=JSON.parse((await storage.read(process.env.DEMO_INPUT_OBJECT)).toString());const result=await seedClientDemo(db,{...input,storage});await storage.put(process.env.DEMO_REPORT_OBJECT,Buffer.from(JSON.stringify(result)),'application/json');console.log(JSON.stringify({version:result.version,counts:result.counts}));}
 catch{console.error('CLIENT_DEMO_SEED_FAILED');process.exitCode=1;}finally{await db.end();}
}
