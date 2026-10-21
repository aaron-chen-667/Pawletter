import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { validateExtraction } from './ai.js';
export async function processOne({db, ai, storage}, observationId = null) {
  await db.query("UPDATE observations SET status='failed',error_code='RETRY_EXHAUSTED',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='processing' AND lease_until<now() AND attempts>=4");
  const lease = randomUUID();
  const { rows } = await db.query(`UPDATE observations SET status='processing',lease_token=$1,
    lease_until=now()+interval '4 minutes',attempts=attempts+1,updated_at=now()
    WHERE id=(SELECT id FROM observations WHERE ($2::text IS NULL OR id=$2)
      AND attempts<4 AND ((status='queued' AND next_attempt_at<=now()) OR (status='processing' AND lease_until<now()))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [lease, observationId]);
  const task = rows[0]; if (!task) return {processed:false};
  try {
    let transcript = task.transcript || task.original_text;
    if (!transcript) {
      const media = (await db.query('SELECT * FROM media WHERE id=$1 AND pet_id=$2',[task.media_id,task.pet_id])).rows[0];
      if (!media) throw Object.assign(new Error(),{code:'MEDIA_MISSING'});
      transcript = await ai.transcribe(await storage.read(media.object_name), media.mime);
      await db.query("UPDATE observations SET transcript=$1 WHERE id=$2 AND lease_token=$3 AND status='processing'",[transcript,task.id,lease]);
    }
    const notes = validateExtraction({items:await ai.extract(transcript)}, transcript);
    await transaction(db, async client => {
      const valid = (await client.query("SELECT id FROM observations WHERE id=$1 AND lease_token=$2 AND status='processing' FOR UPDATE",[task.id,lease])).rows[0];
      if (!valid) return; // Withdrawals and newer workers invalidate this lease.
      for (const note of notes) await client.query('INSERT INTO knowledge(id,observation_id,pet_id,topic,quote,certainty) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),task.id,task.pet_id,note.topic,note.quote,note.certainty]);
      await client.query("UPDATE observations SET status='archived',transcript=$1,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=now() WHERE id=$2",[transcript,task.id]);
    });
    return {processed:true,id:task.id};
  } catch(e) {
    // Never persist provider responses, connection strings or exception text.
    const allowed = ['MEDIA_MISSING','MEDIA_EXPIRED','ASR_EMPTY_OR_INVALID','AI_UNAVAILABLE','AI_RATE_LIMITED','AI_PROVIDER_ERROR','AI_INVALID_RESPONSE','AI_INVALID_EXTRACTION','AI_UNGROUNDED_EXTRACTION'];
    const code = allowed.includes(e.code) ? e.code : 'PROCESSING_FAILED';
    await db.query(`UPDATE observations SET status=$1,error_code=$2,lease_token=NULL,lease_until=NULL,
      next_attempt_at=now()+interval '2 minutes',updated_at=now() WHERE id=$3 AND lease_token=$4 AND status='processing'`,[task.attempts>=4?'failed':'queued',code,task.id,lease]);
    return {processed:true,id:task.id,error:code};
  }
}
