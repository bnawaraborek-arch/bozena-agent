import { z } from 'zod';
import { createAgentTools } from './agent-tools';
import { createToolGuard } from './agent-limits';

export type DashboardCard = { title: string; source: string; fetchedAt: string; value: string; link?: string; ok: boolean };
export type DashboardData = { city: string; country: string; date: string; cards: DashboardCard[]; summary: string; summaryOptions: { packing: [string, string]; caution: [string, string]; missing: string | null } };
const card = (title: string, source: string, value: string, fetchedAt: string, ok = true, link?: string): DashboardCard => ({ title, source, value, fetchedAt, ok, ...(link ? { link } : {}) });
const unavailable = (title: string, source: string, message = 'Brak danych — spróbuj odświeżyć.'): DashboardCard => card(title, source, message, new Date().toISOString(), false);

async function json(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Accept: 'application/json', 'User-Agent': 'BONA.AI/1.0 (travel dashboard)' } });
  if (!response.ok) throw new Error('Source unavailable');
  return response.json();
}
function offsetMinutes(zone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now);
  const offset = parts.find(part => part.type === 'timeZoneName')?.value ?? '';
  if (offset === 'GMT' || offset === 'UTC') return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) throw new Error('Unknown offset');
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}
const toolOptions = (signal: AbortSignal) => ({ toolCallId: 'dashboard', messages: [], abortSignal: signal });
function checked<T>(value: unknown, schema: z.ZodType<T>): T {
  if (value && typeof value === 'object' && 'ok' in value && value.ok === false) throw new Error('Narzędzie nie zwróciło danych.');
  return schema.parse(value);
}
function holidayName(item: { name: string; localName: string; date: string }, country: string): string {
  if (country === 'PL') return item.localName;
  const names: Record<string, { date: string; polish: string }> = {
    'christmas day': { date: '12-25', polish: 'Boże Narodzenie' },
    christmas: { date: '12-25', polish: 'Boże Narodzenie' },
    "new year's day": { date: '01-01', polish: 'Nowy Rok' },
  };
  const translation = names[item.name.trim().toLowerCase()];
  return translation && item.date.slice(5) === translation.date ? translation.polish : item.localName;
}

