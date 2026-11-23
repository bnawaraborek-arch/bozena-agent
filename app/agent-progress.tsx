import type { ReactNode } from 'react';

type CompletedTool = { name: string; state: 'output-available' | 'output-error'; output?: unknown; errorText?: string };

function completedTools(parts: readonly unknown[]): CompletedTool[] {
  return parts.flatMap(part => {
    if (!part || typeof part !== 'object' || !('type' in part) || typeof part.type !== 'string' || !('state' in part)) return [];
    if (part.state !== 'output-available' && part.state !== 'output-error') return [];
    const name = part.type === 'dynamic-tool' && 'toolName' in part && typeof part.toolName === 'string'
      ? part.toolName : part.type.startsWith('tool-') ? part.type.slice(5) : '';
    return name ? [{ name, state: part.state, output: 'output' in part ? part.output : undefined, errorText: 'errorText' in part && typeof part.errorText === 'string' ? part.errorText : undefined }] : [];
  });
}

function readableResult(tool: CompletedTool): ReactNode {
  if (tool.state === 'output-error') return 'Narzędzie zgłosiło błąd.';
  if (tool.name === 'generate_image') {
    const output = tool.output as { ok?: boolean; error?: string } | undefined;
    return output?.ok ? 'Wygenerowany obraz jest widoczny w rozmowie.' : output?.error || 'Nie udało się wygenerować obrazu.';
  }
  if (tool.output === undefined) return 'Brak dostępnego wyniku.';
  return JSON.stringify(tool.output, (_key, value: unknown) => typeof value === 'string' && value.startsWith('data:image/') ? '[Obraz jest widoczny w rozmowie]' : value, 2);
}

export function AgentProgress({ parts, limitReached, stepLimit = 6, timedOut, toolLimitReached }: { parts: readonly unknown[]; limitReached?: boolean; stepLimit?: number; timedOut?: boolean; toolLimitReached?: boolean }) {
  const tools = completedTools(parts);
  const hasError = tools.some(tool => tool.state === 'output-error' || (tool.output && typeof tool.output === 'object' && 'ok' in tool.output && tool.output.ok === false));
  const showResults = limitReached || timedOut || toolLimitReached || hasError;
  return <>
    {tools.length > 0 && <section className="agent-progress" aria-label="Wykonane kroki"><strong>Wykonane kroki</strong><ol>{tools.map((tool, index) => <li key={index}>{tool.name}</li>)}</ol></section>}
    {showResults && <section className="agent-limit" role="status">{limitReached && <strong>Zatrzymałem się po {stepLimit} krokach</strong>}{toolLimitReached && <strong> Osiągnięto limit wywołań narzędzi.</strong>}{timedOut && <strong> Zadanie przekroczyło limit czasu.</strong>}{hasError && <strong> Nie udało się sprawdzić wszystkich informacji. Szczegóły poniżej.</strong>}
      <p>Dotychczasowe wyniki narzędzi:</p>
      {tools.length ? tools.map((tool, index) => <div key={index}><strong>{tool.name}</strong><pre>{readableResult(tool)}</pre></div>) : <p>Nie otrzymano wyników narzędzi.</p>}
    </section>}
  </>;
}
