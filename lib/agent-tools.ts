import { tool } from 'ai';
import { z } from 'zod';

const notes: Array<{ tekst: string; zapisano: string }> = [];
export const agentToolNames = ['web_search', 'generate_image', 'pogoda', 'waluty', 'swieta', 'wikipedia', 'kalkulator', 'czas', 'notatki', 'diagnostyka'] as const;
export const agentStepLimit = 6;
const timestamp = () => new Date().toISOString();
const failure = (message: string) => ({ ok: false as const, blad: message, pobrano: timestamp() });

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), headers: { Accept: 'application/json', 'User-Agent': 'BONA.AI/1.0 (personal assistant)' }, cache: 'no-store' });
  if (!response.ok) throw new Error('API error');
  return response.json();
}

export function createAgentTools(model: string) {
  return {
    pogoda: tool({
      description: 'Prognoza pogody dla miasta i daty w formacie RRRR-MM-DD, do 16 dni naprzód. Podaj kraj, jeśli nazwa miasta jest niejednoznaczna.',
      inputSchema: z.object({ miasto: z.string().trim().min(2).max(100), data: z.iso.date(), kraj: z.string().trim().length(2).optional().describe('Kod kraju ISO 3166-1 alpha-2') }),
      execute: async ({ miasto, data, kraj }, { abortSignal }) => {
        try {
          const query = new URLSearchParams({ name: miasto, count: '1', language: 'pl', format: 'json', ...(kraj ? { countryCode: kraj.toUpperCase() } : {}) });
          const geo = z.object({ results: z.array(z.object({ name: z.string(), country: z.string().optional(), admin1: z.string().optional(), latitude: z.number(), longitude: z.number() })).optional() }).parse(await getJson(`https://geocoding-api.open-meteo.com/v1/search?${query}`, abortSignal));
          const city = geo.results?.[0];
          if (!city) return failure('Nie znaleziono miasta. Podaj dokładniejszą nazwę lub kod kraju.');
          const params = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude), daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max', timezone: 'auto', start_date: data, end_date: data });
          const forecast = z.object({ timezone: z.string(), daily: z.object({ time: z.array(z.string()), weather_code: z.array(z.number().nullable()), temperature_2m_max: z.array(z.number().nullable()), temperature_2m_min: z.array(z.number().nullable()), precipitation_sum: z.array(z.number().nullable()), precipitation_probability_max: z.array(z.number().nullable()) }), daily_units: z.record(z.string(), z.string()).optional() }).parse(await getJson(`https://api.open-meteo.com/v1/forecast?${params}`, abortSignal));
          if (forecast.daily.time[0] !== data) return failure('Brak prognozy dla tej daty. Prognoza jest dostępna do 16 dni naprzód.');
          return { ok: true, lokalizacja: city, ...forecast, zrodlo: 'Open-Meteo', pobrano: timestamp() };
        } catch { return failure('Nie udało się pobrać prognozy. Sprawdź miasto i datę; prognoza obejmuje do 16 dni naprzód.'); }
      },
    }),
    waluty: tool({
      description: 'Aktualny średni kurs waluty NBP względem PLN i przeliczenie kwoty. Kierunek: na_pln lub z_pln.',
      inputSchema: z.object({ waluta: z.string().trim().regex(/^[A-Za-z]{3}$/), kwota: z.number().finite().min(0).max(1e12), kierunek: z.enum(['na_pln', 'z_pln']) }),
      execute: async ({ waluta, kwota, kierunek }, { abortSignal }) => {
        try {
          const code = waluta.toUpperCase();
          if (code === 'PLN') return { ok: true, waluta: code, kurs: 1, kwota, kierunek, wynik: kwota, zrodlo: 'PLN', pobrano: timestamp() };
          let raw: unknown;
          try { raw = await getJson(`https://api.nbp.pl/api/exchangerates/rates/a/${code}/?format=json`, abortSignal); }
          catch { raw = await getJson(`https://api.nbp.pl/api/exchangerates/rates/b/${code}/?format=json`, abortSignal); }
          const rate = z.object({ table: z.string(), currency: z.string(), code: z.string(), rates: z.array(z.object({ effectiveDate: z.iso.date(), mid: z.number().positive() })).min(1) }).parse(raw);
          return { ok: true, waluta: rate.code, nazwa: rate.currency, tabela: rate.table, kurs: rate.rates[0].mid, dataKursu: rate.rates[0].effectiveDate, kwota, kierunek, wynik: kierunek === 'na_pln' ? kwota * rate.rates[0].mid : kwota / rate.rates[0].mid, zrodlo: 'NBP', pobrano: timestamp() };
        } catch { return failure('Nie udało się pobrać kursu NBP. Sprawdź kod waluty i spróbuj ponownie.'); }
      },
    }),
    swieta: tool({
      description: 'Święta publiczne w kraju i roku; kraj to dwuliterowy kod ISO, np. PL.',
      inputSchema: z.object({ kraj: z.string().trim().regex(/^[A-Za-z]{2}$/), rok: z.number().int().min(1900).max(2100) }),
      execute: async ({ kraj, rok }, { abortSignal }) => {
        try {
          const data = z.array(z.object({ date: z.iso.date(), localName: z.string(), name: z.string(), global: z.boolean(), counties: z.array(z.string()).nullable().optional(), types: z.array(z.string()) })).parse(await getJson(`https://date.nager.at/api/v3/PublicHolidays/${rok}/${kraj.toUpperCase()}`, abortSignal));
          return { ok: true, kraj: kraj.toUpperCase(), rok, swieta: data, zrodlo: 'Nager.Date', pobrano: timestamp() };
        } catch { return failure('Nie udało się pobrać świąt. Sprawdź kod kraju i rok.'); }
      },
    }),
    wikipedia: tool({
      description: 'Krótkie streszczenie dokładnego tytułu hasła z polskiej Wikipedii i link do artykułu.',
      inputSchema: z.object({ haslo: z.string().trim().min(1).max(150) }),
      execute: async ({ haslo }, { abortSignal }) => {
        try {
          const data = z.object({ title: z.string(), extract: z.string().min(1), content_urls: z.object({ desktop: z.object({ page: z.url() }) }) }).parse(await getJson(`https://pl.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(haslo.replaceAll(' ', '_'))}`, abortSignal));
          return { ok: true, tytul: data.title, streszczenie: data.extract, link: data.content_urls.desktop.page, zrodlo: 'Wikipedia', pobrano: timestamp() };
        } catch { return failure('Nie znaleziono hasła w polskiej Wikipedii lub serwis jest niedostępny.'); }
      },
    }),
    kalkulator: tool({
      description: 'Oblicza wynik działania na dwóch liczbach bez wykonywania kodu.',
      inputSchema: z.object({ a: z.number().finite(), b: z.number().finite(), dzialanie: z.enum(['dodawanie', 'odejmowanie', 'mnozenie', 'dzielenie']) }),
      execute: async ({ a, b, dzialanie }) => {
        if (dzialanie === 'dzielenie' && b === 0) return failure('Nie można dzielić przez zero.');
        const wynik = dzialanie === 'dodawanie' ? a + b : dzialanie === 'odejmowanie' ? a - b : dzialanie === 'mnozenie' ? a * b : a / b;
        return Number.isFinite(wynik) ? { ok: true, a, b, dzialanie, wynik, pobrano: timestamp() } : failure('Wynik jest poza dostępnym zakresem liczb.');
      },
    }),
    czas: tool({
      description: 'Aktualna data i godzina w strefie IANA, np. Europe/Warsaw.',
      inputSchema: z.object({ strefa: z.string().trim().min(1).max(100) }),
      execute: async ({ strefa }) => {
        try { const now = new Date(); return { ok: true, strefa, czas: new Intl.DateTimeFormat('pl-PL', { timeZone: strefa, dateStyle: 'full', timeStyle: 'long' }).format(now), pobrano: now.toISOString() }; }
        catch { return failure('Nieprawidłowa strefa czasowa. Podaj nazwę IANA, np. Europe/Warsaw.'); }
      },
    }),
    notatki: tool({
      description: 'Zapisuje notatkę albo odczytuje wszystkie notatki. Pamięć jest wspólna dla użytkowników procesu serwera i znika po restarcie.',
      inputSchema: z.object({ akcja: z.enum(['zapisz', 'odczytaj']), tekst: z.string().trim().min(1).max(2000).optional() }),
      execute: async ({ akcja, tekst }) => {
        if (akcja === 'zapisz') { if (!tekst) return failure('Podaj treść notatki.'); if (notes.length >= 100) return failure('Osiągnięto limit 100 notatek w pamięci serwera.'); notes.push({ tekst, zapisano: timestamp() }); }
        return { ok: true, akcja, notatki: akcja === 'odczytaj' ? [...notes] : [notes[notes.length - 1]], informacja: 'Notatki są wspólne w pamięci procesu serwera i znikają po restarcie.', pobrano: timestamp() };
      },
    }),
    diagnostyka: tool({
      description: 'Nazwa wybranego modelu, dostępne narzędzia, limit kroków oraz informacja, czy wymagane ustawienia istnieją, bez wartości sekretów.',
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, model, narzedzia: [...agentToolNames], limitKrokow: agentStepLimit, konfiguracja: { OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY?.trim()), OPENROUTER_MODEL: Boolean(process.env.OPENROUTER_MODEL?.trim()), CHAT_PASSWORD: Boolean(process.env.CHAT_PASSWORD?.trim()), SESSION_SECRET: Boolean(process.env.SESSION_SECRET?.trim()) }, pobrano: timestamp() }),
    }),
  };
}
