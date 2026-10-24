import {prepareSpeechAudio} from './audio-upload.js';
const API='https://pawletter-api-446222711695.asia-east1.run.app';
export function createOnboardingSpeech(fetcher=fetch,prepareAudio=prepareSpeechAudio){
 let generation=0,controller;
 function cancel(){generation++;controller?.abort();}
 async function transcribe(audioUrl){
  cancel();const current=generation;controller=new AbortController();const activeController=controller,signal=controller.signal;
  const timeout=setTimeout(()=>activeController.abort(),70000);let phase='recording';
  try{
   const original=await (await fetcher(audioUrl,{signal})).blob();
   if(original.size>6*1024*1024)throw new Error('录音太大，请缩短后重新说一段。');
   phase='prepare';const blob=await prepareAudio(original);
   if(current!==generation)return null;
   phase='upload';const response=await fetcher(`${API}/v1/onboarding/transcribe`,{method:'POST',body:blob,signal,headers:{'Content-Type':blob.type.split(';')[0]}});
   if(!response.ok){
    let data={};try{data=await response.json();}catch{}
    const message=data.error==='SPEECH_PROVIDER_BUSY'?'语音服务暂时繁忙，请等 30 秒后重试。录音已保留，也可以先用文字继续。':data.error==='INVALID_AUDIO_FILE'?'这段录音没有完整保存，请重新录制。':response.status===429?'转写暂时繁忙，请稍后重试。录音已保留。':'语音服务暂时没有完成转写，录音已保留，可以重试。';
    throw new Error(message);
   }
   phase='response';const result=await response.json();
   if(typeof result.text!=='string'||!result.text.trim())throw new Error('没有识别到清晰的话语，请重录或输入文字。');
   return current===generation?{text:result.text.trim()}:null;
  }catch(error){
   if(current!==generation)return null;
   const network=error instanceof TypeError||/failed to fetch|load failed|networkerror|network request failed/i.test(error.message||'');
   const message=error.name==='AbortError'?'转写超时，录音已保留，可以重试或先用文字继续。':network?(phase==='recording'?'这段录音暂时无法读取，请重新录制或用文字继续。':'暂时连接不上语音服务，录音已保留。请检查网络后点击“重新转录”，也可以先用文字继续。'):phase==='response'&&error instanceof SyntaxError?'语音服务返回异常，录音已保留，请稍后重试。':error.message;
   return {error:message||'这次转写未完成，录音已保留，可以重试。'};
  }
  finally{clearTimeout(timeout);}
 }
 return {cancel,transcribe};
}