export async function getDashboard(city: string, date: string, signal: AbortSignal): Promise<DashboardData> {
  const tools = createToolGuard().wrap(createAgentTools('dashboard'));
  const options = toolOptions(signal);
  const getWiki = async (name: string): Promise<DashboardCard> => {
    try {
      const result = checked(await tools.wikipedia.execute!({ haslo: name }, options), z.object({ pobrano: z.string(), streszczenie: z.string(), link: z.string() }));
      const text = result.streszczenie.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.slice(0, 2).join('').trim() || result.streszczenie;
      const url = new URL(result.link);
      if (url.protocol !== 'https:' || url.hostname !== 'pl.wikipedia.org') return unavailable('Wikipedia', 'Wikipedia');
      return card('Wikipedia', 'Wikipedia', text, result.pobrano, true, result.link);
    } catch { return unavailable('Wikipedia', 'Wikipedia'); }
  };
  const geoQuery = new URLSearchParams({ name: city, count: '1', language: 'pl', format: 'json' });
  let geo;
  try {
    geo = z.object({ results: z.array(z.object({ name: z.string(), country: z.string().optional(), country_code: z.string().length(2), timezone: z.string(), admin1: z.string().optional() })).optional() }).parse(await json(`https://geocoding-api.open-meteo.com/v1/search?${geoQuery}`, signal));
  } catch {
    const cards = [unavailable('Pogoda', 'Open-Meteo', 'Brak danych — nie udało się ustalić położenia miasta.'), unavailable('Waluty', 'NBP', 'Brak danych — nie udało się ustalić kraju.'), unavailable('Święta', 'Nager.Date', 'Brak danych — nie udało się ustalić kraju.'), await getWiki(city), unavailable('Czas', 'Zegar serwera / IANA', 'Brak danych — nie udało się ustalić strefy czasowej.')];
    const packing: [string, string] = ['Brakuje prognozy, więc nie mogę dobrać ubrań do pogody.', 'Bez prognozy nie mogę polecić ubrań na tę pogodę.'];
    const caution: [string, string] = ['Sprawdź prognozę przed wyjazdem.', 'Przed wyjazdem sprawdź aktualną prognozę pogody.'];
    const missing = `Brak danych: ${cards.filter(item => !item.ok).map(item => item.title).join(', ')}.`;
    return { city, country: 'Kraj nieustalony', date, cards, summary: [packing[0], caution[0], missing].join(' '), summaryOptions: { packing, caution, missing } };
  }
  const location = geo.results?.[0];
  if (!location) throw new Error('Nie znaleziono miasta. Spróbuj innej nazwy.');
  const sourceCity = location.name;
  const countryCode = location.country_code.toUpperCase();
  const country = location.country ?? countryCode;
  const year = Number(date.slice(0, 4));
  const currency = (async () => {
    try {
      const data = z.object({ currencies: z.array(z.object({ code: z.string().regex(/^[A-Z]{3}$/) })) }).parse(await json(`https://countries.dev/alpha/${countryCode}`, signal));
      const codes = data.currencies.map(currency => currency.code);
      if (codes.length !== 1) return unavailable('Waluty', 'NBP', 'Nie udało się jednoznacznie ustalić waluty kraju.');
      const result = checked(await tools.waluty.execute!({ waluta: codes[0], kwota: 1, kierunek: 'na_pln' }, options), z.object({ waluta: z.string(), kurs: z.number(), pobrano: z.string(), dataKursu: z.string().optional() }));
      return card('Waluty', codes[0] === 'PLN' ? 'Waluta krajowa' : 'NBP', `1 ${result.waluta} = ${result.kurs} PLN${result.dataKursu ? ` (kurs z ${result.dataKursu})` : ''}`, result.pobrano);
    } catch { return unavailable('Waluty', 'NBP', 'Nie udało się ustalić waluty lub pobrać kursu.'); }
  })();
  const weather = (async () => {
    try {
      const result = checked(await tools.pogoda.execute!({ miasto: sourceCity, data: date, kraj: countryCode }, options), z.object({ pobrano: z.string(), daily: z.object({ temperature_2m_min: z.array(z.number().nullable()), temperature_2m_max: z.array(z.number().nullable()), precipitation_sum: z.array(z.number().nullable()), precipitation_probability_max: z.array(z.number().nullable()) }) }));
      const min = result.daily.temperature_2m_min[0], max = result.daily.temperature_2m_max[0], rain = result.daily.precipitation_sum[0], probability = result.daily.precipitation_probability_max[0];
      if (min == null || max == null || rain == null) return { card: unavailable('Pogoda', 'Open-Meteo'), min: null, max: null, rain: null, probability: null };
      return { card: card('Pogoda', 'Open-Meteo', `Temperatura: ${min}–${max} °C. Opady: ${rain} mm${probability == null ? '' : `; prawdopodobieństwo: ${probability}%`}.`, result.pobrano), min, max, rain, probability };
    } catch { return { card: unavailable('Pogoda', 'Open-Meteo'), min: null, max: null, rain: null, probability: null }; }
  })();
  const holidays = (async () => {
    try {
      const schema = z.object({ pobrano: z.string(), swieta: z.array(z.object({ date: z.string(), localName: z.string(), name: z.string(), global: z.boolean(), types: z.array(z.string()) })) });
      const result = checked(await tools.swieta.execute!({ kraj: countryCode, rok: year }, options), schema);
      let upcoming = result.swieta.filter(item => item.date >= date && item.types.includes('Public')).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
      let fetchedAt = result.pobrano;
      if (upcoming.length < 3 && year < 2100) {
        try {
          const next = checked(await tools.swieta.execute!({ kraj: countryCode, rok: year + 1 }, options), schema);
          upcoming = [...upcoming, ...next.swieta.filter(item => item.date.startsWith(`${year + 1}-`) && item.types.includes('Public')).sort((a, b) => a.date.localeCompare(b.date))].slice(0, 3);
          fetchedAt = next.pobrano;
        } catch { /* Zachowaj dostępne święta z bieżącego roku. */ }
      }
      return card('Święta', 'Nager.Date', upcoming.length ? upcoming.map(item => `${item.date}: ${holidayName(item, countryCode)}${item.global ? '' : ' (regionalne)'}`).join(' · ') : `Brak kolejnych świąt publicznych w ${year} r. według źródła.`, fetchedAt);
    } catch { return unavailable('Święta', 'Nager.Date'); }
  })();
  const wiki = getWiki(sourceCity);
  const time = (async () => {
    try {
      const result = checked(await tools.czas.execute!({ strefa: location.timezone }, options), z.object({ pobrano: z.string(), czas: z.string() }));
      const difference = offsetMinutes(location.timezone, new Date(result.pobrano)) - offsetMinutes('Europe/Warsaw', new Date(result.pobrano));
      const label = difference === 0 ? 'Taki sam czas jak w Polsce' : `${difference > 0 ? '+' : '−'}${Math.floor(Math.abs(difference) / 60)} godz. ${Math.abs(difference) % 60} min względem Polski`;
      return card('Czas', 'Zegar serwera / IANA', `${result.czas} (${location.timezone}). ${label}.`, result.pobrano);
    } catch { return unavailable('Czas', 'Zegar serwera / IANA'); }
  })();
  const [weatherData, currencyCard, holidayCard, wikiCard, timeCard] = await Promise.all([weather, currency, holidays, wiki, time]);
  const packing = weatherData.min == null ? 'Brakuje prognozy, więc nie mogę dobrać ubrań do pogody.' : weatherData.min < 15 ? `Na ${date} zabierz cieplejszą warstwę: prognozowane minimum to ${weatherData.min} °C.` : `Na ${date} dobierz ubrania do prognozowanej temperatury ${weatherData.min}–${weatherData.max} °C.`;
  const caution = weatherData.rain == null ? 'Sprawdź prognozę przed wyjazdem.' : weatherData.probability != null && weatherData.probability > 50 ? `Zabierz parasol: prawdopodobieństwo deszczu wynosi ${weatherData.probability}%.` : weatherData.rain > 0 ? 'W prognozie są opady, więc rozważ ochronę przed deszczem.' : 'Według prognozy suma opadów wynosi 0 mm; sprawdź ją ponownie przed wyjazdem.';
  const cards = [weatherData.card, currencyCard, holidayCard, wikiCard, timeCard];
  const alternatePacking = weatherData.min == null ? 'Bez prognozy nie mogę polecić ubrań na tę pogodę.' : weatherData.min < 15 ? `Na ${date} weź cieplejszą warstwę, bo minimum ma wynieść ${weatherData.min} °C.` : `Na ${date} przygotuj ubrania na prognozowane ${weatherData.min}–${weatherData.max} °C.`;
  const alternateCaution = weatherData.rain == null ? 'Przed wyjazdem sprawdź aktualną prognozę pogody.' : weatherData.probability != null && weatherData.probability > 50 ? `Przy prawdopodobieństwie deszczu ${weatherData.probability}% spakuj parasol.` : weatherData.rain > 0 ? 'W prognozie są opady, więc rozważ ochronę przed deszczem.' : 'Prognoza wskazuje 0 mm opadów; przed wyjazdem sprawdź ją ponownie.';
  const unavailableCards = cards.filter(item => !item.ok);
  const missing = unavailableCards.length ? `Brak danych: ${unavailableCards.map(item => item.title).join(', ')}.` : null;
  return { city: sourceCity, country, date, cards, summary: [packing, caution, missing].filter(Boolean).join(' '), summaryOptions: { packing: [packing, alternatePacking], caution: [caution, alternateCaution], missing } };
}
