// Normalize browser-specific containers before sending audio to the speech service.
// The original recording stays available for playback and retry.
export function encodeMonoWav(samples, sampleRate=16000) {
 const bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes);
 const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 text(36,'data');view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const n=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,Math.round(n*(n<0?32768:32767)),true);}
 return new Blob([bytes],{type:'audio/wav'});
}
export async function prepareSpeechAudio(blob) {
 if(blob.type.split(';')[0]==='audio/wav')return blob;
 const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
 const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
 if(!Audio||!Offline)throw new Error('当前浏览器无法处理录音，请更新浏览器后重试，或先用文字继续。');
 const context=new Audio();let decoded;
 try{decoded=await context.decodeAudioData(await blob.arrayBuffer());}
 catch{throw new Error('这段录音没有完整保存，请重新录制。');}
 finally{await context.close();}
 if(!decoded.length||decoded.duration<0.25)throw new Error('录音太短，请按住按钮说完一句话再松手。');
 if(decoded.duration>65)throw new Error('录音较长，请控制在 60 秒以内。');
 const offline=new Offline(1,Math.ceil(decoded.duration*16000),16000),source=offline.createBufferSource();
 source.buffer=decoded;source.connect(offline.destination);source.start();
 const rendered=await offline.startRendering();return encodeMonoWav(rendered.getChannelData(0));
}
