// Captures browser media only; each consuming flow decides whether to upload it.
export function createCaptureController({ onChange, onError }) {
  const media = {
    stream: null, cameraPending: false, cameraError: '', facing: 'environment',
    videoRecorder: null, voiceRecorder: null, voiceStream: null,
    videoUrl: '', videoName: '', audioUrl: '', audioSeconds: 0,
    voicePending: false, videoPending: false, recordingSeconds: 0,
  };
  let cameraEpoch = 0, voiceEpoch = 0;
  let videoDone = Promise.resolve(), voiceDone = Promise.resolve();
  let videoTimer, voiceTimer;
  function changed() { onChange(); }
  function releaseStream(stream) { stream?.getTracks().forEach(track => track.stop()); }
  function options(kind) {
    const formats = kind === 'video' ? ['video/webm;codecs=vp8', 'video/mp4', 'video/webm'] : ['audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = formats.find(value => MediaRecorder.isTypeSupported(value));
    return mimeType ? { mimeType } : {};
  }
  async function startCamera() {
    if (media.stream || media.cameraPending) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      media.cameraError = '此浏览器无法直接预览相机，可以使用手机相机拍摄。'; changed(); return;
    }
    const epoch = ++cameraEpoch;
    media.cameraPending = true; media.cameraError = ''; changed();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: media.facing }, width: { ideal: 1080 }, height: { ideal: 1440 } },
        audio: false,
      });
      if (epoch !== cameraEpoch) { releaseStream(stream); return; }
      media.stream = stream;
    } catch (error) {
      if (epoch !== cameraEpoch) return;
      media.cameraError = error.name === 'NotAllowedError'
        ? '相机权限尚未开启。允许相机后重试，或使用下方手机拍摄入口。'
        : '暂时无法打开相机。可以使用手机拍摄入口，或从相册选择。';
    } finally {
      if (epoch === cameraEpoch) { media.cameraPending = false; changed(); }
    }
  }
  async function stopVideo() {
    if (media.videoRecorder?.state === 'recording') media.videoRecorder.stop();
    await videoDone;
  }
  async function stopCamera() {
    cameraEpoch++; media.cameraPending = false;
    await stopVideo();
    releaseStream(media.stream); media.stream = null;
  }
  async function flipCamera() {
    await stopCamera();
    media.facing = media.facing === 'environment' ? 'user' : 'environment';
    await startCamera();
  }
  function photograph(element) {
    if (!element?.videoWidth) throw new Error('取景画面还没准备好，请稍等。');
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 1000 / Math.max(element.videoWidth, element.videoHeight));
    canvas.width = Math.round(element.videoWidth * ratio);
    canvas.height = Math.round(element.videoHeight * ratio);
    canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .82);
  }
  function setVideo(url, name) {
    if (media.videoUrl.startsWith('blob:')) URL.revokeObjectURL(media.videoUrl);
    media.videoUrl = url; media.videoName = name; changed();
  }
  function clearVideo() { setVideo('', ''); }
  async function recordVideo() {
    if (media.videoRecorder?.state === 'recording') { await stopVideo(); return; }
    if (!media.stream) { onError('请先开启相机，或使用手机录像入口。'); return; }
    if (!window.MediaRecorder) { onError('当前浏览器请使用手机录像入口。'); return; }
    try {
      const recorder = new MediaRecorder(media.stream, options('video'));
      const chunks = []; media.videoRecorder = recorder; media.videoPending = true;
      videoDone = new Promise(resolve => {
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          clearInterval(videoTimer); media.videoRecorder = null; media.videoPending = false;
          if (chunks.length) setVideo(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })), '刚刚拍摄的视频');
          else changed();
          resolve();
        };
        recorder.onerror = () => { onError('录像未完成，请重试或使用手机录像入口。'); };
      });
      recorder.start(250); media.recordingSeconds = 0; changed();
      videoTimer = setInterval(() => {
        media.recordingSeconds++; changed();
        if (media.recordingSeconds >= 30) stopVideo();
      }, 1000);
    } catch {
      videoDone = Promise.resolve(); media.videoRecorder = null; media.videoPending = false; changed();
      onError('此浏览器无法在页内录像，请使用手机录像入口。');
    }
  }
  async function stopVoice() {
    voiceEpoch++; media.voicePending = false;
    if (media.voiceRecorder?.state === 'recording') media.voiceRecorder.stop();
    await voiceDone;
    releaseStream(media.voiceStream); media.voiceStream = null;
  }
  async function recordVoice() {
    if (media.voiceRecorder?.state === 'recording') { await stopVoice(); return; }
    if (media.voicePending) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onError('此浏览器无法录音，可用文字补充或体验示例口述。'); return;
    }
    const epoch = ++voiceEpoch; media.voicePending = true; changed();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (epoch !== voiceEpoch) { releaseStream(stream); return; }
      media.voiceStream = stream;
      const recorder = new MediaRecorder(stream, options('audio')); media.voiceRecorder = recorder;
      const chunks = [];
      voiceDone = new Promise(resolve => {
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          clearInterval(voiceTimer); releaseStream(stream);
          media.voiceRecorder = null; media.voiceStream = null; media.voicePending = false;
          if (chunks.length) {
            media.audioSeconds = Math.max(1, media.audioSeconds);
            if (media.audioUrl) URL.revokeObjectURL(media.audioUrl);
            media.audioUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
          }
          changed(); resolve();
        };
        recorder.onerror = () => onError('录音未完成，请重新录制。');
      });
      recorder.start(250); media.audioSeconds = 0; media.voicePending = false; changed();
      voiceTimer = setInterval(() => {
        media.audioSeconds++; changed();
        if (media.audioSeconds >= 60) stopVoice();
      }, 1000);
    } catch {
      releaseStream(stream);
      voiceDone = Promise.resolve();
      if (epoch === voiceEpoch) {
        media.voicePending = false; media.voiceRecorder = null; changed();
        onError('未获得麦克风权限，可重试、用文字补充，或体验示例口述。');
      }
    }
  }
  async function reset() {
    await stopCamera(); await stopVoice(); clearVideo();
    if (media.audioUrl) URL.revokeObjectURL(media.audioUrl);
    media.audioUrl = ''; media.audioSeconds = 0; media.cameraError = ''; changed();
  }
  function emergencyStop() {
    cameraEpoch++; voiceEpoch++;
    clearInterval(videoTimer); clearInterval(voiceTimer);
    if (media.videoRecorder?.state === 'recording') media.videoRecorder.stop();
    if (media.voiceRecorder?.state === 'recording') media.voiceRecorder.stop();
    releaseStream(media.stream); releaseStream(media.voiceStream);
  }
  return { media, startCamera, stopCamera, flipCamera, photograph, setVideo, clearVideo, recordVideo, stopVideo, recordVoice, stopVoice, reset, emergencyStop };
}
