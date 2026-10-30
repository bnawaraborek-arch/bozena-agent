import { hasSession, privateHeaders } from '../../../lib/session';

export async function GET(request: Request) {
  return new Response(null, { status: hasSession(request) ? 204 : 401, headers: privateHeaders });
}
