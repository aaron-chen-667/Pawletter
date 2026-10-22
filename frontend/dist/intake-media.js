export const toDataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
function frame(source,width,height){const c=document.createElement('canvas'),ratio=Math.min(1,1024/Math.max(width,height));c.width=Math.round(width*ratio);c.height=Math.round(height*ratio);c.getContext('2d').drawImage(source,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.78);}
export async function imageData(file){
 if(file.size>15*1024*1024)throw Error('图片过大，请选择 15 MB 以内的图片。');const url=URL.createObjectURL(file),img=new Image();
 try{await new Promise((ok,bad)=>{img.onload=ok;img.onerror=()=>bad(Error('无法读取图片，请换一张 JPEG、PNG 或 WebP 图片。'));img.src=url;});return frame(img,img.naturalWidth,img.naturalHeight);}finally{URL.revokeObjectURL(url);}
}
export async function videoData(file){
 if(file.size>10*1024*1024)throw Error('视频请控制在 10 MB 以内，建议录制 15 秒。');if(!['video/mp4','video/webm'].includes(file.type))throw Error('请选择 MP4 或 WebM 视频。');
 const url=URL.createObjectURL(file),video=document.createElement('video');video.muted=true;video.playsInline=true;
 try{await new Promise((ok,bad)=>{video.onloadedmetadata=ok;video.onerror=()=>bad(Error('无法读取视频，请重新录制。'));video.src=url;});if(!Number.isFinite(video.duration)||video.duration>30)throw Error('视频请控制在 30 秒以内。');
  const frames=[];for(const position of [.2,.7]){await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('视频读取超时，请换一段视频。')),10000);video.onseeked=()=>{clearTimeout(timer);ok();};video.currentTime=Math.max(.01,video.duration*position);});frames.push(frame(video,video.videoWidth,video.videoHeight));}return {dataUrl:await toDataURL(file),frames};
 }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
