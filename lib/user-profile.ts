import 'server-only';
import { getSupabase } from './supabase';

type Profile = { name: string | null; preferences: Record<string, string> | null };
type Update = { name?: string; preferences?: Record<string, string> };

// Zachowawczo odrzucamy całą wypowiedź, jeśli może zawierać sekret lub dane wrażliwe.
const sensitive = /hasł|password|passphrase|sekret|secret|token|api[ _-]?key|klucz|credential|bearer|private[ _-]?key|pin\b|pesel|dowód|paszport|numer konta|iban|karta płatnicza|kart[ay] kredytow|cvv|cvc|\b\d{11,}\b|zdrow|chorob|diagnoz|lek[aiuó]|niepełnospraw|seksual|orientacj|relig|wyznani|politycz|pogląd|pochodzeni[ae]|ras[ay]|etniczn|biometr|genetycz|karalno|wyrok/i;
const uncertain = /(?:może|chyba|prawdopodobnie|podobno|gdybym|gdyby|planuj|zamierzam|chciałbym|chciałabym|żart|udaj|udawaj|wymyśl|hipotetycz)/i;

export function validateProfileUpdate(update: Update, source: string): boolean {
  const explicitStatement = /(?:^|[^\p{L}])(?:mieszkam|jestem|mam na imię|nazywam się|lubię|uwielbiam|preferuję|wolę|proszę|odpowiadaj|pisz)(?=$|[^\p{L}])/iu.test(source) || /^\s*moim\s+ulubionym\s+jedzeniem\s+(?:jest|są)(?=$|[^\p{L}])/iu.test(source);
  if (sensitive.test(source) || uncertain.test(source) || !explicitStatement) return false;
  const facts = Object.entries(update.preferences ?? {});
  if (!update.name && !facts.length) return false;
  const normalized = source.normalize('NFKC').toLocaleLowerCase('pl-PL');
  const values = [...(update.name ? [update.name] : []), ...facts.map(([, value]) => value)];
  return facts.length <= 10 && facts.every(([key]) => /^[\p{L}\p{N} _-]{1,60}$/u.test(key) && !sensitive.test(key)) && values.every(value => value.trim().length > 0 && value.length <= 200 && !sensitive.test(value) && normalized.includes(value.normalize('NFKC').toLocaleLowerCase('pl-PL')));
}

export async function loadUserProfile(): Promise<Profile> {
  const { data, error } = await getSupabase().from('user_profiles').select('name, preferences').eq('id', 1).maybeSingle();
  if (error) throw new Error('Nie udało się odczytać profilu.');
  if (!data) return { name: null, preferences: null };
  if (data.preferences !== null && (typeof data.preferences !== 'object' || Array.isArray(data.preferences))) throw new Error('Nieprawidłowy profil.');
  return data as Profile;
}

export async function saveUserProfile(update: Update, source: string): Promise<boolean> {
  if (!validateProfileUpdate(update, source)) return false;
  const db = getSupabase();
  // Porównanie poprzedniego stanu zapobiega utracie równoczesnych zmian.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: current, error } = await db.from('user_profiles').select('name, preferences').eq('id', 1).maybeSingle();
    if (error) throw new Error('Nie udało się odczytać profilu.');
    const next = { name: update.name ?? current?.name ?? null, preferences: { ...(current?.preferences ?? {}), ...update.preferences } };
    if (!current) {
      const result = await db.from('user_profiles').insert({ id: 1, ...next });
      if (!result.error) return true;
      if (result.error.code === '23505') continue;
      throw new Error('Nie udało się zapisać profilu.');
    }
    let query = db.from('user_profiles').update(next).eq('id', 1);
    query = current.name === null ? query.is('name', null) : query.eq('name', current.name);
    query = current.preferences === null ? query.is('preferences', null) : query.eq('preferences', JSON.stringify(current.preferences));
    const result = await query.select('id');
    if (result.error) throw new Error('Nie udało się zapisać profilu.');
    if (result.data?.length) return true;
  }
  throw new Error('Nie udało się zapisać profilu.');
}
