// Both intake and supplementation use the same input controls and visual structure.
const svg=body=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const composerIcons={
 mic:svg('<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>'),
 plus:svg('<path d="M12 5v14M5 12h14"/>'),
 close:svg('<path d="M6 6l12 12M18 6 6 18"/>'),
 album:svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 4 4 4-6 5 7"/>'),
 camera:svg('<path d="m8 5 2-2h4l2 2h4a2 2 0 0 1 2 2v12H2V7a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="4"/>'),
 file:svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
 unsure:svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>'),
 stop:svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
 keyboard:svg('<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
 redo:svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
 check:svg('<path d="m5 12 5 5 9-10"/>'),
};
const modeKey='pawletter.intake.input-mode';
export const inputModeStore={get(){try{return localStorage.getItem(modeKey);}catch{return null;}},set(value){try{localStorage.setItem(modeKey,value);}catch{}}};

// Slots contain markup prepared by each flow; draft and submission state stay with the caller.
export function renderComposer({mode,state='idle',className='',attributes='',before='',audio='',preview='',answer='',caption='',left='',center='',right='',hint='',panel='',footer=''}){
 const content=mode==='text'
  ?`${audio}${preview}<div class="intake-bar">${left}<div class="intake-input">${answer}</div>${right}</div>`
  :`${audio}${state==='rec'||state==='review'?`<div class="intake-caption${state==='review'?' editable':''}">${caption}${answer}${preview}</div>`:preview}<div class="intake-voice-row">${left}${center}${right}</div>${hint?`<p class="intake-voice-hint">${hint}</p>`:''}`;
 return `<div class="intake-composer${mode==='voice'?' voice':''}${className?' '+className:''}" data-mode="${mode}" data-state="${state}" ${attributes}>${before}${content}${panel}${footer}</div>`;
}
