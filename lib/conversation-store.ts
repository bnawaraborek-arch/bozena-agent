import 'server-only';
import type { UIMessage } from 'ai';
import { getSupabase } from './supabase';

export function conversationId(value: unknown): number | null {
  const id = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function createConversation(): Promise<number> {
  const { data, error } = await getSupabase().from('conversations').insert({ title: 'Nowa rozmowa' }).select('id').single();
  const id = conversationId(data?.id);
  if (error || !id) throw new Error('Nie udało się utworzyć rozmowy.');
  return id;
}

export async function listConversations() {
  const { data, error } = await getSupabase().from('conversations').select('id, title, created_at').order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error || !data) throw new Error('Nie udało się odczytać listy rozmów.');
  return data;
}

export async function saveMessage(id: number, message: UIMessage): Promise<void> {
  if (message.role !== 'user' && message.role !== 'assistant') throw new Error('Nieprawidłowa wiadomość.');
  const { error } = await getSupabase().from('messages').insert({ conversation_id: id, role: message.role, content: JSON.stringify(message) });
  if (error) throw new Error('Nie udało się zapisać wiadomości.');
}

export async function loadConversation(id: number): Promise<UIMessage[] | null> {
  const db = getSupabase();
  const { data: conversation, error: conversationError } = await db.from('conversations').select('id').eq('id', id).maybeSingle();
  if (conversationError) throw new Error('Nie udało się odczytać rozmowy.');
  if (!conversation) return null;
  const { data: rows, error } = await db.from('messages').select('id, role, content').eq('conversation_id', id).order('created_at', { ascending: true }).order('id', { ascending: true });
  if (error || !rows) throw new Error('Nie udało się odczytać wiadomości.');
  const parsedRows = rows.map(row => {
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') throw new Error('Nieprawidłowa zapisana wiadomość.');
    try {
      const parsed: unknown = JSON.parse(row.content);
      if (parsed && typeof parsed === 'object' && 'id' in parsed && typeof parsed.id === 'string' && 'role' in parsed && parsed.role === row.role && 'parts' in parsed && Array.isArray(parsed.parts)) return parsed as UIMessage;
    } catch { /* Wiadomości zapisane jako zwykły tekst pozostają czytelne. */ }
    return { id: `db-${row.id}`, role: row.role, parts: [{ type: 'text', text: row.content }] } as UIMessage;
  });
  // Starsze odpowiedzi SDK bywały zapisywane z pustym ID. Identyfikator wiersza
  // pozwala przywrócić stabilne, różne ID bez usuwania ani scalania wiadomości.
  const reserved = new Set(parsedRows.map(message => message.id).filter(id => id.trim()));
  const used = new Set<string>();
  return parsedRows.map((message, index) => {
    if (message.id.trim() && !used.has(message.id)) { used.add(message.id); return message; }
    let replacement = `db-message-${rows[index].id}`;
    while (reserved.has(replacement) || used.has(replacement)) replacement += '-';
    used.add(replacement);
    return { ...message, id: replacement };
  });
}
