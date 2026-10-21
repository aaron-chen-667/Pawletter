const modulePath=new URLSearchParams(location.search).get('mode')==='online'?'./online.js':'./app.js';
import(modulePath).catch(()=>{document.querySelector('#app').innerHTML='<main class="main"><h1>页面暂时未能载入</h1><p>请刷新后再试。</p></main>';});
