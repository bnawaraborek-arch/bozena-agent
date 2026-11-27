// Model embeddingów: openai/text-embedding-3-small; wymiar wektora: 1536.
import 'server-only';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export function getEmbeddingModel() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const modelId = process.env.OPENROUTER_EMBEDDING_MODEL?.trim();
  if (!apiKey || !modelId) throw new Error('Brak konfiguracji modelu embeddingów.');
  return createOpenRouter({ apiKey }).textEmbeddingModel(modelId);
}
