import { Storage } from '@google-cloud/storage';
import { ApiError } from './errors.js';
export const audioTypes = ['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg'];
export function validAudio(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mime === 'audio/webm') return buffer.subarray(0,4).toString('hex') === '1a45dfa3';
  if (mime === 'audio/mp4') return buffer.subarray(4,8).toString() === 'ftyp';
  if (mime === 'audio/wav') return buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WAVE';
  if (mime === 'audio/ogg') return buffer.subarray(0,4).toString() === 'OggS';
  if (mime === 'audio/mpeg') return buffer.subarray(0,3).toString() === 'ID3' || (buffer[0]===255 && (buffer[1]&224)===224);
  return false;
}
export function createStorage(env = process.env) {
  if (!env.GCS_BUCKET) throw new Error('GCS_BUCKET is required');
  const bucket = new Storage({projectId:env.GCP_PROJECT}).bucket(env.GCS_BUCKET);
  return {
    async put(name,buffer,mime) { await bucket.file(name).save(buffer,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:mime,cacheControl:'private, no-store'}}); },
    async read(name) {
      try { const [bytes] = await bucket.file(name).download(); return bytes; }
      catch(e) { if (Number(e.code)===404) throw new ApiError(410,'MEDIA_EXPIRED'); throw new ApiError(503,'MEDIA_UNAVAILABLE'); }
    },
    async remove(name) { await bucket.file(name).delete({ignoreNotFound:true}); }
  };
}
