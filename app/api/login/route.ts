import { configured, correctPassword, newSession, privateHeaders, sameOrigin } from '../../../lib/session';

export const runtime = 'nodejs';
// Dodatkowy limit jednego procesu. Globalny limit produkcyjny wymaga reguły WAF.
let attempts = 0;
let ends = 0;
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  if (!configured()) return new Response('Brak konfiguracji dostępu.', { status: 503, headers: privateHeaders });
  const now = Date.now();
  if (now >= ends) { attempts = 0; ends = now + 60_000; }
  if (attempts >= 5) return new Response('Zbyt wiele prób. Spróbuj później.', {
    status: 429, headers: { ...privateHeaders, 'Retry-After': String(Math.ceil((ends - now) / 1000)) },
  });
  attempts++;
  let password;
  try {
    const body = await request.text();
    if (body.length > 4096) throw new Error();
    password = JSON.parse(body).password;
  } catch { return new Response('Nieprawidłowe żądanie.', { status: 400, headers: privateHeaders }); }
  if (typeof password !== 'string' || !correctPassword(password))
    return new Response('Nieprawidłowe hasło.', { status: 401, headers: privateHeaders });
  return new Response(null, { status: 204, headers: { ...privateHeaders, 'Set-Cookie': newSession() } });
}
