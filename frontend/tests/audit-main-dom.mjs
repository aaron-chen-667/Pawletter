// Diagnostic only: reproduces deployment skew or a stale station application list.
import {JSDOM} from 'jsdom';
const oldApi=process.argv.includes('--old-api');
const dom=new JSDOM('<div id="app"></div>',{url:'https://pawletter.invalid/?mode=online&role=station'}),w=dom.window;
for(const [key,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,location:w.location,FormData:w.FormData}))Object.defineProperty(globalThis,key,{value,configurable:true});
let applicationReads=0,rows=[];
globalThis.fetch=async url=>{
 if(url.endsWith('/login'))return Response.json({token:'mock',user:{id:'staff',role:'station',stationId:'s'}});
 if(url.endsWith('/stations'))return oldApi?Response.json({error:'Not Found'},{status:404}):Response.json({stations:[{id:'s',name:'本站'}]});
 if(url.endsWith('/pets'))return Response.json({pets:[{id:'p',name:'伙伴',stationId:'s',published:true,profile:{species:'cat'}}]});
 if(url.endsWith('/applications')){applicationReads++;return Response.json({applications:rows});}
 if(url.endsWith('/followups'))return Response.json({followups:[]});
 throw Error('Unexpected request');
};
const pause=()=>new Promise(r=>setTimeout(r,60));
try{
 await import('../dist/online.js');
 document.querySelector('[name=username]').value='mock';document.querySelector('[name=password]').value='mock-password';
 document.querySelector('#login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await pause();
 if(oldApi)console.log(JSON.stringify({scenario:'main station UI with deployed /stations 404',stuckAtLogin:!!document.querySelector('#login-form'),error:document.querySelector('#live-error')?.textContent}));
 else{
  rows=[{id:'new-app',petId:'p',stationId:'s',name:'新申请人',stage:0,version:1,note:'新提交申请',snapshot:{verification:'pending'}}];
  document.querySelector('[data-live=applications]').click();await pause();
  console.log(JSON.stringify({scenario:'new adopter application after station login',applicationReads,newApplicationVisible:!!document.querySelector('[data-live=application][data-id=new-app]'),text:document.querySelector('.result-count')?.textContent}));
 }
}finally{w.close();}
