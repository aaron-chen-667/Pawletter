import { OAuth2Client } from 'google-auth-library';
import { connectDatabase } from './db.js';
import { createAI } from './ai.js';
import { createStorage } from './storage.js';
import { createApp } from './app.js';
const db = connectDatabase(), oidc = new OAuth2Client();
const workerAuth = async request => {
  const audience = process.env.WORKER_AUDIENCE, email = process.env.WORKER_SERVICE_ACCOUNT;
  const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!audience || !email || !token) return false;
  try {
    const payload = (await oidc.verifyIdToken({idToken:token,audience})).getPayload();
    return payload?.email === email && payload.email_verified === true && ['accounts.google.com','https://accounts.google.com'].includes(payload.iss);
  } catch { return false; }
};
const app = await createApp({db,ai:createAI(),storage:createStorage(),workerAuth,origin:process.env.FRONTEND_ORIGIN,logger:{level:'info',redact:['req.headers.authorization','req.body','res.headers']}});
let stopping = false;
const shutdown = async()=>{if(stopping)return;stopping=true;await app.close();await db.end();};
process.on('SIGTERM',()=>shutdown().catch(()=>process.exit(1)));
process.on('SIGINT',()=>shutdown().catch(()=>process.exit(1)));
await app.listen({port:Number(process.env.PORT||8080),host:'0.0.0.0'});
