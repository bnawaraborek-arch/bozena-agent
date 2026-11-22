import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, generateImage, stepCountIs, streamText, tool, validateUIMessages } from 'ai';
import { z } from 'zod';
import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';
import { validImageData } from '../../../lib/image-validation';
import { systemInstruction } from '../../../lib/studio-instruction';

export const runtime = 'nodejs';
export const maxDuration = 60;
const errorMessage = 'Nie udało się wykonać zadania. Model lub narzędzie może być niedostępne; sprawdź konfigurację i środki OpenRouter.';

export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
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
    const result = streamText({
      model: openrouter(hasImage ? 'google/gemini-3.8-flash' : modelId),
      system: `${systemInstruction}\n\nSam wybieraj narzędzia: wyszukuj aktualne informacje, generuj obrazy na prośbę użytkownika, a przesłane zdjęcia analizuj bezpośrednio. Nie twierdź, że obraz powstał, jeśli narzędzie zwróciło błąd.`,
      messages: await convertToModelMessages(messages),
      tools: {
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
      },
      stopWhen: stepCountIs(5),
      abortSignal: request.signal,
      onError: () => {},
    });
    return result.toUIMessageStreamResponse({ sendSources: true, onError: () => errorMessage, headers: privateHeaders });
  } catch { return new Response(errorMessage, { status: 502, headers: privateHeaders }); }
}
