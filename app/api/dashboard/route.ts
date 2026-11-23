import { z } from 'zod';
import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getDashboard } from '../../../lib/dashboard';

export const runtime = 'nodejs';
export const maxDuration = 60;
const input = z.object({ city: z.string().trim().min(2).max(100), date: z.iso.date() }).strict();

export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  try {
    const body = input.parse(await request.json());
    const result = await getDashboard(body.city, body.date, request.signal);
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    const modelId = process.env.OPENROUTER_MODEL?.trim();
    if (apiKey && modelId) {
      try {
        const generated = await generateText({ model: createOpenRouter({ apiKey })(modelId), system: 'Wybierz wariant każdego zdania porady. Zwróć wyłącznie JSON: {"packing":0 lub 1,"caution":0 lub 1}. Nie dodawaj żadnych informacji.', prompt: JSON.stringify(result.summaryOptions), abortSignal: request.signal, timeout: { totalMs: 10000 }, maxRetries: 0 });
        const choice = z.object({ packing: z.union([z.literal(0), z.literal(1)]), caution: z.union([z.literal(0), z.literal(1)]) }).strict().parse(JSON.parse(generated.text));
        result.summary = [result.summaryOptions.packing[choice.packing], result.summaryOptions.caution[choice.caution], result.summaryOptions.missing].filter(Boolean).join(' ');
      } catch { /* Zachowaj podsumowanie oparte na danych, gdy model nie odpowiada. */ }
    }
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return new Response('Podaj miasto i poprawną datę.', { status: 400, headers: privateHeaders });
    if (error instanceof Error && error.message === 'Nie znaleziono miasta. Spróbuj innej nazwy.') return new Response(error.message, { status: 404, headers: privateHeaders });
    return new Response('Nie udało się pobrać danych podróży. Spróbuj ponownie.', { status: 502, headers: privateHeaders });
  }
}
