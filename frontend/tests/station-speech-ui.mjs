import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844}}),requests=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://pawletter-api-446222711695.asia-east1.run.app/**',r=>{requests.push(r.request().url());return r.abort();});
try{
 await page.goto(`${process.env.INTAKE_BASE_URL||'http://localhost:4178'}/?mode=online&role=station&examples=1`);await page.locator('.station-action-dock [data-live=voice]').click();
 await page.locator('[data-daily=pick]').first().click();await page.locator('#daily-record').click();assert.match(await page.locator('#daily-text').inputValue(),/逗猫棒/);
 await page.locator('[data-daily=panel]').click();await page.locator('[data-daily=sample-photo]').click();await page.locator('.daily-thumb img').waitFor();
 await page.locator('[data-daily=sheet]').click();await page.locator('[data-daily=day]').nth(1).click();assert.match(await page.locator('.daily-entry header').textContent(),/昨天/);
 await page.locator('[data-daily=save]').click();await page.locator('.online-card.just-added').waitFor();assert.match(await page.locator('.online-card.just-added').textContent(),/昨天 · 刚追加/);assert.equal(await page.locator('.online-card.just-added .record-visuals img').count(),1);
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({exampleAudioUploads:0,datedWithPhoto:true,errors}));
}finally{await browser.close();}
