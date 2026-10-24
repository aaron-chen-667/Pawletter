export const toDataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
function frame(source,width,height){const c=document.createElement('canvas'),ratio=Math.min(1,1024/Math.max(width,height));c.width=Math.round(width*ratio);c.height=Math.round(height*ratio);c.getContext('2d').drawImage(source,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.78);}
export async function imageData(file){
 if(file.size>15*1024*1024)throw Error('图片过大，请选择 15 MB 以内的图片。');const url=URL.createObjectURL(file),img=new Image();
 try{await new Promise((ok,bad)=>{img.onload=ok;img.onerror=()=>bad(Error('无法读取图片，请换一张 JPEG、PNG 或 WebP 图片。'));img.src=url;});return frame(img,img.naturalWidth,img.naturalHeight);}finally{URL.revokeObjectURL(url);}
}
function videoEvent(video,event,action){
 return new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);video.removeEventListener(event,ready);video.removeEventListener('error',failed);error?reject(error):resolve();};
  const ready=()=>finish(),failed=()=>finish(Error('无法读取视频，请重新录制。'));
  const timer=setTimeout(()=>finish(Error('视频读取超时，请换一段视频。')),10000);
  video.addEventListener(event,ready,{once:true});video.addEventListener('error',failed,{once:true});
  try{action();}catch{failed();}
 });
}
export async function videoData(file){
 const mime=file.type.toLowerCase().split(';',1)[0].trim();
 if(file.size>10*1024*1024)throw Error('视频请控制在 10 MB 以内，建议录制 15 秒。');if(!['video/mp4','video/webm'].includes(mime))throw Error('请选择 MP4 或 WebM 视频。');
 const url=URL.createObjectURL(file),video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
 try{
  await videoEvent(video,'loadedmetadata',()=>{video.src=url;});
  let duration=video.duration;
  // MediaRecorder WebM may omit its duration. Seek to the end of the local blob
  // so the decoder determines the real bound before enforcing the duration limit.
  if(!Number.isFinite(duration)){
   const beyondEnd=Number.MAX_SAFE_INTEGER;
   await videoEvent(video,'seeked',()=>{video.currentTime=beyondEnd;});
   duration=Number.isFinite(video.duration)?video.duration:video.currentTime;
   if(!Number.isFinite(duration)||duration>=beyondEnd)throw Error('无法确定视频时长，请重新录制。');
  }
  if(duration<=0||!video.videoWidth||!video.videoHeight)throw Error('无法读取视频，请重新录制。');
  if(duration>30)throw Error('视频请控制在 30 秒以内。');
  const frames=[];
  for(const position of [.2,.7]){
   const target=duration*position;
   if(Math.abs(video.currentTime-target)>.001)await videoEvent(video,'seeked',()=>{video.currentTime=target;});
   frames.push(frame(video,video.videoWidth,video.videoHeight));
  }
  // Strip optional codec parameters from the data URL's media type while
  // preserving the encoded bytes, matching the upload API's container types.
  return {dataUrl:await toDataURL(file.slice(0,file.size,mime)),frames};
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
