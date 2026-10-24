import {createCaptureController} from './capture.js';

const icons = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  flip: '<path d="M4 8a8 8 0 0 1 14-3l2 3M20 3v5h-5M20 16a8 8 0 0 1-14 3l-2-3M4 21v-5h5"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 6-3v10l-6-3"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

// The dialog owns camera resources; the intake flow owns validation and storage.
export function createIntakeCamera({root, onCapture, onError = () => {}}) {
  const doc = root.ownerDocument || document;
  let dialog, live, preview, error, status, shutter, flip, videoButton, controls, review;
  let active = false, epoch = 0, captureResult = null, saving = false, switching = false;
  let pressTimer, pointerId = null, held = false, cleanup = Promise.resolve();
  let microphone = null, videoRequest = 0, videoStarting = false;
  let returnFocus = null;
  const capture = createCaptureController({onChange: update, onError: report});

  function report(message) {
    if (!active) return;
    if (error) error.textContent = message;
    onError(message);
  }

  function clearPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
    pointerId = null;
    held = false;
  }

  function update() {
    if (!active || !dialog) return;
    const media = capture.media;
    const recording = media.videoRecorder?.state === 'recording';
    if (live.srcObject !== media.stream) {
      live.srcObject = media.stream;
      if (media.stream) live.play().catch(() => {});
    }
    live.classList.toggle('intake-camera-mirrored', media.facing === 'user');
    dialog.classList.toggle('intake-camera-recording', recording);
    status.textContent = recording
      ? `00:${String(media.recordingSeconds).padStart(2, '0')} / 00:30`
      : videoStarting ? '请允许使用麦克风…' : media.cameraPending ? '正在开启相机…' : '';
    shutter.disabled = !media.stream || media.cameraPending || saving || switching || (videoStarting && pointerId === null) || !!captureResult;
    flip.disabled = !media.stream || recording || media.videoPending || videoStarting || saving || switching;
    videoButton.disabled = !media.stream || media.cameraPending || saving || switching || !!captureResult;
    videoButton.innerHTML = recording ? '<span class="intake-camera-stop-mark" aria-hidden="true"></span>结束录像' : videoStarting ? '取消录像' : `${icon('video')}录像`;
    videoButton.setAttribute('aria-pressed', String(recording));
    if (media.cameraError) {
      error.textContent = media.cameraError.includes('权限')
        ? '请允许相机权限后重试。' : '暂时无法打开相机，请重试或返回上传素材。';
    }
    dialog.querySelector('[data-camera=retry]').hidden = !media.cameraError;
    if (media.videoUrl && !media.videoPending && !captureResult) {
      captureResult = {kind: 'video', url: media.videoUrl};
      showPreview();
    }
  }

  function releasePreview() {
    preview?.querySelectorAll('video').forEach(video => { video.pause(); video.removeAttribute('src'); });
    preview?.replaceChildren();
  }

  function showPreview() {
    if (!active || !captureResult) return;
    clearPress();
    releaseMicrophone();
    live.hidden = true;
    live.srcObject = null;
    releasePreview();
    const element = doc.createElement(captureResult.kind === 'photo' ? 'img' : 'video');
    element.src = captureResult.dataUrl || captureResult.url;
    if (captureResult.kind === 'photo') element.alt = '刚拍摄的伙伴照片';
    else {
      element.controls = true;
      element.playsInline = true;
      element.setAttribute('aria-label', '刚拍摄的视频');
    }
    preview.append(element);
    preview.hidden = false;
    controls.hidden = true;
    review.hidden = false;
    status.textContent = '';
    dialog.classList.remove('intake-camera-recording');
    dialog.querySelector('[data-camera=accept]').textContent = captureResult.kind === 'photo' ? '使用这张' : '使用这段';
    void capture.stopCamera();
    dialog.querySelector('[data-camera=accept]').focus();
  }

  async function photograph() {
    if (!active || saving || videoStarting || captureResult || capture.media.videoPending || !capture.media.stream) return;
    try {
      captureResult = {kind: 'photo', dataUrl: capture.photograph(live)};
      error.textContent = '';
      showPreview();
    } catch (cause) { report(cause.message || '拍照未完成，请重试。'); }
  }

  function releaseMicrophone() {
    if (!microphone) return;
    for (const track of microphone.getTracks()) {
      capture.media.stream?.removeTrack?.(track);
      track.stop();
    }
    microphone = null;
  }

  async function stopVideo() {
    videoRequest++;
    videoStarting = false;
    await capture.stopVideo();
    releaseMicrophone();
    update();
  }

  async function startVideo(fromHold = false) {
    if (!active || saving || captureResult || !capture.media.stream) return;
    if (videoStarting || capture.media.videoPending) { await stopVideo(); return; }
    if (!window.MediaRecorder) { report('当前浏览器无法录像，请返回上传视频。'); return; }
    const ticket = epoch, request = ++videoRequest;
    videoStarting = true;
    error.textContent = '';
    update();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (!active || ticket !== epoch || request !== videoRequest || captureResult || !capture.media.stream || (fromHold && (pointerId === null || !held))) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      microphone = stream;
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length || audioTracks.every(track => track.readyState === 'ended')) throw Error('MICROPHONE_UNAVAILABLE');
      for (const track of audioTracks) capture.media.stream.addTrack(track);
      videoStarting = false;
      await capture.recordVideo();
      if (!capture.media.videoPending) releaseMicrophone();
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      if (microphone === stream) releaseMicrophone();
      if (active && ticket === epoch && request === videoRequest) report('录视频需要麦克风权限，请允许后重试。');
    } finally {
      if (active && ticket === epoch && request === videoRequest) { videoStarting = false; update(); }
    }
  }

  function pressStart(event) {
    if (event.button !== 0 || pointerId !== null || shutter.disabled || capture.media.videoPending) return;
    pointerId = event.pointerId;
    held = false;
    shutter.setPointerCapture?.(pointerId);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!active || pointerId === null) return;
      held = true;
      void startVideo(true);
    }, 350);
  }

  function pressEnd(event, cancelled = false) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const wasHeld = held;
    clearPress();
    if (wasHeld) void stopVideo();
    else if (!cancelled) void photograph();
  }

  async function retake() {
    if (!active || saving) return;
    const ticket = epoch;
    captureResult = null;
    releasePreview();
    preview.hidden = true;
    controls.hidden = false;
    review.hidden = true;
    live.hidden = false;
    error.textContent = '';
    // Stop first so a previous stream cannot be reused while it is being released.
    await capture.stopCamera();
    if (!active || ticket !== epoch) return;
    capture.clearVideo();
    await capture.startCamera();
    if (active && ticket === epoch) shutter.focus();
  }

  async function switchCamera() {
    if (!active || switching || saving || videoStarting || captureResult || capture.media.videoPending) return;
    const ticket = epoch;
    switching = true;
    error.textContent = '';
    update();
    try { await capture.flipCamera(); }
    finally {
      if (active && ticket === epoch) { switching = false; update(); }
    }
  }

  async function accept() {
    if (!captureResult || saving) return;
    const ticket = epoch, result = captureResult;
    saving = true;
    error.textContent = '';
    review.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const acceptButton = dialog.querySelector('[data-camera=accept]');
    acceptButton.textContent = '正在添加…';
    try {
      const value = result.kind === 'photo'
        ? {kind: 'photo', dataUrl: result.dataUrl}
        : {kind: 'video', file: await (await fetch(result.url)).blob()};
      if (!active || ticket !== epoch) return;
      await onCapture(value);
      if (active && ticket === epoch) await close();
    } catch (cause) {
      if (active && ticket === epoch) report(cause.message || '暂时未能添加，请重试。');
    } finally {
      if (active && ticket === epoch) {
        saving = false;
        review.querySelectorAll('button').forEach(button => { button.disabled = false; });
        acceptButton.textContent = result.kind === 'photo' ? '使用这张' : '使用这段';
      }
    }
  }

  async function open() {
    if (active) return;
    const ticket = ++epoch;
    await cleanup;
    if (ticket !== epoch) return;
    active = true;
    captureResult = null;
    saving = false;
    switching = false;
    returnFocus = doc.activeElement;
    dialog = doc.createElement('dialog');
    dialog.className = 'intake-camera';
    dialog.setAttribute('aria-labelledby', 'intake-camera-heading');
    dialog.innerHTML = `<header class="intake-camera-header"><h2 id="intake-camera-heading">拍照或录像</h2><button type="button" class="intake-camera-icon" data-camera="close" aria-label="关闭相机">${icon('close')}</button></header>
      <div class="intake-camera-frame"><video class="intake-camera-live" autoplay muted playsinline aria-label="相机取景"></video><div class="intake-camera-preview" hidden></div><p class="intake-camera-status" role="status"></p></div>
      <div class="intake-camera-feedback"><p class="intake-camera-error" role="alert"></p><button type="button" class="intake-camera-retry" data-camera="retry" hidden>重新开启相机</button></div>
      <div class="intake-camera-controls"><div class="intake-camera-buttons"><button type="button" class="intake-camera-icon" data-camera="flip" aria-label="切换摄像头">${icon('flip')}</button><button type="button" class="intake-camera-shutter" data-camera="shutter" aria-label="拍照，长按录像"><span></span></button><button type="button" class="intake-camera-video" data-camera="video" aria-pressed="false">${icon('video')}录像</button></div><p>单击拍照 · 长按录像</p></div>
      <div class="intake-camera-review" hidden><button type="button" class="intake-camera-secondary" data-camera="retake">重拍</button><button type="button" class="intake-camera-primary" data-camera="accept">使用这张</button></div>`;
    doc.body.append(dialog);
    live = dialog.querySelector('.intake-camera-live');
    preview = dialog.querySelector('.intake-camera-preview');
    error = dialog.querySelector('.intake-camera-error');
    status = dialog.querySelector('.intake-camera-status');
    controls = dialog.querySelector('.intake-camera-controls');
    review = dialog.querySelector('.intake-camera-review');
    shutter = dialog.querySelector('[data-camera=shutter]');
    flip = dialog.querySelector('[data-camera=flip]');
    videoButton = dialog.querySelector('[data-camera=video]');
    dialog.querySelector('[data-camera=close]').onclick = close;
    dialog.querySelector('[data-camera=retry]').onclick = () => { error.textContent = ''; void capture.startCamera(); };
    dialog.querySelector('[data-camera=retake]').onclick = retake;
    dialog.querySelector('[data-camera=accept]').onclick = accept;
    flip.onclick = switchCamera;
    videoButton.onclick = () => { void startVideo(); };
    shutter.onpointerdown = pressStart;
    shutter.onpointerup = event => pressEnd(event);
    shutter.onpointercancel = event => pressEnd(event, true);
    shutter.onlostpointercapture = event => pressEnd(event, true);
    shutter.oncontextmenu = event => event.preventDefault();
    // Pointer interactions are handled above; click remains available to keyboards/AT.
    shutter.onclick = event => { if (event.detail === 0) void photograph(); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); });
    dialog.addEventListener('close', () => { if (active) void close(); });
    if (typeof dialog.showModal !== 'function') {
      report('当前浏览器无法打开相机窗口，请返回上传素材。');
      await close();
      return;
    }
    dialog.showModal();
    update();
    await capture.startCamera();
  }

  function close() {
    epoch++;
    active = false;
    videoRequest++;
    videoStarting = false;
    clearPress();
    capture.emergencyStop();
    releaseMicrophone();
    if (live) live.srcObject = null;
    if (dialog) {
      dialog.querySelectorAll('video').forEach(video => { video.pause(); video.removeAttribute('src'); video.srcObject = null; });
      if (dialog.open) dialog.close();
      dialog.remove();
    }
    dialog = null;
    captureResult = null;
    saving = false;
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
    cleanup = cleanup.then(() => capture.reset()).catch(() => { onError('相机清理未完成，请关闭页面后重试。'); });
    return cleanup;
  }

  return {open, close, stop: close, get active() { return active; }};
}
