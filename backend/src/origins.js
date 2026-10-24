export const defaultFrontendOrigin = 'https://pawletter-adoption-h5.chenaaron668.chatgpt.site';

export function createOriginCheck(origin = defaultFrontendOrigin, additionalOrigins = '') {
  const invalid = () => new Error('Frontend origins must be exact HTTP(S) origins without credentials, paths, wildcards, query strings or fragments.');
  function validate(value) {
    if (typeof value !== 'string') throw invalid();
    const candidate = value.trim();
    let url;
    try { url = new URL(candidate); } catch { throw invalid(); }
    if (!['https:', 'http:'].includes(url.protocol) || candidate.includes('*') || url.origin !== candidate) throw invalid();
    return candidate;
  }
  if (typeof additionalOrigins !== 'string') throw invalid();
  const extra = additionalOrigins.trim() ? additionalOrigins.split(',').map(validate) : [];
  const allowed = new Set([validate(origin), ...extra]);
  return requestOrigin => allowed.has(requestOrigin);
}
