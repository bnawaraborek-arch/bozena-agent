import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';
import { createConversation, listConversations } from '../../../lib/conversation-store';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  try { return Response.json({ conversations: await listConversations() }, { headers: privateHeaders }); }
  catch { return new Response('Nie udało się odczytać listy rozmów.', { status: 503, headers: privateHeaders }); }
}
export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  try { return Response.json({ id: await createConversation() }, { status: 201, headers: privateHeaders }); }
  catch { return new Response('Nie udało się utworzyć rozmowy. Spróbuj ponownie.', { status: 503, headers: privateHeaders }); }
}
