import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, streamText, validateUIMessages } from 'ai';
import { hasSession, privateHeaders } from '../../../lib/session';
import { systemInstruction } from '../../../lib/studio-instruction';

export const runtime = 'nodejs';
export const maxDuration = 60;
const connectionError = 'Nie udało się uzyskać odpowiedzi z OpenRouter. Sprawdź klucz, model i dostępne środki, a następnie spróbuj ponownie.';
export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  let messages;
  try {
    const body = await request.json();
    messages = await validateUIMessages({ messages: body.messages });
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user' ||
        !last.parts.some(part => part.type === 'text' && part.text.trim()) ||
        messages.some(message => !['user', 'assistant'].includes(message.role) || message.parts.some(part => part.type !== 'text' && !(message.role === 'assistant' && (part.type === 'step-start' || part.type === 'reasoning'))))) {
      throw new Error('Invalid messages');
    }
  } catch {
    return new Response('Nieprawidłowa rozmowa lub pusta wiadomość.', { status: 400 });
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) {
    return new Response('Brak konfiguracji czatu na serwerze.', { status: 503 });
  }
  try {
    const openrouter = createOpenRouter({ apiKey });
    const result = streamText({
      model: openrouter(model),
      system: systemInstruction,
      messages: await convertToModelMessages(messages),
      abortSignal: request.signal,
      // Nie zapisuj surowych błędów dostawcy, które mogą zawierać dane żądania.
      onError: () => {},
    });
    return result.toUIMessageStreamResponse({ onError: () => connectionError });
  } catch {
    return new Response(connectionError, { status: 502 });
  }
}
