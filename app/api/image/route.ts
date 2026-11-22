import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateImage } from 'ai';
import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  let prompt: string;
  try {
    const body = await request.json();
    if (typeof body?.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 500) throw new Error();
    prompt = body.prompt.trim();
  } catch { return new Response('Podaj opis obrazu (maksymalnie 500 znaków).', { status: 400, headers: privateHeaders }); }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return new Response('Brak konfiguracji OpenRouter.', { status: 503, headers: privateHeaders });
  try {
    const result = await generateImage({ model: createOpenRouter({ apiKey }).imageModel('google/gemini-3.1-flash-image-preview'), prompt, abortSignal: request.signal, maxRetries: 0 });
    const image = result.image;
    if (!image?.base64 || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType)) throw new Error();
    return Response.json({ url: `data:${image.mediaType};base64,${image.base64}`, modelId: result.responses[0]?.modelId || null }, { headers: privateHeaders });
  } catch {
    return new Response('Nie udało się wygenerować obrazu. Model może być niedostępny; sprawdź konfigurację i środki OpenRouter.', { status: 502, headers: privateHeaders });
  }
}
