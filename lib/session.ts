import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const cookieName = 'chat_session';
const lifetime = 8 * 60 * 60;
export function configured() {
  return Boolean(process.env.CHAT_PASSWORD?.trim() &&
    (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32 &&
    (process.env.NODE_ENV !== 'production' || process.env.CHAT_LOGIN_RATE_LIMIT_CONFIGURED === 'true'));
}
const digest = (value: string) => createHash('sha256').update(value).digest();
export function correctPassword(value: string) {
  return configured() && timingSafeEqual(digest(value), digest(process.env.CHAT_PASSWORD!));
}
function sign(value: string) {
  return createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('base64url');
}
function cookie(value: string, age: number) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function newSession() {
  const value = `${Math.floor(Date.now() / 1000) + lifetime}.${randomBytes(32).toString('base64url')}`;
  return cookie(`${value}.${sign(value)}`, lifetime);
}
export const clearSession = () => cookie('', 0);
export function hasSession(request: Request) {
  if (!configured()) return false;
  const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || token.length > 256) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[\w-]{43}$/.test(parts[1])) return false;
  const expires = Number(parts[0]);
  const now = Math.floor(Date.now() / 1000);
  return expires > now && expires <= now + lifetime &&
    timingSafeEqual(digest(parts[2]), digest(sign(`${parts[0]}.${parts[1]}`)));
}
export function sameOrigin(request: Request) {
  // Next.js może zbudować request.url z wewnętrzną nazwą serwera.
  // Host jest adresem żądania przeglądarki; nie ufamy X-Forwarded-Host.
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  return request.headers.get('origin') === `${url.protocol}//${host}`;
}
export const privateHeaders = { 'Cache-Control': 'no-store' };
