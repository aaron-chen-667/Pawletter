import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPawletterClient} from '../dist/pawletter-api.js';
test('visibility updates use the canonical profile URL and omit server-owned adoption status',async()=>{
 const calls=[],profile={species:'cat',description:'真实档案',photoUrl:'https://api.invalid/v1/pets/p/visual/0',adopted:true};
 const api=createPawletterClient('https://api.invalid',async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/profile')?{ok:true}:{name:'麦麦',profile});});
 await api.setVisibility('p',true);const body=JSON.parse(calls[1].options.body);assert.equal(body.published,true);assert.equal(body.profile.photoUrl,profile.photoUrl);assert.equal(body.profile.description,'真实档案');assert.equal('adopted' in body.profile,false);
});
