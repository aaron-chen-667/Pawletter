import {fileURLToPath} from 'node:url';
import {launchBrowser} from './browser.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const browser=await launchBrowser();
try {
 const page=await browser.newPage();
 await page.route('**/audio-upload.js',route=>route.fulfill({path:fileURLToPath(new URL('../dist/audio-upload.js',import.meta.url)),contentType:'text/javascript'}));
 await page.goto('https://pawletter-adoption-h5.chenaaron668.chatgpt.site/');
 const wav=(await readFile('../Pawletter/backend/.local/verification.wav')).toString('base64');
 const result=await page.evaluate(async encoded=>{
  const context=new AudioContext(),buffer=await context.decodeAudioData(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)).buffer);
  const source=context.createBufferSource(),destination=context.createMediaStreamDestination();source.buffer=buffer;source.connect(destination);
  const chunks=[],recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm'});
  const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve;});
  recorder.start(250);source.onended=()=>recorder.stop();source.start();await done;await context.close();
  const blob=new Blob(chunks,{type:recorder.mimeType});
  const {prepareSpeechAudio}=await import('/audio-upload.js');const prepared=await prepareSpeechAudio(blob);
  const response=await fetch('https://pawletter-api-446222711695.asia-east1.run.app/v1/onboarding/transcribe',{method:'POST',headers:{'Content-Type':prepared.type},body:prepared});const data=await response.json();
  let interviewStatus;if(data.text){const reply=await fetch('https://pawletter-api-446222711695.asia-east1.run.app/v1/onboarding/interview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'work',text:data.text})});interviewStatus=reply.status;}
  return {status:response.status,error:data.error,requestId:data.requestId,hasText:!!data.text,mime:blob.type,uploadMime:prepared.type,interviewStatus,size:blob.size,audio:await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);})};
 },wav);
 await writeFile('../Pawletter/backend/.local/verification-browser.webm',Buffer.from(result.audio,'base64'));delete result.audio;console.log(result);
} finally {await browser.close();}


