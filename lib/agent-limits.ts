import type { ToolSet } from 'ai';

export const TOOL_LIMIT = 16;
export const TASK_TIMEOUT_MS = 60_000;
export const API_TIMEOUT_MS = 10_000;
const externalTools = new Set(['pogoda', 'waluty', 'swieta', 'wikipedia', 'generate_image']);

export function createToolGuard() {
  let calls = 0;
  const failed = new Set<string>();
  function wrap<T extends ToolSet>(tools: T): T {
    const wrapped = Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
      if (!definition.execute) return [name, definition];
      const execute = definition.execute;
      return [name, { ...definition, execute: async (input: unknown, options: { abortSignal?: AbortSignal }) => {
        if (calls >= TOOL_LIMIT) return { ok: false, blad: 'Osiągnięto limit 16 wywołań narzędzi.', error: 'Osiągnięto limit 16 wywołań narzędzi.' };
        calls++;
        const key = `${name}:${JSON.stringify(input)}`;
        if (failed.has(key)) return { ok: false, blad: 'Nie ponowiono nieudanego wywołania narzędzia.', error: 'Nie ponowiono nieudanego wywołania narzędzia.' };
        const controller = new AbortController();
        const signal = options.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const operation = Promise.resolve().then(() => execute(input as never, { ...options, abortSignal: signal } as never));
          const result = externalTools.has(name) ? await Promise.race([operation, new Promise<never>((_, reject) => {
            timer = setTimeout(() => { reject(new Error('SOURCE_TIMEOUT')); controller.abort(); }, API_TIMEOUT_MS);
          })]) : await operation;
          if (result && typeof result === 'object' && 'ok' in result && result.ok === false) failed.add(key);
          return result;
        } catch (error) {
          failed.add(key);
          const message = error instanceof Error && error.message === 'SOURCE_TIMEOUT' ? 'Źródło nie odpowiada' : 'Nie udało się wykonać narzędzia.';
          return { ok: false, blad: message, error: message };
        } finally { if (timer) clearTimeout(timer); }
      } }];
    }));
    return wrapped as T;
  }
  return { wrap, recordProviderCall() { calls++; }, get calls() { return calls; } };
}
