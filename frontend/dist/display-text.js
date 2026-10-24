// Hide legacy sample prefixes in presentation; keep the underlying source records intact.
export function displayText(value='') {
  return String(value??'')
    .replace(/【虚构(?:示例|实例)(?:档案|案例|记录|观察)(?:，非照片中动物的真实记录)?】/g,'')
    .replace(/虚构(?:示例|实例)(?:记录|案例)[：:]/g,'');
}
export function escapeDisplay(value='') {
  return displayText(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
