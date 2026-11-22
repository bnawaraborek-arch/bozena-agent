import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from 'ai';
import { analysisInstruction, analysisRequestSchema, analysisSchema } from '../../../lib/analysis';
import { hasSession, privateHeaders, sameOrigin } from '../../../lib/session';
import { systemInstruction } from '../../../lib/studio-instruction';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!hasSession(request)) return new Response('Brak dostępu. Zaloguj się.', { status: 401, headers: privateHeaders });
  if (!sameOrigin(request)) return new Response('Brak dostępu.', { status: 403, headers: privateHeaders });
  let message: string;
  try {
    message = analysisRequestSchema.parse(await request.json()).message;
  } catch {
    return new Response('Podaj tylko wiadomość do analizy (maksymalnie 12 000 znaków).', { status: 400, headers: privateHeaders });
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) return new Response('Brak konfiguracji OpenRouter na serwerze.', { status: 503, headers: privateHeaders });
  try {
    const openrouter = createOpenRouter({ apiKey });
    const result = await generateText({
      model: openrouter.chat(model, { provider: { require_parameters: true }, structuredOutputs: { strict: true } }),
      system: `${systemInstruction}\n\n${analysisInstruction}`,
      prompt: message,
      output: Output.object({ schema: analysisSchema }),
      abortSignal: request.signal,
      maxRetries: 0,
    });
    if (result.finishReason !== 'stop') {
      return new Response('Model odmówił odpowiedzi lub analiza została przerwana. Spróbuj ponownie.', { status: 502, headers: privateHeaders });
    }
    const checked = analysisSchema.safeParse(result.output);
    if (!checked.success) return new Response('Model zwrócił nieprawidłowy wynik analizy.', { status: 502, headers: privateHeaders });
    return Response.json(checked.data, { headers: privateHeaders });
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      return new Response('Model odmówił odpowiedzi, przerwał ją lub zwrócił wynik niezgodny ze schematem.', { status: 502, headers: privateHeaders });
    }
    return new Response('Nie udało się wykonać analizy przez OpenRouter. Sprawdź konfigurację, dostępność i środki. Model i jego dostawca muszą obsługiwać structured outputs (JSON Schema); w razie potrzeby wybierz zgodny model po sprawdzeniu kosztów.', { status: 502, headers: privateHeaders });
  }
}
