import {prepareSpeechAudio} from './audio-upload.js';
const API='https://pawletter-api-446222711695.asia-east1.run.app';
export function createOnboardingSpeech(fetcher=fetch,prepareAudio=prepareSpeechAudio){
 let generation=0,controller;
 function cancel(){generation++;controller?.abort();}
 async function transcribe(audioUrl){
  cancel();const current=generation;controller=new AbortController();const activeController=controller,signal=controller.signal;
  const timeout=setTimeout(()=>activeController.abort(),70000);
  try{
   const original=await (await fetcher(audioUrl,{signal})).blob();
   if(original.size>6*1024*1024)throw new Error('录音太大，请缩短后重新说一段。');
   const blob=await prepareAudio(original);
   if(current!==generation)return null;
   const response=await fetcher(`${API}/v1/onboarding/transcribe`,{method:'POST',body:blob,signal,headers:{'Content-Type':blob.type.split(';')[0]}});
   if(!response.ok){
    let data={};try{data=await response.json();}catch{}
    const message=data.error==='SPEECH_PROVIDER_BUSY'?'语音服务暂时繁忙，请等 30 秒后重试。录音已保留，也可以先用文字继续。':data.error==='INVALID_AUDIO_FILE'?'这段录音没有完整保存，请重新录制。':response.status===429?'转写暂时繁忙，请稍后重试。录音已保留。':'语音服务暂时没有完成转写，录音已保留，可以重试。';
    throw new Error(message);
   }
   const result=await response.json();
   if(typeof result.text!=='string'||!result.text.trim())throw new Error('没有识别到清晰的话语，请重录或输入文字。');
   return current===generation?{text:result.text.trim()}:null;
  }catch(error){return current===generation?{error:error.name==='AbortError'?'转写超时，录音已保留，请重试。':error.message}:null;}
  finally{clearTimeout(timeout);}
 }
 return {cancel,transcribe};
}
