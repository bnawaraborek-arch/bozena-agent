import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateId, generateImage } from 'ai';
import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  let prompt: string;
  let savedConversationId: number | undefined;
  try {
    const body = await request.json();
    if (typeof body?.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 500) throw new Error();
    if (body.conversationId !== undefined) {
      const { conversationId } = await import('../../../lib/conversation-store');
      const id = conversationId(body.conversationId);
      if (!id) throw new Error();
      savedConversationId = id;
    }
    prompt = body.prompt.trim();
  } catch { return new Response('Podaj opis obrazu (maksymalnie 500 znaków).', { status: 400, headers: privateHeaders }); }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return new Response('Brak konfiguracji OpenRouter.', { status: 503, headers: privateHeaders });
  try {
    const result = await generateImage({ model: createOpenRouter({ apiKey }).imageModel('google/gemini-3.1-flash-image-preview'), prompt, abortSignal: request.signal, maxRetries: 0 });
    const image = result.image;
    if (!image?.base64 || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType)) throw new Error();
    const url = `data:${image.mediaType};base64,${image.base64}`;
    const modelId = result.responses[0]?.modelId || null;
    let historySaved = true;
    if (savedConversationId) {
      try {
        const { saveMessage } = await import('../../../lib/conversation-store');
        await saveMessage(savedConversationId, { id: generateId(), role: 'assistant', metadata: { generatedImage: true, imageModelId: modelId }, parts: [{ type: 'text', text: prompt }, { type: 'file', mediaType: image.mediaType, url }] });
      } catch { historySaved = false; }
    }
    return Response.json({ url, modelId, ...(savedConversationId ? { historySaved } : {}) }, { headers: privateHeaders });
  } catch {
    return new Response('Nie udało się wygenerować obrazu. Model może być niedostępny; sprawdź konfigurację i środki OpenRouter.', { status: 502, headers: privateHeaders });
  }
}
