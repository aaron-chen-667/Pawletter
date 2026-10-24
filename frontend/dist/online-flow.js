// One submission keeps its original pet, body and key until the server acknowledges it.
// This state lives in memory; no account, recording or token is written to localStorage.
export function createObservationSender(client, uuid=()=>crypto.randomUUID()) {
  let pending=null, running=false;
  return {
    get pending(){return !!pending;},
    discard(){if(running)throw new Error('SUBMISSION_BUSY');pending=null;},
    async send(input){
      if(running)throw new Error('SUBMISSION_BUSY');
      if(!pending){
        if(!input?.petId||(!input.text?.trim()&&!input.audio&&!input.photos?.length&&!input.video))throw new Error('EMPTY_OBSERVATION');
        pending={petId:input.petId,audio:input.audio,key:uuid(),body:{text:input.text?.trim()||'',shareWithAgent:!!input.shareWithAgent,...(input.replacesId?{replacesId:input.replacesId}:{}),...(input.observedOn?{observedOn:input.observedOn}:{}),...(input.photos?.length?{photos:input.photos}:{}),...(input.video?{video:input.video}:{})}};
      }
      running=true;
      try {
        if(pending.audio&&!pending.body.mediaId){const media=await client.uploadAudio(pending.petId,pending.audio);pending.body.mediaId=media.id;}
        const result=await client.submitObservation(pending.petId,pending.body,pending.key);
        const value={...result,petId:pending.petId};pending=null;return value;
      }catch(e){if([400,413].includes(e?.status)||e?.message==='EXAMPLE_STORAGE_FULL')pending=null;throw e;}finally{running=false;}
    }
  };
}
export const errorMessage=e=>({
  ROLE_MISMATCH:'账号身份与当前入口不符，请使用对应身份的账号登录。',
  INVALID_CREDENTIALS:'账号或密码不正确，请重新输入。',SESSION_EXPIRED:'登录已过期，请重新登录。',AUTH_REQUIRED:'请先登录。',STATION_REQUIRED:'只有负责这只宠物的救助站可以操作。',
  RATE_LIMITED:'操作有点频繁，请稍后再试。',PAYLOAD_TOO_LARGE:'录音超过 20 MB，请录制短一些。',INVALID_AUDIO_FILE:'无法识别这段音频，请重新录制。',UNSUPPORTED_MEDIA:'不支持这种音频格式，请尝试手机录音或文字。',
  KNOWLEDGE_CHANGED_RETRY:'资料刚刚更新了，请重新发送问题。',PET_NOT_FOUND:'这只宠物暂时不可查看，请刷新列表。',AI_UNAVAILABLE:'Agent 暂时没有回应，请稍后重试。',AI_PROVIDER_ERROR:'Agent 暂时无法回答，请稍后重试。',
  OBSERVATION_NOT_ACTIVE:'这条记录已被更正或撤回，请刷新。',OBSERVATION_NOT_FAILED:'这条记录已经在处理中，请刷新进度。',INVALID_INPUT:'请检查输入内容。',EMPTY_OBSERVATION:'先说一段语音，或写下你的观察。',
  EXAMPLE_STORAGE_FULL:'示例存储空间不足，请减少附件后重试。',
  AI_RATE_LIMITED:'Agent 当前繁忙，草稿已保留，请稍后重试。',AI_INVALID_RESPONSE:'Agent 未返回完整解析，草稿已保留，请重试。',
  INVALID_RESPONSE:'服务暂时没有返回有效结果，请稍后重试。'
}[e?.message]||'暂时连接不上，请检查网络后重试；已提交的记录可刷新查看。');
