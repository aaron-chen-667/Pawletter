import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createIntakeCamera} from '../dist/intake-camera.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  for (let n = 0; n < 30 && !predicate(); n++) await tick();
  assert.ok(predicate(), 'Expected camera state did not arrive');
}

function setup(t, request) {
  const dom = new JSDOM('<main><button id="launch">拍摄</button></main>', {url: 'http://localhost/'});
  const w = dom.window, previous = new Map(), tracks = [], recorded = [], captured = [], errors = [];
  const stream = (kind = 'video') => {
    const track = {kind, stopped: false, stop() { this.stopped = true; }};
    tracks.push(track);
    const members = [track];
    return {getTracks: () => [...members], getAudioTracks: () => members.filter(member => member.kind === 'audio'), addTrack: member => members.push(member), removeTrack: member => members.splice(members.indexOf(member), 1)};
  };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', {get: () => 640});
  Object.defineProperty(w.HTMLVideoElement.prototype, 'videoHeight', {get: () => 480});
  w.HTMLCanvasElement.prototype.getContext = () => ({drawImage() {}});
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,cGhvdG8=';
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(mediaStream) { this.mediaStream = mediaStream; this.state = 'inactive'; this.mimeType = 'video/webm'; recorded.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state !== 'recording') return;
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({data: new Blob(['recorded-video'], {type: this.mimeType})});
        this.onstop?.();
      });
    }
  }
  w.MediaRecorder = Recorder;
  const navigator = {mediaDevices: {getUserMedia: args => request ? request(args, () => stream(args.audio ? 'audio' : 'video')) : Promise.resolve(stream(args.audio ? 'audio' : 'video'))}};
  for (const [key, value] of Object.entries({window: w, document: w.document, navigator, MediaRecorder: Recorder})) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  }
  const camera = createIntakeCamera({root: w.document.querySelector('main'), onCapture: value => captured.push(value), onError: value => errors.push(value)});
  t.after(async () => {
    await camera.stop();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const q = selector => w.document.querySelector(selector);
  const click = name => q(`[data-camera=${name}]`).click();
  const pointer = (name, type, detail = 0) => {
    const event = new w.Event(type, {bubbles: true, cancelable: true});
    Object.assign(event, {button: 0, pointerId: 7, detail});
    q(`[data-camera=${name}]`).dispatchEvent(event);
  };
  return {camera, q, click, pointer, tracks, recorded, captured, errors, w};
}

test('camera photographs on a short press, previews before acceptance, and releases the stream', async t => {
  const s = setup(t);
  s.q('#launch').focus();
  await s.camera.open();
  assert.equal(s.camera.active, true);
  assert.equal(s.q('dialog').open, true);
  s.pointer('shutter', 'pointerdown');
  s.pointer('shutter', 'pointerup');
  await tick();
  assert.ok(s.q('.intake-camera-preview img'));
  assert.equal(s.captured.length, 0);
  assert.equal(s.tracks[0].stopped, true);
  assert.equal(s.q('[data-camera=accept]').textContent, '使用这张');
  s.click('accept');
  await until(() => !s.camera.active);
  assert.deepEqual(s.captured, [{kind: 'photo', dataUrl: 'data:image/jpeg;base64,cGhvdG8='}]);
  assert.equal(s.q('dialog'), null);
  assert.equal(s.w.document.activeElement.id, 'launch');
});

test('long press ends a video on release and its trailing click cannot capture a photo', async t => {
  const s = setup(t);
  await s.camera.open();
  s.pointer('shutter', 'pointerdown');
  await new Promise(resolve => setTimeout(resolve, 370));
  assert.equal(s.recorded.length, 1);
  assert.equal(s.recorded[0].state, 'recording');
  assert.equal(s.recorded[0].mediaStream.getAudioTracks().length, 1);
  s.pointer('shutter', 'pointerup');
  s.pointer('shutter', 'click', 1);
  await until(() => s.q('.intake-camera-preview video'));
  assert.equal(s.q('.intake-camera-preview img'), null);
  assert.equal(s.captured.length, 0);
  s.click('accept');
  await until(() => s.captured.length);
  assert.equal(s.captured[0].kind, 'video');
  assert.equal(await s.captured[0].file.text(), 'recorded-video');
  assert.equal(s.tracks[0].stopped, true);
  assert.equal(s.tracks[1].stopped, true);
});

test('closing during a permission request releases a late stream and does not reopen the dialog', async t => {
  let grant;
  const s = setup(t, (_args, stream) => new Promise(resolve => { grant = () => resolve(stream()); }));
  const opening = s.camera.open();
  await until(() => grant);
  await s.camera.close();
  grant();
  await opening;
  assert.equal(s.camera.active, false);
  assert.equal(s.q('dialog'), null);
  assert.equal(s.tracks[0].stopped, true);
  assert.equal(s.captured.length, 0);
});

test('permission denial can be retried; retaking starts a new stream without keeping the old one', async t => {
  let requests = 0;
  const s = setup(t, async (_args, stream) => {
    if (++requests === 1) throw Object.assign(new Error('denied'), {name: 'NotAllowedError'});
    return stream();
  });
  await s.camera.open();
  assert.match(s.q('.intake-camera-error').textContent, /权限/);
  assert.equal(s.q('[data-camera=retry]').hidden, false);
  s.click('retry');
  await until(() => !s.q('[data-camera=shutter]').disabled);
  s.click('shutter');
  await until(() => s.q('.intake-camera-preview img'));
  s.click('retake');
  await until(() => requests === 3 && !s.q('[data-camera=shutter]').disabled);
  assert.equal(s.tracks[0].stopped, true);
  assert.equal(s.tracks[1].stopped, false);
  assert.equal(s.q('.intake-camera-preview img'), null);
  s.click('video');
  await until(() => s.recorded[0]);
  assert.equal(s.recorded[0].state, 'recording');
  s.click('video');
  await until(() => s.q('.intake-camera-preview video'));
  assert.equal(s.captured.length, 0);
});

test('releasing a long press during microphone permission cancels the take and releases the late audio stream', async t => {
  let grantAudio;
  const s = setup(t, (args, stream) => args.audio ? new Promise(resolve => { grantAudio = () => resolve(stream()); }) : Promise.resolve(stream()));
  await s.camera.open();
  s.pointer('shutter', 'pointerdown');
  await new Promise(resolve => setTimeout(resolve, 370));
  assert.ok(grantAudio);
  s.pointer('shutter', 'pointerup');
  grantAudio();
  await tick();
  assert.equal(s.recorded.length, 0);
  assert.equal(s.tracks[1].kind, 'audio');
  assert.equal(s.tracks[1].stopped, true);
  assert.equal(s.tracks[0].stopped, false);
  assert.equal(s.q('.intake-camera-preview video'), null);
});

test('closing while microphone permission is pending cancels the take and releases both devices', async t => {
  let grantAudio;
  const s = setup(t, (args, stream) => args.audio ? new Promise(resolve => { grantAudio = () => resolve(stream()); }) : Promise.resolve(stream()));
  await s.camera.open();
  s.click('video');
  await until(() => grantAudio);
  await s.camera.close();
  grantAudio();
  await tick();
  assert.equal(s.recorded.length, 0);
  assert.ok(s.tracks.every(track => track.stopped));
});

test('denied microphone keeps the live camera available and reports the permission requirement', async t => {
  const s = setup(t, async (args, stream) => {
    if (args.audio) throw Object.assign(new Error('denied'), {name: 'NotAllowedError'});
    return stream();
  });
  await s.camera.open();
  s.click('video');
  await until(() => s.errors.length);
  assert.equal(s.recorded.length, 0);
  assert.match(s.q('.intake-camera-error').textContent, /麦克风权限/);
  assert.equal(s.q('[data-camera=shutter]').disabled, false);
  assert.equal(s.tracks[0].stopped, false);
});
