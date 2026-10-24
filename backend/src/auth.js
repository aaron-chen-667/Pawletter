import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { assert } from './errors.js';
const scrypt = promisify(scryptCallback);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const canReadAllStations = user => user?.role === 'station' && user.read_all_stations === true;
export const canReadStation = (user, stationId) => user?.role === 'station' && (user.station_id === stationId || canReadAllStations(user));
export async function hashPassword(password) {
  assert(typeof password === 'string' && password.length >= 12 && password.length <= 128, 400, 'PASSWORD_LENGTH');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  const actual = await scrypt(password, salt || '00000000000000000000000000000000', 64);
  return !!hash && hash.length === 128 && timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export async function provision(db, { username, password, role, stationId = null, stationName }) {
  assert(/^[a-zA-Z0-9._-]{3,64}$/.test(username), 400, 'USERNAME_INVALID');
  assert(['adopter','station'].includes(role), 400, 'ROLE_INVALID');
  assert(role !== 'station' || (stationId && stationName), 400, 'STATION_REQUIRED');
  if (role === 'station') await db.query('INSERT INTO stations(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [stationId, stationName]);
  const id = randomUUID();
  await db.query('INSERT INTO users(id,username,password_hash,role,station_id) VALUES($1,$2,$3,$4,$5)', [id,username,await hashPassword(password),role,role === 'station' ? stationId : null]);
  return id;
}
export async function authenticate(db, request) {
  const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  assert(token, 401, 'AUTH_REQUIRED');
  const { rows } = await db.query('SELECT u.id,u.role,u.station_id,u.read_all_stations FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true', [digest(token)]);
  assert(rows[0], 401, 'SESSION_EXPIRED');
  return rows[0];
}
export async function login(db, username, password) {
  const { rows } = await db.query('SELECT * FROM users WHERE username=$1', [username]);
  assert(await verifyPassword(password, rows[0]?.password_hash) && rows[0]?.active, 401, 'INVALID_CREDENTIALS');
  return issueSession(db,rows[0]);
}
export async function issueSession(db,user) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 8 * 3600_000);
  await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [digest(token), user.id, expiresAt]);
  return { token, expiresAt, user: { id:user.id,role:user.role,stationId:user.station_id,canReadAllStations:canReadAllStations(user) } };
}
