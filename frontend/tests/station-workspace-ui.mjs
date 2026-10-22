import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const click=(a,id)=>page.locator(`[data-live="${a}"]${id?`[data-id="${id}"]`:''}`).first().click();
await mkdir('.preview/v13',{recursive:true});
try{
 await page.goto('http://localhost:4178/?mode=online&role=station&examples=1');await page.locator('.station-nav').waitFor();
 assert.equal(await page.locator('.station-nav button').count(),4);assert.equal(await page.locator('[data-live=pet]').count(),0);
 await click('application');assert.equal(await page.locator('.application-pair .person-pet-avatar').count(),2);assert.match(await page.locator('.contact-details').textContent(),/电话.*00000000000.*微信.*pawletter_example/s);await click('applicant');await page.locator('.applicant-hero').waitFor();await page.screenshot({path:'.preview/v13/applicant.png',fullPage:true});
 await click('home');await click('pets');await page.locator('[data-ws-filter=pet][data-value=adopted]').click();assert.equal(await page.locator('[data-live=pet]').count(),4);await click('pet');await page.locator('.gallery-rail').waitFor();await click('media');await page.locator('[data-media-file=album]').setInputFiles('dist/assets/orange.jpg');await page.locator('.media-upload-previews img').waitFor();await page.locator('#media-caption').fill('今天在窗边休息');await page.locator('[data-media-save]').click();await page.getByText('今天在窗边休息',{exact:false}).waitFor();
 await page.screenshot({path:'.preview/v13/gallery.png',fullPage:true});
 await click('home');await click('pets');await page.locator('[data-ws-filter=pet][data-value=all]').click();await click('pet');await page.locator('[data-ws-filter=record][data-value=withdrawn]').click();assert.equal(await page.locator('#record-panel .online-card').count(),1);await page.locator('[data-ws-filter=knowledge][data-value=health]').click();await click('source-record');assert.equal(await page.locator('#record-panel .online-card').count(),1);assert.match(await page.locator('#record-panel').textContent(),/食欲/);
 await click('home');await click('followups');await click('followup-new');await page.locator('[name=note]').fill('到家第七天联系，确认食欲和适应情况。');await page.locator('#followup-form button').click();await page.locator('[data-live=followup]').first().waitFor();await page.locator('[data-live=followup]').last().click();await page.locator('[name=status]').selectOption('attention');await page.locator('[name=note]').fill('食欲减少，已提醒进一步确认，需要继续跟进。');await page.locator('#followup-form button').click();await page.locator('[data-ws-filter=followup][data-value=attention]').click();assert.equal(await page.locator('[data-live=followup]').count(),2);await page.screenshot({path:'.preview/v13/followups.png',fullPage:true});
 await page.reload();await page.locator('.station-nav').waitFor();await click('followups');await page.locator('[data-live=followup]').last().click();assert.match(await page.locator('main').textContent(),/食欲减少/);
 await click('home');await click('new');await page.locator('[data-intake=sample]').click();await page.locator('[data-intake=analyze]').click();await page.locator('#intake-confirm').waitFor();await page.screenshot({path:'.preview/v13/intake-chat.png',fullPage:true});
 for(const width of [360,390,460]){await page.setViewportSize({width,height:640});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const composer=await page.locator('.intake-composer').boundingBox();assert.ok(composer.y+composer.height<=641);}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({avatars:true,contacts:true,petFilters:true,mediaPersisted:true,sourceSearch:true,followupPersisted:true,chatFitsSmallScreen:true,errors}));
}finally{await browser.close();}
