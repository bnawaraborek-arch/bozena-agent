import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, streamText, validateUIMessages } from 'ai';
import { createHash, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;
const connectionError = 'Nie udało się uzyskać odpowiedzi z OpenRouter. Sprawdź klucz, model i dostępne środki, a następnie spróbuj ponownie.';
const attemptWindowMs = 60_000;
const maxFailedAttempts = 10;
// Wspólny limit procesu; nie ufamy nagłówkom IP przesyłanym przez klienta.
let failedAttempts = 0;
let windowEndsAt = 0;

function unauthorized(retryAfter?: number) {
  return new Response('Brak dostępu. Podaj poprawny kod dostępu.' +
    (retryAfter ? ' Zbyt wiele błędnych prób. Spróbuj ponownie za minutę.' : ''), {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    },
  });
}

export async function POST(request: Request) {
  const now = Date.now();
  if (now >= windowEndsAt) {
    failedAttempts = 0;
    windowEndsAt = now + attemptWindowMs;
  }
  if (failedAttempts >= maxFailedAttempts) {
    return unauthorized(Math.ceil((windowEndsAt - now) / 1000));
  }
  const expectedCode = process.env.CHAT_ACCESS_CODE;
  const suppliedCode = request.headers.get('X-Chat-Access-Code');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!expectedCode || !expectedCode.trim() || !suppliedCode ||
      !timingSafeEqual(digest(expectedCode), digest(suppliedCode))) {
    failedAttempts++;
    return unauthorized(failedAttempts >= maxFailedAttempts
      ? Math.ceil((windowEndsAt - now) / 1000) : undefined);
  }
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
      messages: await convertToModelMessages(messages),
      abortSignal: request.signal,
    });
    return result.toUIMessageStreamResponse({ onError: () => connectionError });
  } catch {
    return new Response(connectionError, { status: 502 });
  }
}
