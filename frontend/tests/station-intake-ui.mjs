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
 await page.goto(`${process.env.INTAKE_BASE_URL||'http://localhost:4178'}/?mode=online&role=station&examples=1`);await page.locator('.station-nav').waitFor();
 for(const [id] of stationScenes){await scene(id);await page.screenshot({path:`.preview/v12/${id}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),id+' overflows');}
 await scene('new');await page.locator('#intake-answer').waitFor();await intake('attachments');await intake('sample');await page.locator('.intake-material-grid img').waitFor();
 assert.equal(await page.locator('.intake-confirm-card').count(),0);assert.equal(await page.locator('#intake-send').count(),0);assert.equal(await page.locator('[name=published]').count(),0);
 await page.locator('#intake-record').click();assert.match(await page.locator('#intake-answer').inputValue(),/今天刚接回一只橘猫/);assert.equal(await page.locator('#intake-confirm').count(),1);
 const finalText='这只橘猫今天刚送来，还没起名字，大概一岁。人靠近会躲，刚吃了点罐头。';await page.locator('#intake-answer').fill(finalText);
 await page.screenshot({path:'.preview/v12/intake-review.png',fullPage:true});
 await page.locator('#intake-confirm button.primary').click();await page.locator('.intake-guide').waitFor();await page.screenshot({path:'.preview/v12/intake-guide.png',fullPage:true});
 await page.locator('#intake-confirm button.primary').click();await page.locator('.station-pet-cover').waitFor();assert.match(await page.locator('.topbar-title').textContent(),/待命名小猫/);assert.ok((await page.locator('.main').textContent()).includes('人靠近会躲'));assert.equal(await page.locator('[aria-label="向领养者公开"]').getAttribute('aria-checked'),'false');
 await scene('voice');await click('sample-observation');assert.match(await page.locator('#observation-text').inputValue(),/今天换粮后有点软便/);assert.match(await page.locator('.topbar-title').textContent(),/给宠物补充/);await click('submit-text');await page.getByText('今天换粮后有点软便',{exact:false}).first().waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(apiCalls,[]);
 console.log(JSON.stringify({scenes:stationScenes.length,photoVoiceConfirm:true,privateDefault:true,exampleApiCalls:0,errors}));
}finally{await browser.close();}
