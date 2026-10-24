// Diagnostic reproduction of known integration gaps; not a passing feature-acceptance test.
import {JSDOM} from 'jsdom';
import {catalogFixture} from './cloud-fixture.mjs';
const missing=process.argv.includes('--missing-pet');
const dom=new JSDOM('<div id="app"></div><div id="overlay"></div><div id="toast"></div>',{url:'https://pawletter.invalid/',pretendToBeVisual:true});
const {window}=dom;window.scrollTo=()=>{};const requests=[],errors=[];
process.on('unhandledRejection',error=>errors.push(error.message));
window.addEventListener('error',e=>{errors.push(e.message);e.preventDefault();});
let stage=0;
const profile={id:'audit-adopter',nickname:'QA',consent:false,verification:'pending'};
const application=()=>({id:'audit-app',adopterId:profile.id,petId:'orange',stationId:'warm',stage,version:stage+1,snapshot:{nickname:'QA'}});
const fetcher=async url=>{
 requests.push(url);let data;
 if(url.endsWith('/adopter/profile'))data=profile;
 else if(url.endsWith('/catalog'))data={pets:missing?[]:catalogFixture};
 else if(url.endsWith('/applications'))data={applications:[application()]};
 else if(url.endsWith('/chat'))data={messages:[{from:'pet',text:'New station stage notification',at:Date.now()}]};
 else throw new Error('Unexpected audit request');
 return {ok:true,status:200,json:async()=>data};
};
for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,location:window.location,history:window.history,localStorage:window.localStorage,sessionStorage:window.sessionStorage,fetch:fetcher,requestAnimationFrame:window.requestAnimationFrame.bind(window)}))Object.defineProperty(globalThis,key,{value,configurable:true});
sessionStorage.setItem('pawletter.auth.v1',JSON.stringify({token:'mock-session',expiresAt:Date.now()+3600000}));
await import('../dist/app.js');await new Promise(r=>setTimeout(r,80));
stage=1;
document.querySelector('[data-action=nav][data-value=mine]').click();
document.querySelector('[data-action=progress]').click();
await new Promise(r=>setTimeout(r,50));
const report={scenario:missing?'application pet no longer in public catalog':'station changed stage after adopter login',applicationRequests:requests.filter(u=>u.endsWith('/applications')).length,renderErrors:errors,progressText:document.querySelector('.application-card')?.textContent};
if(!missing){
 document.querySelector('[data-action=back]').click();
 document.querySelector('[data-action=nav][data-value=messages]').click();
 report.messageHistoryRequests=requests.filter(u=>u.endsWith('/chat')).length;
 report.messageListEmpty=document.querySelector('.messages-page').textContent.includes('还没有开始聊天');
}
console.log(JSON.stringify(report));window.close();
