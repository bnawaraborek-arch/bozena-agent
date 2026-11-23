import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, generateImage, stepCountIs, streamText, tool, validateUIMessages } from 'ai';
import { z } from 'zod';
import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';
import { validImageData } from '../../../lib/image-validation';
import { agentStepLimit, createAgentTools } from '../../../lib/agent-tools';
import { createToolGuard, TASK_TIMEOUT_MS, TOOL_LIMIT } from '../../../lib/agent-limits';

export const runtime = 'nodejs';
export const maxDuration = 60;
const errorMessage = 'Nie udało się wykonać zadania. Model lub narzędzie może być niedostępne; sprawdź konfigurację i środki OpenRouter.';

export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  const startedAt = Date.now();
  let messages;
  try {
    const body = await request.json();
    messages = await validateUIMessages({ messages: body.messages });
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user' || !last.parts.some(part => part.type === 'text' && part.text.trim()) ||
      messages.some(message => !['user', 'assistant'].includes(message.role) || message.parts.some(part => part.type !== 'text' && !(message.role === 'user' && part.type === 'file' && validImageData(part.url, part.mediaType))))) throw new Error();
  } catch { return new Response('Nieprawidłowa wiadomość lub zdjęcie. Użyj JPG, PNG albo WebP do 4 MB.', { status: 400, headers: privateHeaders }); }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const modelId = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !modelId) return new Response('Brak konfiguracji OpenRouter.', { status: 503, headers: privateHeaders });
  try {
    const openrouter = createOpenRouter({ apiKey });
    const hasImage = messages.some(message => message.role === 'user' && message.parts.some(part => part.type === 'file'));
    const selectedModel = hasImage ? 'google/gemini-3.8-flash' : modelId;
    let finishedSteps = 0;
    let toolCalls = 0;
    const guard = createToolGuard();
    const result = streamText({
      model: openrouter(selectedModel, { parallelToolCalls: false }),
      system: 'Jesteś BONA.AI, uniwersalnym, osobistym asystentem AI. Na pytanie o tożsamość odpowiedz: „Jestem BONA.AI, Twoim osobistym asystentem AI.” Jeśli użytkownik zapyta o technologię, możesz wyjaśnić, że korzystasz z modeli AI zewnętrznych dostawców. Nie ukrywaj, jaki model jest używany, ale nie zgaduj, jeśli nie znasz jego nazwy. Pomagaj użytkownikowi wyszukiwać informacje, analizować obrazy, tworzyć grafiki i planować podróże. Odpowiadaj jasno i uprzejmie. Przy zadaniu złożonym pracuj krok po kroku. Użyj narzędzia, przeczytaj jego wynik i dopiero wtedy zdecyduj o następnym kroku. Nie zgaduj danych, które możesz sprawdzić. Sam wybieraj narzędzia: wyszukuj aktualne informacje, generuj obrazy na prośbę użytkownika, a przesłane zdjęcia analizuj bezpośrednio. Opieraj aktualne informacje na źródłach i nie wymyślaj ich. Nie twierdź, że obraz powstał, jeśli narzędzie zwróciło błąd.',
      messages: await convertToModelMessages(messages),
      tools: guard.wrap({
        ...createAgentTools(selectedModel),
        web_search: openrouter.tools.webSearch({ maxResults: 3, engine: 'native' }),
        generate_image: tool({
          description: 'Generuje obraz, gdy użytkownik prosi o stworzenie grafiki lub ilustracji.',
          inputSchema: z.object({ prompt: z.string().trim().min(1).max(500) }),
          execute: async ({ prompt }, { abortSignal }) => {
            try {
              const generated = await generateImage({ model: openrouter.imageModel('google/gemini-3.1-flash-image-preview'), prompt, abortSignal, maxRetries: 0 });
              if (!generated.image?.base64 || !['image/png', 'image/jpeg', 'image/webp'].includes(generated.image.mediaType)) throw new Error();
              return { ok: true as const, url: `data:${generated.image.mediaType};base64,${generated.image.base64}`, modelId: generated.responses[0]?.modelId ?? null };
            } catch { return { ok: false as const, error: 'Nie udało się wygenerować obrazu. Model lub dostawca może być niedostępny.' }; }
          },
          toModelOutput: ({ output }) => ({ type: 'text', value: output.ok ? 'Obraz został wygenerowany i jest dostępny użytkownikowi.' : output.error }),
        }),
      }),
      maxRetries: 0,
      timeout: { totalMs: Math.max(1, TASK_TIMEOUT_MS - (Date.now() - startedAt)) },
      onChunk: ({ chunk }) => { if (chunk.type === 'tool-call') { toolCalls++; if (chunk.providerExecuted) guard.recordProviderCall(); } },
      stopWhen: [stepCountIs(agentStepLimit), ({ steps }) => steps.reduce((count, step) => count + step.toolCalls.length, 0) >= TOOL_LIMIT],
      abortSignal: request.signal,
      onError: () => {},
    });
    return result.toUIMessageStreamResponse({ sendSources: true, onError: () => errorMessage, headers: privateHeaders,
      messageMetadata: ({ part }) => {
        if (part.type === 'finish-step') finishedSteps++;
        if (part.type === 'finish' || part.type === 'abort') return { limitReached: finishedSteps >= agentStepLimit, stepLimit: agentStepLimit, steps: finishedSteps, toolCalls, seconds: Math.max(0, (Date.now() - startedAt) / 1000), timedOut: part.type === 'abort' && !request.signal.aborted, toolLimitReached: toolCalls >= TOOL_LIMIT };
      },
    });
  } catch { return new Response(errorMessage, { status: 502, headers: privateHeaders }); }
}
