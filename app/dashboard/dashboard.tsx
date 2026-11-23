"use client";
import { useState } from 'react';
import type { DashboardCard, DashboardData } from '../../lib/dashboard';

export function DashboardCards({ cards }: { cards: DashboardCard[] }) {
  return <div className="travel-grid">{cards.map(item => <article className="travel-card" key={item.title}><div className="travel-card-top"><h3>{item.title}</h3><span className="travel-status">{item.ok ? 'OK' : 'Brak danych'}</span></div><p>{item.value}</p>{item.link && <a href={item.link} target="_blank" rel="noopener noreferrer">Otwórz artykuł ↗</a>}<div className="travel-source">Źródło: {item.source}<br />{item.ok ? 'Pobrano' : 'Sprawdzono'}: {new Date(item.fetchedAt).toLocaleString('pl-PL')}</div></article>)}</div>;
}

export function Dashboard() {
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [query, setQuery] = useState<{ city: string; date: string } | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function load(next: { city: string; date: string }) {
    setLoading(true); setError(''); setData(null); setQuery(next);
    try {
      const response = await fetch('/api/dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next), cache: 'no-store' });
      if (!response.ok) { setError(await response.text()); return; }
      setData(await response.json());
    } catch { setError('Nie udało się połączyć z serwerem.'); }
    finally { setLoading(false); }
  }
  return <main className="studio dashboard">
    <header className="studio-header"><div><span className="eyebrow">Twój asystent podróży</span><h1>BONA<span>.AI</span></h1><p>Informacje o podróży w jednym miejscu.</p></div><a className="nav-link" href="/">← Wróć do czatu</a></header>
    <section className="dashboard-intro"><h2>Zaplanuj podróż</h2><p>Sprawdź najważniejsze informacje przed wyjazdem.</p>
      <form className="travel-form" onSubmit={event => { event.preventDefault(); if (!loading) void load({ city: city.trim(), date }); }}>
        <div><label htmlFor="travel-city">Dokąd jedziesz?</label><input id="travel-city" value={city} onChange={event => setCity(event.target.value)} placeholder="np. Lizbona" minLength={2} maxLength={100} required /></div>
        <div><label htmlFor="travel-date">Kiedy?</label><input id="travel-date" type="date" value={date} onChange={event => setDate(event.target.value)} required /></div>
        <button disabled={loading || city.trim().length < 2 || !date}>{loading ? 'Sprawdzanie…' : 'Sprawdź'}</button>
      </form>
    </section>
    {loading && <p className="typing" role="status">Pobieram informacje o podróży…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {data && <><div className="dashboard-results"><div><span className="eyebrow">Twój cel podróży</span><h2>{data.city}, {data.country}</h2><p>Data podróży: {data.date}</p></div><button type="button" className="logout" disabled={loading || !query} onClick={() => query && void load(query)}>Odśwież</button></div>
      <DashboardCards cards={data.cards} />
      <section className="travel-summary"><span className="eyebrow">BONA.AI · wskazówki</span><h2>Przed podróżą</h2><p>{data.summary}</p></section>
    </>}
  </main>;
}
