import { z } from 'zod';

export const analysisRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(12000),
});

export const analysisSchema = z.strictObject({
  category: z.enum(['sales', 'support', 'billing', 'unknown']),
  priority: z.enum(['normal', 'high']),
  draft: z.string(),
  needs_review: z.boolean(),
});

export type Analysis = z.infer<typeof analysisSchema>;

export const analysisInstruction = `Przeanalizuj jedną wiadomość klienta i przygotuj wynik zgodnie ze schematem.
category: sales oznacza ofertę lub cenę; support problem techniczny; billing płatność lub zwrot; unknown brak rozpoznanej sprawy.
priority: high wyłącznie przy blokadzie opłaconego spotkania zaczynającego się w ciągu godziny; pozostałe przypadki normal.
needs_review ma wartość true przy braku danych lub konieczności decyzji pracownika.
Każda odpowiedź jest szkicem, również gdy needs_review ma wartość false.`;
