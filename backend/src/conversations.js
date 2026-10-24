import {z} from 'zod';
import {assert} from './errors.js';
export function conversationRoutes({app,db,auth}){
 app.get('/v1/conversations',{preHandler:auth},async req=>{
  const rows=(await db.query(`SELECT p.id,p.name,p.station_id,p.published,p.profile->>'photoUrl' AS photo_url,
   s.name AS station_name,c.answer,c.created_at,r.read_at,
   (SELECT count(*)::int FROM chats unread WHERE unread.user_id=$1 AND unread.pet_id=p.id AND date_trunc('milliseconds',unread.created_at)>COALESCE(r.read_at,'epoch'::timestamptz)) AS unread
   FROM pets p JOIN stations s ON s.id=p.station_id
   JOIN LATERAL (SELECT answer,created_at FROM chats WHERE user_id=$1 AND pet_id=p.id ORDER BY created_at DESC,id DESC LIMIT 1) c ON true
   LEFT JOIN chat_reads r ON r.user_id=$1 AND r.pet_id=p.id
   ORDER BY c.created_at DESC,p.id`,[req.user.id])).rows;
  return {conversations:rows.map(r=>({pet:{id:r.id,name:r.name,stationId:r.station_id,stationName:r.station_name,published:r.published,profile:{photoUrl:r.photo_url||''}},lastMessage:{from:'pet',text:r.answer,at:r.created_at},readAt:r.read_at,unread:r.unread,canChat:r.published||req.user.station_id===r.station_id}))};
 });
 app.post('/v1/pets/:id/chat/read',{preHandler:auth},async req=>{
  const {through}=z.object({through:z.iso.datetime()}).strict().parse(req.body);
  const row=(await db.query('SELECT max(created_at) AS latest FROM chats WHERE user_id=$1 AND pet_id=$2',[req.user.id,req.params.id])).rows[0];
  assert(row?.latest,404,'CONVERSATION_NOT_FOUND');
  const at=new Date(Math.min(Date.parse(through),new Date(row.latest).getTime(),Date.now())).toISOString();
  const result=await db.query(`INSERT INTO chat_reads(user_id,pet_id,read_at) VALUES($1,$2,$3)
   ON CONFLICT(user_id,pet_id) DO UPDATE SET read_at=GREATEST(chat_reads.read_at,EXCLUDED.read_at) RETURNING read_at`,[req.user.id,req.params.id,at]);
  return {readAt:result.rows[0].read_at};
 });
}
