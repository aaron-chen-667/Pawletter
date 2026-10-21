import {fileURLToPath} from 'node:url';
import {launchBrowser} from './browser.mjs';
import {catalogFixture} from './cloud-fixture.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const output=new URL('../.preview/v10/',import.meta.url);await mkdir(output,{recursive:true});
const errors=[],report=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
const answers={work:{text:'朝九晚六，工作日离家九小时。',value:'long'},routine:{text:'早七晚十一，作息比较规律。',value:'regular'},free:{text:'晚上能留出两个小时照顾它。',value:'one2'},expectation:{text:'希望认识安静的成年猫，愿意慢慢陪伴。',value:'quiet'}};
const analysis={title:'忙里忙外的温柔后勤官',summary:'你的白天留给工作，晚上愿意认真陪伴。规律的作息和稳定的照护时间，是你为新伙伴准备的小底气。',highlights:['规律作息','晚上留出陪伴时间','偏爱安静陪伴'],recommendations:[{type:'性格稳定的成年猫',reason:'和你期待的安静陪伴比较接近，仍要确认它在你外出时的照护安排。',basedOn:['work','expectation']}],unknowns:['居住环境与家人意见还待了解']};
const profile={id:'me',nickname:'小禾',realName:'界面验收',phone:'13800000000',verification:'pending',consent:true,lifestyle:{answers,analysis,confirmedAt:Date.now()}};
let applications=[{id:'adoption',petId:'dog',adopterId:'me',name:'小禾',stage:3,version:4,createdAt:Date.now(),snapshot:profile,note:'家人同意，照护安排已确认。'}];catalogFixture[2].profile.adopted=true;
await page.route('https://pawletter-api-446222711695.asia-east1.run.app/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname,method=route.request().method(),body=method==='POST'?route.request().postDataJSON():{};let result={ok:true};
 if(path.endsWith('/catalog')||path==='/v1/pets')result={pets:catalogFixture};
 else if(path.endsWith('/login'))result={token:'fixture',expiresAt:new Date(Date.now()+60000).toISOString(),user:{id:'staff',role:'station',stationId:'warm'}};
 else if(path.endsWith('/register'))result={token:'fixture',expiresAt:new Date(Date.now()+60000).toISOString(),profile};
 else if(path.endsWith('/adopter/profile'))result=profile;
 else if(path.endsWith('/interview'))result={understood:true,value:'unknown',reply:'记下啦，我会把这些放在一起理解。'};
 else if(path.endsWith('/summary'))result=analysis;
 else if(path.endsWith('/agent'))result={voice:{tone:'shy',style:'轻声短句'}};
 else if(path.endsWith('/knowledge'))result={notes:[{id:'n1',quote:'平时喜欢逗猫棒，熟悉后愿意靠近。',topic:'likes',certainty:'ongoing',station:'暖爪救助站',recorded_at:Date.now()}]};
 else if(path.endsWith('/observations'))result={observations:[]};
 else if(path==='/v1/applications')result={applications};
 else if(path.endsWith('/applications')){const a={id:'new',petId:'orange',adopterId:'me',name:'小禾',stage:0,version:1,createdAt:Date.now(),snapshot:profile,note:body.note};applications.unshift(a);result=a;}
 else if(path.endsWith('/chat'))result=method==='GET'?{messages:[{from:'pet',text:'你真的想带我回家呀？我有一点点开心，也有一点点紧张。照顾我的人会先看看申请，我们慢慢来，好不好？'}]}:{answer:'我有一点慢热，熟悉后才愿意慢慢靠近你。照顾我的人记录过，我平时喜欢逗猫棒。',citations:[{quote:'平时喜欢逗猫棒。',station:'暖爪救助站'}]};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
});
const action=(a,v)=>page.locator(`[data-action="${a}"]${v?`[data-value="${v}"]`:''}`).first();
const live=a=>page.locator(`[data-live="${a}"]`).first();
async function shot(name){await page.screenshot({path:fileURLToPath(new URL(name+'.png',output)),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' horizontal overflow');report.push({page:name,buttons:await page.locator('button:visible').count()});}
try{
 await page.goto('http://localhost:4178/');await page.locator('.hero-pet').waitFor();await shot('01-nearby');
 await action('discovery-mode','swipe').click();await shot('02-chance');const bounds=await page.locator('.swipe-actions').boundingBox();console.log('SWIPE_BOUNDS',bounds);assert.ok(bounds.y+bounds.height<844-70,'swipe actions visible in first viewport');
 await action('follow').click();await shot('03-register-gate');await action('close-modal').click();await action('nav','mine').click();await shot('04-guest-mine');await action('register').click();await shot('05-register');
 for(const [name,value] of Object.entries({nickname:'小禾',username:'ui-adopter',password:'test-password-123',realName:'界面验收',phone:'13800000000'}))await page.locator(`[name=${name}]`).fill(value);
 await page.locator('[name=covenant]').check();await page.locator('[name=privacy]').check();await page.locator('#register-form button[type=submit],#register-form button.button.primary').click();
 await shot('06-interview');
 for(const answer of Object.values(answers)){await page.locator('#lifestyle-answer').fill(answer.text);await page.locator('#lifestyle-answer-form button').click();await page.waitForTimeout(80);}
 await action('lifestyle-confirm').waitFor();await shot('07-persona');await action('lifestyle-confirm').click();await page.locator('.discovery-app').waitFor();
 await action('nav','mine').click();await page.locator('.family-pet').waitFor();await shot('08-mine-family');assert.equal(await page.locator('.personal-card [data-action=logout]').count(),0);
 await action('public-profile').click();await shot('09-public-profile');await action('back').click();await action('account').click();await shot('10-account');await action('back').click();
 await action('memory').click();await shot('11-memory');await action('add-memory').click();await shot('12-memory-modal');await action('close-modal').click();await action('back').click();
 await action('ratings').click();await shot('13-ratings');await action('back').click();await action('stations').click();await shot('14-stations');await action('back').click();
 await action('logout').click();await shot('15-logout-modal');await action('close-modal').click();
 await action('nav','meet').click();await action('discovery-mode','nearby').click();await action('follow').click();await action('discovery-mode','saved').click();await shot('16-favorites');
 await action('profile').click();await shot('17-pet-profile');await action('apply').click();await shot('18-application');await page.locator('#application-note').fill('家里已经封窗，家人同意领养。想了解它平时吃什么。');await page.locator('#application-form button[type=submit]').click();await shot('19-application-review');await page.locator('[name=shareProfile]').check();await page.locator('#application-confirm-form button[type=submit]').click();await page.waitForTimeout(100);await shot('20-progress');
 await action('back').click();await action('back').click();await action('chat').click();await page.waitForTimeout(100);await shot('21-pet-chat');await action('chat-options').click();await shot('22-chat-options');await action('close-modal').click();
 await page.goto('http://localhost:4178/');await page.locator('.discovery-tabs').waitFor();await action('nav','messages').click();await shot('23-messages');await action('nav','mine').click();await action('identity').click();await shot('24-role-modal');
 await page.goto('http://localhost:4178/?mode=online&role=station');await shot('25-station-login');await page.locator('[name=username]').fill('staff');await page.locator('[name=password]').fill('test-password');await page.locator('#login-form button').click();await live('voice').waitFor();await shot('26-station-work');
 await live('voice').click();await shot('27-station-voice');await live('home').click();await live('pet').click();await live('agent').waitFor();await shot('28-station-archive');await live('agent').click();await page.locator('#agent-voice-form').waitFor();await shot('29-agent-expression');await live('home').click();await live('new').click();await shot('30-new-pet');await live('home').click();await live('application').click();await shot('31-station-application');
 await page.setViewportSize({width:360,height:640});await page.goto('http://localhost:4178/');await page.locator('.discovery-tabs').waitFor();await action('discovery-mode','swipe').click();await shot('32-small-chance');const smallBounds=await page.locator('.swipe-actions').boundingBox();assert.ok(smallBounds.y+smallBounds.height<=570,'small viewport swipe actions clear navigation');
 await page.goto('http://localhost:4178/?pet=orange&flow=register');await page.locator('.profile-photo').waitFor();assert.equal(await page.locator('.profile-top [data-action=follow]').count(),0);assert.equal(await page.locator('.profile-photo>.profile-like').count(),1);
 await page.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});});await action('share-pet').click();await page.locator('.share-link').waitFor();assert.equal(await page.locator('.share-link').inputValue(),'http://localhost:4178/?pet=orange');await shot('33-share-fallback');
 assert.deepEqual(errors,[]);await writeFile(new URL('report.json',output),JSON.stringify({pages:report,errors},null,2));console.log('PASS '+report.length+' page states, 390×844 and 360×640, no horizontal overflow or page errors');
}finally{await browser.close();}
