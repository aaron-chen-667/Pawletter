import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction} from './db.js';
import {assert,ApiError} from './errors.js';
import {hashPassword,verifyPassword,issueSession} from './auth.js';
export const answerOptions={work:['unknown','short','medium','long'],routine:['unknown','regular','shift'],free:['unknown','under1','one2','over2'],expectation:['unknown','quiet','active']};
const answer=key=>z.object({text:z.string().trim().min(2).max(2000),value:z.enum(answerOptions[key])}).strict();
export const answersSchema=z.object(Object.fromEntries(Object.keys(answerOptions).map(key=>[key,answer(key)]))).strict();
export const analysisSchema=z.object({title:z.string().min(1).max(30),summary:z.string().max(600),highlights:z.array(z.string().max(160)).max(5),recommendations:z.array(z.object({type:z.string().max(80),reason:z.string().max(300),basedOn:z.array(z.enum(Object.keys(answerOptions))).min(1).max(4)}).strict()).max(3),unknowns:z.array(z.string().max(160)).max(5)}).strict();
export const lifestyleSchema=z.object({answers:answersSchema,analysis:analysisSchema.optional()}).strict();
const registration=z.object({username:z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{2,63}$/),password:z.string().min(12).max(128),nickname:z.string().trim().min(1).max(20),realName:z.string().trim().min(2).max(50),phone:z.string().trim().regex(/^\+?[0-9 -]{7,20}$/),wechat:z.string().trim().max(40).default(''),email:z.union([z.email(),z.literal('')]).default(''),covenant:z.literal(true),privacy:z.literal(true),lifestyle:lifestyleSchema}).strict();
export async function reserveBudget(db,scope,minute=8,day=100){
 await transaction(db,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(73021423)');
  await client.query('DELETE FROM onboarding_speech_budget WHERE expires_at<now()');
  for(const [window,limit] of [['minute',minute],['day',day]]){
   const result=await client.query(`INSERT INTO onboarding_speech_budget(bucket,used,expires_at) VALUES($4 || ':' || $1 || ':' || date_trunc($1,now())::text,1,date_trunc($1,now())+($2 || ' seconds')::interval) ON CONFLICT(bucket) DO UPDATE SET used=onboarding_speech_budget.used+1 WHERE onboarding_speech_budget.used<$3 RETURNING used`,[window,window==='minute'?60:86400,limit,scope]);
   assert(result.rows.length,429,'ONBOARDING_LIMIT');
  }
 });
}
export async function adopterProfile(db,id){
 const row=(await db.query('SELECT * FROM adopter_profiles WHERE user_id=$1',[id])).rows[0];
 assert(row,404,'PROFILE_NOT_FOUND');
 return {id:row.user_id,nickname:row.nickname,realName:row.real_name,phone:row.phone,wechat:row.wechat,email:row.email,verification:row.verification,covenantVersion:row.covenant_version,acceptedAt:row.accepted_at,lifestyle:row.lifestyle,consent:row.proactive_enabled};
}
export async function registerAdopter(db,input,key){
 const data=registration.parse(input);z.uuid().parse(key);
 await reserveBudget(db,'registration',5,100);
 const passwordHash=await hashPassword(data.password);
 try{return await transaction(db,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.username]);
  const existing=(await client.query('SELECT u.*,p.registration_key FROM users u LEFT JOIN adopter_profiles p ON p.user_id=u.id WHERE username=$1',[data.username])).rows[0];
  if(existing){
   assert(existing.registration_key===key&&existing.active&&await verifyPassword(data.password,existing.password_hash),409,'USERNAME_TAKEN');
   return {...await issueSession(client,existing),profile:await adopterProfile(client,existing.id)};
  }
  const id=randomUUID();
  await client.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,'adopter')",[id,data.username,passwordHash]);
  await client.query("INSERT INTO adopter_profiles(user_id,registration_key,nickname,real_name,phone,wechat,email,lifestyle,covenant_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2026-10-22')",[id,key,data.nickname,data.realName,data.phone,data.wechat,data.email,JSON.stringify({...data.lifestyle,confirmedAt:Date.now()})]);
  return {...await issueSession(client,{id,role:'adopter',station_id:null}),profile:await adopterProfile(client,id)};
 });}catch(error){if(error.code==='23505')throw new ApiError(409,'USERNAME_TAKEN');throw error;}
}
