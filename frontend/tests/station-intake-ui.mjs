import {launchBrowser} from './browser.mjs';
import {stationScenes} from '../dist/station-examples.js';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],apiCalls=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://pawletter-api-446222711695.asia-east1.run.app/**',r=>{apiCalls.push(r.request().url());return r.abort();});
await mkdir('.preview/v12',{recursive:true});
const click=(a,id)=>page.locator(`[data-live="${a}"]${id?`[data-id="${id}"]`:''}`).first().click();
const intake=a=>page.locator(`[data-intake="${a}"]`).first().click();
async function scene(id){await click('scenes');await click('scene',id);}
try{
 await page.goto('http://localhost:4178/?mode=online&role=station&examples=1');await page.locator('.station-nav').waitFor();
 for(const [id] of stationScenes){await scene(id);await page.screenshot({path:`.preview/v12/${id}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),id+' overflows');}
 await scene('new');await intake('sample');await page.locator('.intake-media img').waitFor();await intake('describe');await intake('analyze');await page.locator('[data-intake=unknown]').waitFor();await intake('unknown');await page.locator('#intake-confirm').waitFor();
 assert.equal(await page.locator('[name=published]').isChecked(),false);await page.screenshot({path:'.preview/v12/intake-review.png',fullPage:true});
 await page.locator('#intake-confirm button.primary').click();await page.locator('.station-pet-cover').waitFor();assert.match(await page.locator('.topbar-title').textContent(),/小满/);
 await scene('voice');await click('sample-observation');await page.getByText('今天换粮后有点软便',{exact:false}).first().waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(apiCalls,[]);
 console.log(JSON.stringify({scenes:stationScenes.length,photoVoiceConfirm:true,privateDefault:true,exampleApiCalls:0,errors}));
}finally{await browser.close();}
