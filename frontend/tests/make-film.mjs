import { launchBrowser } from './browser.mjs';
import {writeFile} from 'node:fs/promises';
const browser=await launchBrowser();
try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:4178/');
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
    const ctx=canvas.getContext('2d');
    const img=new Image();img.src='./assets/orange.jpg';await img.decode();
    const stream=canvas.captureStream(24);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1700000});
    const chunks=[];
    const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>resolve([...new Uint8Array(await new Blob(chunks).arrayBuffer())]);});
    recorder.start();
    const start=performance.now();
    await new Promise(resolve=>{
      function draw(){
        const elapsed=(performance.now()-start)/1000;
        ctx.fillStyle='#f3efe3';ctx.fillRect(0,0,600,800);
        ctx.fillStyle='#7c8c6e';ctx.font='13px sans-serif';ctx.textAlign='center';ctx.fillText('PAWLETTER  /  LITTLE THEATRE',300,48);
        const zoom=1+Math.sin(elapsed*.65)*.025;
        ctx.save();ctx.beginPath();ctx.roundRect(45,90,510,500,32);ctx.clip();
        const ratio=Math.max(510/img.width,500/img.height)*zoom;
        ctx.drawImage(img,300-img.width*ratio/2,340-img.height*ratio/2,img.width*ratio,img.height*ratio);
        ctx.restore();
        ctx.save();ctx.translate(470,130);ctx.rotate(Math.sin(elapsed)*.09);
        ctx.fillStyle='#e97551';ctx.beginPath();ctx.arc(0,0,48,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='white';ctx.font='bold 17px sans-serif';ctx.fillText('验收',0,-3);ctx.fillText('合格',0,21);ctx.restore();
        ctx.fillStyle='#314135';ctx.font='bold 31px "Microsoft YaHei",sans-serif';ctx.fillText(elapsed<2.5?'今日身份：纸箱质检员':'工作原则：先坐为敬',300,648);
        ctx.fillStyle='#8c987e';ctx.font='17px "Microsoft YaHei",sans-serif';ctx.fillText(elapsed<2.5?'橘子的小剧场 · 认真可爱中':'给生活，留一个毛茸茸的位置。',300,690);
        ctx.fillStyle='#e97551';ctx.fillRect(45,728,510*Math.min(elapsed/5,1),3);
        ctx.fillStyle='#a7ac9d';ctx.font='12px "Microsoft YaHei",sans-serif';ctx.fillText('预制创意演示 · 不代表动物真实行为',300,765);
        if(elapsed<5)requestAnimationFrame(draw);else resolve();
      }draw();
    });
    recorder.stop();stream.getTracks().forEach(t=>t.stop());return done;
  });
  await writeFile(new URL('../dist/assets/pawletter-film.webm',import.meta.url),Buffer.from(bytes));
  console.log(`Created creative demo clip: ${bytes.length} bytes`);
}finally{await browser.close();}
