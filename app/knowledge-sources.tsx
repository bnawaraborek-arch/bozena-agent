import { KNOWLEDGE_MIN_SIMILARITY } from '../lib/knowledge-config';

type Fragment = { sourceId: string; title: string; content: string; similarity: number };
const marker = /⟦źródło:([\w.%~-]+)⟧/g;
export function stripKnowledgeMarkers(text: string) { return text.replace(marker, '').trimEnd(); }

export function KnowledgeSources({ parts }: { parts: readonly unknown[] }) {
  const cited = new Set<string>();
  const fragments = new Map<string, Fragment>();
  for (const item of parts) {
    if (!item || typeof item !== 'object') continue;
    if ('type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string') {
      for (const match of item.text.matchAll(marker)) cited.add(match[1]);
    }
    if (!('type' in item) || item.type !== 'tool-searchKnowledge' || !('state' in item) || item.state !== 'output-available' || !('output' in item)) continue;
    const output = item.output as { ok?: boolean; fragments?: Fragment[] } | undefined;
    if (!output?.ok || !Array.isArray(output.fragments)) continue;
    for (const fragment of output.fragments) {
      if (typeof fragment.sourceId === 'string' && typeof fragment.title === 'string' && typeof fragment.content === 'string' && typeof fragment.similarity === 'number' && Number.isFinite(fragment.similarity) && fragment.similarity >= KNOWLEDGE_MIN_SIMILARITY) fragments.set(fragment.sourceId, fragment);
    }
  }
  const used = [...cited].flatMap(id => fragments.has(id) ? [fragments.get(id)!] : []);
  if (!used.length) return null;
  return <section className="knowledge-sources" aria-label="Źródła z bazy wiedzy"><strong>Źródła z bazy wiedzy</strong><ul>{used.map(item => <li key={item.sourceId}>
    <strong>{item.title}</strong> — podobieństwo: {Math.round(item.similarity * 100)}%
    <details><summary>Pokaż fragment</summary><p>{item.content}</p></details>
  </li>)}</ul></section>;
}
