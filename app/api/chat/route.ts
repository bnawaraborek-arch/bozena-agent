import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, stepCountIs, streamText, validateUIMessages, wrapLanguageModel } from 'ai';
import { hasSession, privateHeaders } from '../../../lib/session';
import { validImageData } from '../../../lib/image-validation';

export const runtime = 'nodejs';
export const maxDuration = 60;
const connectionError = 'Nie udało się uzyskać odpowiedzi z OpenRouter. Sprawdź klucz, model i dostępne środki, a następnie spróbuj ponownie.';
export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  let messages;
  let savedConversationId: number | undefined;
  try {
    const body = await request.json();
    if (body.conversationId !== undefined) {
      const { conversationId } = await import('../../../lib/conversation-store');
      const id = conversationId(body.conversationId);
      if (!id) throw new Error('Invalid conversation');
      savedConversationId = id;
    }
    messages = await validateUIMessages({ messages: body.messages });
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user' ||
        !last.parts.some(part => part.type === 'text' && part.text.trim()) ||
        messages.some(message => !['user', 'assistant'].includes(message.role) || message.parts.some(part => part.type !== 'text' && !(message.role === 'user' && part.type === 'file' && validImageData(part.url, part.mediaType)) && !(message.role === 'assistant' && (part.type === 'step-start' || part.type === 'reasoning'))))) {
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
    if (savedConversationId) {
      const { saveMessage } = await import('../../../lib/conversation-store');
      try { await saveMessage(savedConversationId, messages[messages.length - 1]); }
      catch { return new Response('Nie udało się zapisać wiadomości. Spróbuj ponownie.', { status: 503, headers: privateHeaders }); }
    }
    const openrouter = createOpenRouter({ apiKey });
    const hasImage = messages.some(message => message.role === 'user' && message.parts.some(part => part.type === 'file'));
    let actualModel: string | undefined;
    const selectedModel = openrouter(hasImage ? 'google/gemini-3.8-flash' : model);
    const languageModel = hasImage ? wrapLanguageModel({ model: selectedModel, middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
          if (chunk.type === 'response-metadata' && chunk.modelId) actualModel = chunk.modelId;
          controller.enqueue(chunk);
        } })) };
      },
    } }) : selectedModel;
    const result = streamText({
      model: languageModel,
      system: 'Jesteś BONA.AI — Twój osobisty asystent AI. Pomagaj użytkownikowi, odpowiadając jasno i uprzejmie. Na pytanie o tożsamość przedstaw się jako BONA.AI. Nie ukrywaj używanego modelu, ale nie zgaduj jego nazwy, jeśli jej nie znasz. Gdy pytanie dotyczy aktualnych wydarzeń, cen, dat lub niepewnych faktów, użyj wyszukiwania i oprzyj odpowiedź na źródłach. Nie wymyślaj źródeł. Gdy nie znajdziesz wiarygodnych wyników, powiedz o tym jasno.',
      messages: await convertToModelMessages(messages),
      tools: { web_search: openrouter.tools.webSearch({ maxResults: 3, engine: 'native' }) },
      stopWhen: stepCountIs(5),
      abortSignal: request.signal,
      // Nie zapisuj surowych błędów dostawcy, które mogą zawierać dane żądania.
      onError: () => {},
    });
    return result.toUIMessageStreamResponse({ sendSources: true, onError: () => connectionError,
      ...(savedConversationId ? { originalMessages: messages, onFinish: async ({ responseMessage }: { responseMessage: typeof messages[number] }) => {
        if (responseMessage.parts.length) {
          const { saveMessage } = await import('../../../lib/conversation-store');
          await saveMessage(savedConversationId, responseMessage);
        }
      } } : {}),
      messageMetadata: ({ part }) => part.type === 'finish' && hasImage ? { visionModelId: actualModel ?? null } : undefined });
  } catch {
    return new Response(connectionError, { status: 502 });
  }
}
