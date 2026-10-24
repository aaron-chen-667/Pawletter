import {test} from 'node:test';
import assert from 'node:assert/strict';
import {videoData} from '../dist/intake-media.js';

function setup(t, {duration = Infinity, actualDuration = 12, resolveMetadataDuration = true, invalid = false} = {}) {
  const previous = new Map(), seeks = [], frames = [];
  class Video extends EventTarget {
    duration = duration;
    videoWidth = 640;
    videoHeight = 480;
    time = 0;
    paused = false;
    cleared = false;
    set src(value) {
      this.url = value;
      queueMicrotask(() => this.dispatchEvent(new Event(invalid ? 'error' : 'loadedmetadata')));
    }
    set currentTime(value) {
      seeks.push(value);
      this.time = Number.isFinite(actualDuration) ? Math.min(value, actualDuration) : value;
      if (resolveMetadataDuration && value > actualDuration) this.duration = actualDuration;
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    }
    get currentTime() { return this.time; }
    pause() { this.paused = true; }
    removeAttribute() { this.cleared = true; }
    load() {}
  }
  class Reader {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload();
    }
  }
  const video = new Video();
  const document = {createElement: tag => tag === 'video' ? video : {
    getContext: () => ({drawImage: source => frames.push(source.currentTime)}),
    toDataURL: () => 'data:image/jpeg;base64,ZnJhbWU=',
  }};
  for (const [key, value] of Object.entries({document, FileReader: Reader})) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {video, seeks, frames};
}

const recordedFile = () => new Blob(['webm-recording-bytes'], {type: 'video/webm;codecs=vp8,opus'});

test('recorded WebM with infinite metadata duration is probed, sampled, and normalizes codec MIME for upload', async t => {
  const s = setup(t);
  const result = await videoData(recordedFile());
  assert.equal(s.seeks[0], Number.MAX_SAFE_INTEGER);
  assert.deepEqual(s.frames, [12 * .2, 12 * .7]);
  assert.equal(result.frames.length, 2);
  assert.equal(result.dataUrl, `data:video/webm;base64,${Buffer.from('webm-recording-bytes').toString('base64')}`);
  assert.equal(s.video.paused, true);
  assert.equal(s.video.cleared, true);
  await assert.rejects(fetch(s.video.url), /fetch failed/, 'The temporary blob URL must be revoked');
});

test('WebM whose metadata stays infinite uses the decoder-clamped seek position', async t => {
  const s = setup(t, {actualDuration: 8, resolveMetadataDuration: false});
  const result = await videoData(recordedFile());
  assert.equal(result.frames.length, 2);
  assert.deepEqual(s.frames, [8 * .2, 8 * .7]);
});

test('probing an unfinalized WebM still rejects recordings longer than 30 seconds', async t => {
  const s = setup(t, {actualDuration: 47});
  await assert.rejects(videoData(recordedFile()), /30 秒以内/);
  assert.deepEqual(s.seeks, [Number.MAX_SAFE_INTEGER]);
  assert.deepEqual(s.frames, []);
  assert.equal(s.video.cleared, true);
});

test('known long uploads are rejected without decoding frames or probing the end', async t => {
  const s = setup(t, {duration: 31, actualDuration: 31});
  await assert.rejects(videoData(new Blob(['video'], {type: 'video/mp4'})), /30 秒以内/);
  assert.deepEqual(s.seeks, []);
  assert.deepEqual(s.frames, []);
});

test('unknown duration is not accepted when the decoder cannot determine an end', async t => {
  const s = setup(t, {actualDuration: Infinity, resolveMetadataDuration: false});
  await assert.rejects(videoData(recordedFile()), /无法确定视频时长/);
  assert.deepEqual(s.frames, []);
  assert.equal(s.video.cleared, true);
});

test('corrupt video reports a decoding error and releases its temporary media', async t => {
  const s = setup(t, {invalid: true});
  await assert.rejects(videoData(recordedFile()), /无法读取视频/);
  assert.equal(s.video.cleared, true);
  await assert.rejects(fetch(s.video.url), /fetch failed/);
});
