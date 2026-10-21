import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const action=(a,v)=>page.locator(`[data-action="${a}"]${v?`[data-value="${v}"]`:''}:visible`).last();
const snapshot=name=>page.screenshot({path:fileURLToPath(new URL('../.preview/'+name+'.png',import.meta.url)),fullPage:true,style:'#toast{visibility:hidden!important}'});
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawletter.demo.v1')));
const width=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
async function role(r){if(!await action('demo').count())await action('back').click();await action('demo').click();await action('role',r).click();}
async function mine(){await role('user');await action('nav','mine').click();}
async function checkin(){
  await mine();await action('progress').click();await action('followup','orange').click();
  await action('start-checkin','orange').click();await action('sample-intake').click();await action('to-voice').click();
  await action('sample-voice').click();await action('analyze-intake').click();await action('submit-checkin').click();
}
try{
  await page.goto('http://localhost:4178');
  await action('discovery-mode','swipe').click();
  await page.waitForFunction(()=>document.querySelector('.hero-image')?.complete);
  await snapshot('18-larger-swipe');await width();
  assert.ok(await page.locator('.hero-image-button').evaluate(el=>el.getBoundingClientRect().height>=380),'photo expanded to 380+ px at 844px viewport');
  const headerLocation=await page.locator('.header-location').boundingBox();
  assert.ok(headerLocation.x>195&&headerLocation.y<90,'location control at top right');
  assert.equal(await page.locator('.station-link').count(),0,'no duplicate footer location');
  await action('station','warm').click();
  assert.match(await page.locator('.station-heading').innerText(),/暖爪救助站/);
  assert.ok(await page.locator('.station-pet').count()>=1);
  await snapshot('19-station-home');await width();
  await action('chat','orange').click();assert.match(await page.locator('.topbar-title').innerText(),/橘子/);
  await mine();await action('station-onboarding').click();
  await page.locator('#station-request-form button[type=submit]').click();
  assert.equal((await state()).stationRequests[0].status,'pending');
  assert.equal((await state()).role,'user','station request must not open station role');
  await snapshot('20-station-onboarding');
  await role('user');await action('profile','orange').click();await action('apply','orange').click();
  await page.locator('#register-form').waitFor();
  assert.equal(await page.locator('[name=covenant]').isChecked(),false);
  assert.equal(await page.locator('[name=privacy]').isChecked(),false);
  await page.locator('#register-form button[type=submit]').click();
  assert.equal((await state()).account,null);
  await snapshot('21-registration');await width();
  await page.locator('[name=nickname]').fill('小禾与毛茸茸');
  await page.locator('[name=covenant]').check();await page.locator('[name=privacy]').check();
  await page.locator('#register-form button[type=submit]').click();
  await page.locator('#application-form').waitFor();
  await page.locator('[name=conditions]').fill('示例照护条件');
  await page.locator('[name=agree]').check();await page.locator('#application-form button[type=submit]').click();
  await role('rescue');await action('applications').click();await action('application').click();
  for(let i=0;i<3;i++)await action('advance').click();
  await mine();await action('public-profile').click();
  assert.match(await page.locator('.not-rated').innerText(),/尚未评价/);
  assert.equal(await page.locator('.rating-number').count(),0);
  await role('rescue');await action('ratings').click();
  await page.locator('[name=score][value="0"]').check();
  await page.locator('[name=note]').fill('私密评价依据：回访还需要人工核实。');
  await page.locator('[name=confirmRating]').check();await page.locator('.rating-form button[type=submit]').click();
  assert.equal((await state()).ratings[0].score,0);
  await snapshot('22-rating-zero');
  await action('public-profile').click();
  assert.equal(await action('unpublish-moment').count(),0,'station cannot withdraw adopter publications');
  await mine();await action('public-profile').click();
  assert.match(await page.locator('.rating-number').innerText(),/0/);
  assert.doesNotMatch(await page.locator('.main').innerText(),/私密评价依据|DEMO-0001|demo@example/);
  await action('ratings').click();await action('rating-appeal').click();assert.ok((await state()).ratings[0].appeal);
  // Every send requires a fresh choice; closing the dialog does not submit.
  await checkin();await snapshot('23-sharing-consent');
  await action('close-modal').click();assert.equal((await state()).followups.length,0);
  await action('submit-checkin').click();await action('send-private').click();
  await page.locator('.feedback-card').waitFor();
  assert.equal((await state()).followups[0].publication.allowed,false);
  await mine();await action('public-profile').click();assert.equal(await page.locator('.public-moment').count(),0);
  await checkin();await action('send-public').click();await page.locator('.feedback-card').first().waitFor();
  await mine();await action('public-profile').click();
  assert.equal(await page.locator('.public-moment').count(),1);
  assert.doesNotMatch(await page.locator('.public-moment').innerText(),/吃得比平时少|担心|私密/);
  await snapshot('24-adopter-profile');await width();
  await page.reload();await action('nav','mine').click();await action('public-profile').click();
  assert.equal(await page.locator('.public-moment').count(),1);
  await action('unpublish-moment').click();assert.equal(await page.locator('.public-moment').count(),0);
  assert.equal((await state()).followups.length,2);
  // Reach the next evaluation period through demo time and retain history.
  await role('rescue');
  for(let i=0;i<4;i++){await action('demo').click();await action('next-day').click();}
  assert.equal((await state()).day,60);
  await role('rescue');await action('ratings').click();
  assert.match(await page.locator('.evaluation-due').innerText(),/待完成/);
  await page.locator('[name=score][value="5"]').check();await page.locator('[name=note]').fill('本次回访已核实，继续按约定跟进。');
  await page.locator('[name=confirmRating]').check();await page.locator('.rating-form button[type=submit]').click();
  assert.equal((await state()).ratings.length,2);
  await snapshot('25-evaluation-history');
  // Different station has no authority to review this adoption.
  await action('demo').click();await page.locator('[name=stationId]').selectOption('garden');await page.locator('#station-switch-form button').click();
  await action('ratings').click();assert.equal(await page.locator('.evaluation-card').count(),0);
  for(const w of [360,375,430]){
    await page.setViewportSize({width:w,height:844});await mine();await action('public-profile').click();await width();
    await mine();await action('stations').click();await action('station','garden').click();await width();
  }
  await page.setViewportSize({width:390,height:844});await role('user');await action('discovery-mode','swipe').click();
  assert.ok(await page.locator('.swipe-actions').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.bottom-nav').getBoundingClientRect().top),'swipe actions clear bottom nav');
  for(const [w,h] of [[375,667],[390,740],[953,668]]){
    await page.setViewportSize({width:w,height:h});await page.waitForFunction(()=>Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--chat-height'))-window.visualViewport.height)<1);await width();
    assert.ok(await page.locator('.swipe-actions').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.bottom-nav').getBoundingClientRect().top),`swipe actions clear navigation at ${w}x${h}`);
    await snapshot(`26-swipe-${w}-${h}`);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: registration gate/agreements, manual station onboarding, station/pet/Agent links, 0-star and periodic ratings, station scope, cancel/private/public/withdraw consent, private field isolation, persistence, enlarged photos and top-right location, mobile widths.');
}catch(e){await snapshot('community-failure');throw e;}finally{await browser.close();}
