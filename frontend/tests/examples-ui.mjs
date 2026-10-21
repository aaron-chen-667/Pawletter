import {launchBrowser} from './browser.mjs';
import {exampleScenes} from '../dist/adopter-examples.js';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844}});
const directory=new URL('../.preview/v11/',import.meta.url);await mkdir(directory,{recursive:true});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://pawletter-api-446222711695.asia-east1.run.app/**',route=>{requests.push(route.request().url());return route.abort();});
await page.addInitScript(()=>sessionStorage.setItem('pawletter.auth.v1','formal-session-sentinel'));
const action=(name,value)=>page.locator(`[data-action="${name}"]${value?`[data-value="${value}"]`:''}`).first();
async function scene(name){await action('example-scenes').click();await action('example-scene',name).click();}
async function shot(name){await page.screenshot({path:fileURLToPath(new URL(name+'.png',directory)),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.loading!=='lazy').every(i=>i.complete&&i.naturalWidth>0)),true,name+' images');}
try{
 await page.goto('http://localhost:4178/?examples=1');await page.locator('.example-toolbar').waitFor();
 for(const [name] of exampleScenes){await scene(name);await shot(name);}
 await scene('messages');await action('chat','orange').click();await page.locator('#chat-input').fill('你喜欢什么？');await page.locator('#chat-form button').click();await page.getByText(/这是预设示例回复/).waitFor();await shot('chat');
 await scene('register');await action('example-registration').click();await page.locator('#register-form button.primary').click();
 for(let i=0;i<4;i++){await action('example-answer').click();if(i<3)await page.getByText(`${i+2} / 4`,{exact:false}).waitFor();}
 await action('lifestyle-confirm').waitFor();await shot('registration-summary');await action('lifestyle-confirm').click();await page.locator('.discovery-tabs').waitFor();
 await scene('apply');await action('example-application').click();await page.locator('#application-form button[type=submit]').click();await shot('application-review');
 await scene('meet');await action('discovery-mode','swipe').click();await page.setViewportSize({width:360,height:640});await shot('chance-small');
 const bounds=await page.locator('.swipe-actions').boundingBox();assert.ok(bounds.y+bounds.height<570,'swipe actions fit');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);assert.equal(await page.evaluate(()=>sessionStorage.getItem('pawletter.auth.v1')),'formal-session-sentinel');
 console.log(JSON.stringify({scenes:exampleScenes.length,errors,apiRequests:requests.length,realSessionPreserved:true}));
}finally{await browser.close();}
