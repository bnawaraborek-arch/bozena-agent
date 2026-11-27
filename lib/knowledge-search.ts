import 'server-only';
import { embed } from 'ai';
import { getEmbeddingModel } from './model';
import { getSupabase } from './supabase';
import { KNOWLEDGE_MIN_SIMILARITY } from './knowledge-config';

export async function searchKnowledge(question: string, abortSignal?: AbortSignal) {
  const { embedding } = await embed({ model: getEmbeddingModel(), value: question, abortSignal, maxRetries: 0 });
  if (embedding.length !== 1536 || embedding.some(value => !Number.isFinite(value))) throw new Error('Nieprawidłowy embedding.');
  const { data, error } = await getSupabase().rpc('match_chunks', { query_embedding: embedding, match_count: 3 });
  if (error || !Array.isArray(data)) throw new Error('Nie udało się przeszukać bazy wiedzy.');
  return data.slice(0, 3).map(row => {
    if ((typeof row.id !== 'string' && typeof row.id !== 'number') || typeof row.title !== 'string' || typeof row.content !== 'string' || typeof row.similarity !== 'number' || !Number.isFinite(row.similarity)) throw new Error('Nieprawidłowy wynik wyszukiwania.');
    return { sourceId: encodeURIComponent(String(row.id)), title: row.title, content: row.content, similarity: row.similarity };
  }).filter(row => row.similarity >= KNOWLEDGE_MIN_SIMILARITY);
}
