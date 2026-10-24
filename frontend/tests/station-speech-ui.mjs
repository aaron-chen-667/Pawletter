import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844}}),requests=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://pawletter-api-446222711695.asia-east1.run.app/**',r=>{requests.push(r.request().url());return r.abort();});
try{
 await page.goto('http://localhost:4178/?mode=online&role=station&examples=1');await page.locator('[data-live=voice]').click();
 assert.equal(await page.locator('#hold-record').count(),0);assert.match(await page.locator('.voice-composer').textContent(),/预设文字.*不录音.*不上传/);
 await page.locator('[data-live=sample-observation]').click();assert.match(await page.locator('#observation-text').inputValue(),/橘子.*逗猫棒/);assert.equal(await page.locator('#live-error').textContent(),'');
 await page.locator('[data-live=submit-text]').click();await page.locator('#record-panel').waitFor();assert.match(await page.locator('#record-panel').textContent(),/今天换粮后有点软便/);
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({exampleAudioUploads:0,explicitPreset:true,confirmArchive:true,errors}));
}finally{await browser.close();}
