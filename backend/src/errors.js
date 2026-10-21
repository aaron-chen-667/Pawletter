export class ApiError extends Error {
  constructor(status, code, message = code) { super(message); this.statusCode = status; this.code = code; }
}
export const assert = (condition, status, code) => { if (!condition) throw new ApiError(status, code); };
