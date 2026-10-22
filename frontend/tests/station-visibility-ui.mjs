import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const click=a=>page.locator(`[data-live=${a}]`).first().click();
try{
 await page.goto('http://localhost:4178/?mode=online&role=station&examples=1');await page.locator('.station-nav').waitFor();
 for(const width of [320,390,460]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.station-chips').evaluate(el=>el.scrollWidth<=el.clientWidth));assert.equal(await page.locator('.station-chips').evaluate(el=>getComputedStyle(el).flexWrap),'wrap');}
 await page.setViewportSize({width:390,height:844});await click('pets');await page.locator('[data-ws-filter=pet][data-value=draft]').click();await click('pet');
 const toggle=page.getByRole('switch',{name:'向领养者公开'});assert.equal(await toggle.getAttribute('aria-checked'),'false');await toggle.click();await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='true');await page.screenshot({path:'.preview/v14-visibility.png',fullPage:true});
 await click('home');await click('pets');assert.equal(await page.locator('[data-live=pet]').count(),0);await page.locator('[data-ws-filter=pet][data-value=waiting]').click();const pet=page.locator('[data-live=pet]').filter({hasText:'麦麦'});await pet.click();await toggle.click();await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false');
 await page.reload();await click('pets');await page.locator('[data-ws-filter=pet][data-value=draft]').click();assert.match(await page.locator('[data-live=pet]').textContent(),/麦麦/);await click('pet');assert.equal(await toggle.getAttribute('aria-checked'),'false');assert.deepEqual(errors,[]);console.log(JSON.stringify({wrapAllWidths:true,publicationToggle:true,persisted:true,filterUpdated:true,errors}));
}finally{await browser.close();}
