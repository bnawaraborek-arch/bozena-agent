import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';
import { getSupabase } from '../../../lib/supabase';
import { splitKnowledgeText } from '../../../lib/knowledge-chunks';
import { getEmbeddingModel } from '../../../lib/model';
import { embedMany } from 'ai';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  try {
    const { data, error } = await getSupabase().from('documents').select('id, title, created_at, chunks(count)').order('created_at', { ascending: false });
    if (error || !data) throw new Error();
    return Response.json({ documents: data.map(item => ({ id: item.id, title: item.title, created_at: item.created_at, count: item.chunks?.[0]?.count ?? 0 })) }, { headers: privateHeaders });
  } catch { return new Response('Nie udało się pobrać listy dokumentów. Odśwież stronę.', { status: 503, headers: privateHeaders }); }
}

export async function DELETE(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  let id: string | number;
  try { const body = await request.json(); id = body.id; if ((typeof id !== 'string' || !id.trim() || id.length > 100) && (!Number.isSafeInteger(id) || Number(id) <= 0)) throw new Error(); }
  catch { return new Response('Nieprawidłowy dokument.', { status: 400, headers: privateHeaders }); }
  try {
    const result = await getSupabase().from('documents').delete().eq('id', id).select('id');
    if (result.error) throw new Error();
    if (!result.data?.length) return new Response('Dokument nie istnieje. Odśwież listę.', { status: 404, headers: privateHeaders });
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch { return new Response('Nie udało się usunąć dokumentu. Spróbuj ponownie.', { status: 503, headers: privateHeaders }); }
}

export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  let title: string, content: string, replaceIds: Array<string | number>;
  try {
    const body = await request.json();
    if (typeof body.title !== 'string' || typeof body.content !== 'string' || !body.title.trim() || !body.content.trim() || body.title.length > 500 || body.content.length > 20000) throw new Error();
    title = body.title.trim(); content = body.content.trim();
    if (body.replaceIds !== undefined && (!Array.isArray(body.replaceIds) || body.replaceIds.some((id: unknown) => !((typeof id === 'string' && id.length > 0 && id.length <= 100) || (typeof id === 'number' && Number.isSafeInteger(id) && id > 0))))) throw new Error();
    replaceIds = body.replaceIds ?? [];
  } catch { return new Response('Podaj tytuł i treść dokumentu (maksymalnie 20 000 znaków).', { status: 400, headers: privateHeaders }); }
  let db: ReturnType<typeof getSupabase>;
  try { db = getSupabase(); }
  catch { return new Response('Nie udało się połączyć z bazą wiedzy. Spróbuj ponownie.', { status: 503, headers: privateHeaders }); }
  try {
    const existing = await db.from('documents').select('id').eq('title', title);
    if (existing.error || !existing.data) throw new Error();
    const existingIds = existing.data.map(item => String(item.id)).sort();
    if (JSON.stringify(existingIds) !== JSON.stringify(replaceIds.map(String).sort())) return new Response('Lista dokumentów zmieniła się. Odśwież ją i potwierdź zastąpienie.', { status: 409, headers: privateHeaders });
  } catch { return new Response('Nie udało się sprawdzić istniejących dokumentów. Spróbuj ponownie.', { status: 503, headers: privateHeaders }); }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ async start(controller) {
  const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
  send({ stage: 'Dzielę tekst…' });
  const chunks = splitKnowledgeText(content);
  let id: unknown;
  try {
    const result = await db.from('documents').insert({ title }).select('id').single();
    if (result.error || result.data?.id == null) throw new Error();
    id = result.data.id;
  } catch { send({ error: 'Etap zapisu: nie udało się utworzyć dokumentu. Spróbuj ponownie.' }); controller.close(); return; }
  let stage = 'tworzenia embeddingów';
  try {
    send({ stage: 'Tworzę embeddingi…' });
    const missing: Array<{ id: string | number; content: string }> = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const result = await db.from('chunks').select('id, content').is('embedding', null).order('id', { ascending: true }).range(offset, offset + pageSize - 1);
      if (result.error || !result.data) throw new Error();
      for (const item of result.data) {
        if ((typeof item.id !== 'string' && typeof item.id !== 'number') || typeof item.content !== 'string' || !item.content.trim()) throw new Error();
        missing.push({ id: item.id, content: item.content });
      }
      if (result.data.length < pageSize) break;
    }
    const { embeddings } = await embedMany({ model: getEmbeddingModel(), values: [...chunks, ...missing.map(item => item.content)], maxRetries: 0 });
    if (embeddings.length !== chunks.length + missing.length || embeddings.some(vector => vector.length !== 1536 || vector.some(value => !Number.isFinite(value)))) throw new Error();
    stage = 'zapisu';
    send({ stage: 'Zapisuję…' });
    const result = await db.from('chunks').insert(chunks.map((content, chunk_index) => ({ document_id: id, chunk_index, content, embedding: embeddings[chunk_index] })));
    if (result.error) throw new Error();
    for (let index = 0; index < missing.length; index++) {
      const updated = await db.from('chunks').update({ embedding: embeddings[chunks.length + index] }).eq('id', missing[index].id).is('embedding', null).select('id');
      if (updated.error || !updated.data?.length) throw new Error();
    }
  } catch {
    try {
      const result = await db.from('documents').delete().eq('id', id).select('id');
      if (result.error || !result.data?.length) throw new Error();
    } catch { send({ error: `Etap ${stage}: wystąpił błąd i nie udało się usunąć niedokończonego dokumentu. Sprawdź bazę danych.` }); controller.close(); return; }
    send({ error: `Etap ${stage}: nie udało się zakończyć importu. Dokument został usunięty; sprawdź połączenie i spróbuj ponownie.` }); controller.close(); return;
  }
  if (replaceIds.length) {
    try {
      const deleted = await db.from('documents').delete().in('id', replaceIds).eq('title', title).select('id');
      if (deleted.error || deleted.data?.length !== replaceIds.length) throw new Error();
    } catch {
      send({ error: 'Etap zapisu: nie udało się potwierdzić usunięcia poprzedniej wersji. Nowy dokument zachowano. Sprawdź listę dokumentów przed ponowieniem.' });
      controller.close(); return;
    }
  }
  send({ title, count: chunks.length }); controller.close();
  } });
  return new Response(stream, { headers: { ...privateHeaders, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' } });
}
