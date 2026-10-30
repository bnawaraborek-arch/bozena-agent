import { clearSession, privateHeaders, sameOrigin } from '../../../lib/session';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers: privateHeaders });
  return new Response(null, { status: 204, headers: { ...privateHeaders, 'Set-Cookie': clearSession() } });
}
