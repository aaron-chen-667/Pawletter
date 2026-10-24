export const defaultFrontendOrigin = 'https://pawletter-adoption-h5.chenaaron668.chatgpt.site';

export function createOriginCheck(origin = defaultFrontendOrigin, additionalOrigins = '') {
  const invalid = () => new Error('Frontend origins must be exact HTTP(S) origins without credentials, paths, wildcards, query strings or fragments.');
  function validate(value) {
    if (typeof value !== 'string') throw invalid();
    const candidate = value.trim();
    let url;
    try { url = new URL(candidate); } catch { throw invalid(); }
    if (!['https:', 'http:'].includes(url.protocol) || candidate.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw invalid();
    return url.origin;
  }
  if (typeof origin !== 'string' || typeof additionalOrigins !== 'string') throw invalid();
  const extra = additionalOrigins.trim() ? additionalOrigins.split(',').map(validate) : [];
  const allowed = new Set([...origin.split(',').map(validate), ...extra]);
  return requestOrigin => allowed.has(requestOrigin);
}
