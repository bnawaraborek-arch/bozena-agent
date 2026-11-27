import { hasSession, privateHeaders } from '../../../../lib/session';
import { conversationId, loadConversation } from '../../../../lib/conversation-store';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  const id = conversationId((await context.params).id);
  if (!id) return new Response('Nieprawidłowy identyfikator rozmowy.', { status: 400, headers: privateHeaders });
  try {
    const messages = await loadConversation(id);
    if (!messages) return new Response('Nie znaleziono rozmowy.', { status: 404, headers: privateHeaders });
    return Response.json({ id, messages }, { headers: privateHeaders });
  } catch { return new Response('Nie udało się odczytać rozmowy. Spróbuj ponownie.', { status: 503, headers: privateHeaders }); }
}
