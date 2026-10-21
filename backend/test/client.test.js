import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPawletterClient} from '../client/pawletter-api.js';
test('browser adapter isolates password to login, uses bearer auth and preserves idempotency key',async()=>{
 const calls=[];
 const client=createPawletterClient('https://api.invalid/',async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/login')?{token:'t',user:{role:'station'},expiresAt:'date'}:{id:'o1'}));});
 await client.login('staff','private-test-password');
 await client.submitObservation('pet-1',{text:'喜欢玩。'},'submission-key');
 const request=calls[1].options;assert.equal(request.headers.Authorization,'Bearer t');assert.equal(request.headers['Idempotency-Key'],'submission-key');assert.equal(request.credentials,'omit');assert.ok(!JSON.stringify(calls[1]).includes('private-test-password'));
 await client.logout();await client.pets();assert.equal(calls.at(-1).options.headers.Authorization,undefined);
});
