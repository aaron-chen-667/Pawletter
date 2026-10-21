export function petShareData(pet,href=location.href){
 const url=new URL(href);url.search='';url.hash='';url.searchParams.set('pet',pet.id);
 return {title:pet.name+' · 爪爪来信',text:'来认识'+pet.name+'，看看救助者为它记录的故事。',url:url.href};
}
export async function sharePet(data,platform=navigator){
 if(typeof platform.share==='function'){
  try{await platform.share(data);return 'shared';}catch(error){if(error.name==='AbortError')return 'cancelled';}
 }
 if(platform.clipboard?.writeText){try{await platform.clipboard.writeText(data.url);return 'copied';}catch{}}
 return 'manual';
}
