import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {authenticate,digest} from './auth.js';
import {assert} from './errors.js';
import {transaction} from './db.js';
export async function followupRoutes(app,{db}){
 const staff=async req=>{req.user=await authenticate(db,req);assert(req.user.role==='station',403,'STATION_REQUIRED');};
 const project=r=>({id:r.id,applicationId:r.application_id,petId:r.pet_id,adopterId:r.adopter_id,name:r.snapshot.nickname,dueAt:r.due_at,status:r.status,version:r.version,history:r.history,updatedAt:r.updated_at});
 app.get('/v1/followups',{preHandler:staff},async req=>{
  const rows=await db.query("SELECT f.*,a.pet_id,a.adopter_id,a.snapshot FROM rescue_followups f JOIN adoption_applications a ON a.id=f.application_id WHERE a.station_id=$1 ORDER BY f.due_at ASC",[req.user.station_id]);return {followups:rows.rows.map(project)};
 });
 app.post('/v1/followups',{preHandler:staff},async(req,reply)=>{
  const body=z.object({applicationId:z.string(),dueAt:z.iso.datetime(),note:z.string().trim().max(2000).default('')}).strict().parse(req.body),key=z.uuid().parse(req.headers['idempotency-key']),hash=digest(JSON.stringify(body));
  const result=await transaction(db,async c=>{
   const a=(await c.query('SELECT * FROM adoption_applications WHERE id=$1 FOR UPDATE',[body.applicationId])).rows[0];assert(a&&a.station_id===req.user.station_id,403,'APPLICATION_FORBIDDEN');assert(a.stage===3,409,'ADOPTION_NOT_COMPLETED');
   const prior=(await c.query('SELECT * FROM rescue_followups WHERE idempotency_key=$1',[key])).rows[0];if(prior){assert(prior.request_hash===hash&&prior.application_id===a.id,409,'IDEMPOTENCY_CONFLICT');return project({...prior,...{pet_id:a.pet_id,adopter_id:a.adopter_id,snapshot:a.snapshot}});}
   assert(!(await c.query("SELECT id FROM rescue_followups WHERE application_id=$1 AND status<>'completed'",[a.id])).rows.length,409,'FOLLOWUP_EXISTS');
   const row=(await c.query('INSERT INTO rescue_followups(id,application_id,due_at,history,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),a.id,body.dueAt,JSON.stringify([{at:new Date().toISOString(),action:'scheduled',text:body.note||'安排到家回访',actor:'救助站'}]),key,hash])).rows[0];return project({...row,pet_id:a.pet_id,adopter_id:a.adopter_id,snapshot:a.snapshot});
  });return reply.code(201).send(result);
 });
 app.post('/v1/followups/:id',{preHandler:staff},async req=>{
  const body=z.object({status:z.enum(['pending','confirmation','attention','completed']),note:z.string().trim().min(1).max(4000),dueAt:z.iso.datetime(),version:z.number().int().positive(),requestId:z.uuid()}).strict().parse(req.body);
  return transaction(db,async c=>{
   const row=(await c.query('SELECT f.*,a.station_id,a.pet_id,a.adopter_id,a.snapshot FROM rescue_followups f JOIN adoption_applications a ON a.id=f.application_id WHERE f.id=$1 FOR UPDATE OF f',[req.params.id])).rows[0];assert(row&&row.station_id===req.user.station_id,403,'FOLLOWUP_FORBIDDEN');
   const prior=row.history.find(h=>h.requestId===body.requestId);if(prior){assert(prior.text===body.note&&prior.status===body.status&&prior.dueAt===body.dueAt,409,'IDEMPOTENCY_CONFLICT');return project(row);}
   assert(row.version===body.version,409,'FOLLOWUP_CHANGED');
   const history=[...row.history,{at:new Date().toISOString(),action:'recorded',text:body.note,status:body.status,dueAt:body.dueAt,requestId:body.requestId,actor:'救助站'}];
   const updated=(await c.query('UPDATE rescue_followups SET status=$1,due_at=$2,history=$3,version=version+1,updated_at=now() WHERE id=$4 RETURNING *',[body.status,body.dueAt,JSON.stringify(history),row.id])).rows[0];return project({...row,...updated});
  });
 });
}
