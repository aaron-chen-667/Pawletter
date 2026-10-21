import {launchBrowser} from './browser.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await launchBrowser({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera','microphone']});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const action=(a,v)=>page.locator(`[data-action="${a}"]${v?`[data-value="${v}"]`:''}:visible`).last();
const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawletter.demo.v1')));
const snap=name=>page.screenshot({path:fileURLToPath(new URL('../.preview/'+name+'.png',import.meta.url)),fullPage:true});
async function role(value){await action('demo').click();await action('role',value).click();}
async function width(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');}
try{
 await page.goto('http://localhost:4178');
 await action('nav','messages').click();
 assert.ok(await page.locator('.message-item').count()>0);assert.equal(await page.locator('.letter-note,.story-entry').count(),0);
 await role('rescue');assert.equal(await page.locator('.story-entry').count(),0);
 await action('applications').click();await action('application','station-application-toast').click();
 assert.match(await page.locator('.adopter-entry').innerText(),/南南/);
 assert.match(await page.locator('main').innerText(),/手机号|微信号|邮箱/);
 await action('public-profile','station-demo-toast').click();
 assert.match(await page.locator('#profile-applications').innerText(),/吐司/);
 assert.match(await page.locator('#profile-adoptions').innerText(),/糯米/);
 assert.equal(await page.locator('.adoption-rating').count(),2);
 assert.doesNotMatch(await page.locator('main').innerText(),/toast.demo@example.com|13800000000|虚构回访依据/);
 assert.equal(await page.locator('[data-action="application"][data-value="station-history-nannan"]').count(),0);
 await snap('adopter-profile');await width();
 await action('back').click();assert.match(await page.locator('.adopter-entry').innerText(),/南南/);
 await action('nav','tracking').count(); // secondary pages intentionally have no bottom navigation
 await role('rescue');await action('nav','tracking').click();
 assert.match(await page.locator('.tracking-card').filter({hasText:'米粒'}).innerText(),/小禾/);
 const dog=page.locator('.tracking-card').filter({hasText:'可乐'});
 assert.match(await dog.innerText(),/阿远/);
 await snap('adopter-tracking');await dog.locator('[data-action="request-followup"]').click();
 await page.locator('#followup-request-form [name=message]').fill('请拍一张可乐今天的近照，说说食欲和外出情况。');
 await page.locator('#followup-request-form button[type=submit]').click();
 assert.match(await page.locator('.request-card').innerText(),/待领养者回复/);
 await snap('adopter-followup-request');
 await role('user');await action('nav','messages').click();assert.match(await page.locator('.request-card').innerText(),/可乐/);
 await action('respond-request').click();await action('sample-intake').click();await action('to-voice').click();
 await action('sample-voice').click();await action('analyze-intake').click();await action('submit-checkin').click();await action('send-private').click();
 assert.equal((await read()).followupRequests[0].status,'submitted');
 assert.equal((await read()).followups.at(-1).publication.allowed,false);
 await role('rescue');await action('nav','tracking').click();await action('followup','cola').click();
 assert.match(await page.locator('.request-card').innerText(),/已提交/);
 await role('user');await action('nav','mine').click();await action('demo').click();await action('new-registration').click();
 await page.locator('[name=nickname]').fill('小新');await page.locator('[name=covenant]').check();await page.locator('[name=privacy]').check();
 await page.locator('#register-form button[type=submit]').click();
 for(let i=0;i<4;i++){
   await page.locator('#lifestyle-answer-form').waitFor();
   if(i===0){
    await action('lifestyle-record').click();await page.waitForTimeout(600);await action('lifestyle-record').click();
    await page.locator('audio').waitFor();
   }
   await action('lifestyle-sample').click();
   if(i===2)await snap('adopter-onboarding');
   await page.locator('#lifestyle-answer-form button[type=submit]').click();
 }
 assert.equal((await read()).account,null,'registration must not create account before final confirmation');
 assert.equal((await read()).identityRegistry['DEMO-0001'],undefined);
 await action('lifestyle-confirm').click();
 let state=await read();assert.ok(state.account.lifestyle.confirmedAt);assert.ok(state.account.lifestyle.answers.work.audio);
 await action('profile','orange').click();await action('apply','orange').click();
 await page.locator('[name=phone]').fill('13800000000');await page.locator('[name=wechat]').fill('demo_xiaoxin');
 await page.locator('[name=conditions]').fill('家庭成员同意，有独立适应空间。');
 assert.match(await page.locator('[name=profile-work]').inputValue(),/朝九晚六/);
 await snap('adopter-application');await width();
 await page.locator('[name=agree]').check();await page.locator('#application-form button[type=submit]').click();
 state=await read();const application=state.applications.find(a=>a.adopterId===state.account.id);
 assert.equal(application.wechat,'demo_xiaoxin');assert.ok(application.applicantProfile.answers.work.audio);
 await role('rescue');await action('applications').click();await action('application',application.id).click();
 assert.match(await page.locator('main').innerText(),/朝九晚六/);assert.ok(await page.locator('audio').count());
 await snap('adopter-application-review');
 // Refresh must not reset the edited account, pending requests or applications.
 await page.reload();state=await read();assert.equal(state.account.nickname,'小新');assert.equal(state.followupRequests.length,1);
 for(const viewport of [{width:360,height:780},{width:430,height:932},{width:953,height:668}]){
  await page.setViewportSize(viewport);await action('nav','tracking').click();await width();
 }
 assert.deepEqual(errors,[]);console.log('PASS: default data, cross-station profile, contacts, private request/reply, voice onboarding, application snapshot and responsive widths');
}finally{await browser.close();}
