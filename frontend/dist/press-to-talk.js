export function createPressToTalk({capture,onChange,onSend}){
 let epoch=0,recognition=null,startY=0;
 const state={holding:false,finishing:false,cancelling:false,live:'',realtime:false};
 function stopRecognition(){try{recognition?.abort();}catch{}recognition=null;}
 async function start(y){
  if(state.holding||state.finishing)return;const current=++epoch;startY=y;state.holding=true;state.cancelling=false;state.live='';state.realtime=false;onChange();
  await capture.reset();if(current!==epoch)return;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(Recognition){try{recognition=new Recognition();recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;recognition.onresult=e=>{if(current!==epoch)return;state.live=Array.from(e.results).map(r=>r[0].transcript).join('');onChange();};recognition.onerror=()=>{state.realtime=false;onChange();};recognition.start();state.realtime=true;}catch{state.realtime=false;}}
  await capture.recordVoice();if(current===epoch)onChange();
 }
 function move(y){if(!state.holding)return;state.cancelling=startY-y>65;onChange();}
 async function end(cancel=false){
  if(!state.holding)return;const cancelled=cancel||state.cancelling;state.holding=false;state.finishing=true;const current=++epoch;stopRecognition();onChange();
  try{await capture.stopVoice();if(current!==epoch)return;
   if(cancelled){await capture.reset();state.live='';state.cancelling=false;return;}
   if(capture.media.audioUrl)await onSend(capture.media.audioUrl,state.live);
  }finally{state.finishing=false;onChange();}
 }
 function cancel(){epoch++;state.holding=false;state.finishing=false;state.cancelling=false;state.live='';stopRecognition();capture.stopVoice();}
 return {state,start,move,end,cancel};
}
