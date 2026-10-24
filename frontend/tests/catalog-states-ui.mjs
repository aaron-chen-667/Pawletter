import {launchBrowser} from './browser.mjs';
import {catalogFixture} from './cloud-fixture.mjs';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
let finish,requests=0;const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/v1/catalog',route=>{requests++;return new Promise(resolve=>{finish=async(kind)=>{if(kind==='network')await route.abort();else await route.fulfill({status:kind==='service'?503:200,contentType:'application/json',body:JSON.stringify(kind==='empty'?{pets:[]}:kind==='pets'?{pets:catalogFixture}:kind==='invalid'?{}:{error:'UNAVAILABLE'})});resolve();};});});
const action=(name,value)=>page.locator(`[data-action="${name}"]${value?`[data-value="${value}"]`:''}`).first();
async function exclusive(role){await page.locator(`.catalog-state[role="${role}"]`).waitFor();assert.equal(await page.locator('.empty,.hero-pet,.saved-count,.swipe-actions').count(),0);}
async function retry(kind){finish=null;await action('catalog-retry').click();await exclusive('status');await page.waitForFunction(()=>!!document.querySelector('.catalog-state[role=status]'));while(!finish)await new Promise(r=>setTimeout(r,10));await finish(kind);}
try{
 await page.goto('http://localhost:4178/');await exclusive('status');
 await finish('service');await exclusive('alert');assert.match(await page.locator('.catalog-state').innerText(),/服务暂时不可用/);
 await page.screenshot({path:'.preview/catalog-error.png',fullPage:true});
 await action('location').click();assert.equal(await page.locator('#overlay .nearby-stations').count(),0);assert.match(await page.locator('#overlay').innerText(),/服务暂时不可用/);await page.locator('#overlay [data-action="close-modal"]').click();
 await action('discovery-mode','swipe').click();await exclusive('alert');
 await action('discovery-mode','saved').click();await exclusive('alert');
 await retry('network');await exclusive('alert');assert.match(await page.locator('.catalog-state').innerText(),/暂时连接不上服务/);
 await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{value:false,configurable:true}));
 await retry('network');await exclusive('alert');assert.match(await page.locator('.catalog-state').innerText(),/网络已断开/);
 await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{value:true,configurable:true}));
 await retry('invalid');await exclusive('alert');
 await action('nav','mine').click();await action('stations').click();await exclusive('alert');
 await retry('pets');await page.locator('.application-profile').first().waitFor();assert.equal(await page.locator('.catalog-state').count(),0);
 await page.goto('http://localhost:4178/');await exclusive('status');await finish('empty');await page.locator('.empty').waitFor();assert.equal(await page.locator('.catalog-state,[data-action=catalog-retry]').count(),0);assert.match(await page.locator('.empty').innerText(),/这个范围暂时没有/);
 await page.goto('http://localhost:4178/');await exclusive('status');await finish('service');await exclusive('alert');
 await retry('pets');await page.locator('.hero-pet').waitFor();assert.equal(await page.locator('.empty,.catalog-state').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'.preview/catalog-recovered.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: pending, service failure, network failure, offline, invalid payload, saved/swipe/stations, empty success and populated retry; requests='+requests);
}finally{await browser.close();}
