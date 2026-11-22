"use client";
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useState } from 'react';
import type { Analysis } from '../lib/analysis';

const transport = new DefaultChatTransport({ api: '/api/chat' });

function Chat({ onLogout }: { onLogout: () => void }) {
  const { messages, sendMessage, status, error, clearError, stop } = useChat({ transport });
  useEffect(() => () => { void stop(); }, [stop]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'chat' | 'analysis'>('chat');
  const [analysisInput, setAnalysisInput] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const busy = status === 'submitted' || status === 'streaming';
  return (
    <main>
      <h1>Mój chatbot</h1><button onClick={onLogout}>Wyjdź</button>
      <nav aria-label="Tryb pracy">
        <button type="button" aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}>Czat</button>{' '}
        <button type="button" aria-pressed={mode === 'analysis'} onClick={() => setMode('analysis')}>Analiza wiadomości</button>
      </nav>
      {mode === 'analysis' ? <>
        <form onSubmit={async event => {
          event.preventDefault();
          if (!analysisInput.trim() || analyzing) return;
          setAnalysis(null); setAnalysisError(''); setAnalyzing(true);
          try {
            const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: analysisInput }) });
            if (!response.ok) { setAnalysisError(await response.text()); return; }
            setAnalysis(await response.json());
          } catch { setAnalysisError('Nie udało się połączyć z serwerem. Spróbuj ponownie.'); }
          finally { setAnalyzing(false); }
        }}>
          <label htmlFor="analysis-message">Wiadomość klienta</label>
          <textarea id="analysis-message" value={analysisInput} onChange={event => setAnalysisInput(event.target.value)} maxLength={12000} rows={5} disabled={analyzing} required />
          <button disabled={analyzing || !analysisInput.trim()}>{analyzing ? 'Analizowanie…' : 'Analizuj'}</button>
        </form>
        {analysisError && <p className="error" role="alert">{analysisError}</p>}
        {analysis && <section aria-label="Wynik analizy" aria-live="polite">
          <h2>Wynik analizy — szkic</h2>
          <p>Kategoria: {analysis.category}</p>
          <p>Priorytet: {analysis.priority}</p>
          <p>Szkic: {analysis.draft}</p>
          <p>Wymaga sprawdzenia: {analysis.needs_review ? 'tak' : 'nie'}</p>
          <p>Każda odpowiedź jest szkicem.</p>
        </section>}
      </> : <>
      <section className="conversation" aria-label="Rozmowa" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && <p>Napisz wiadomość, aby rozpocząć rozmowę.</p>}
        {messages.map(message => (
          <article className={`message ${message.role}`} key={message.id}>
            <strong>{message.role === 'user' ? 'Ty' : 'Asystent'}</strong>
            {message.parts.map((part, index) => part.type === 'text' ? <p key={index}>{part.text}</p> : null)}
          </article>
        ))}
      </section>
      {busy && <p role="status">{status === 'submitted' ? 'Oczekiwanie na odpowiedź…' : 'Asystent odpowiada…'}</p>}
      {error && <p className="error" role="alert">{error.message || 'Nie udało się wysłać wiadomości. Sprawdź połączenie i spróbuj ponownie.'}</p>}
      <form onSubmit={event => {
        event.preventDefault();
        const text = input.trim();
        if (!text || busy) return;
        clearError();
        setInput('');
        void sendMessage({ text });
      }}>
        <label htmlFor="message">Wiadomość</label>
        <div className="message-row">
          <input id="message" name="message" placeholder="Napisz wiadomość…" autoComplete="off"
            value={input} onChange={event => setInput(event.target.value)} disabled={busy} />
          <button type="submit" disabled={busy || !input.trim()}>Wyślij</button>
        </div>
      </form>
      </>}
    </main>
  );
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/session', { cache: 'no-store' }).then(r => setAuthenticated(r.ok))
      .catch(() => setError('Nie udało się sprawdzić sesji.')).finally(() => setLoading(false));
  }, []);
  async function logout() {
    setError('');
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      setAuthenticated(false);
    } catch { setError('Nie udało się wyjść. Spróbuj ponownie.'); }
  }
  if (loading) return <main><p>Sprawdzanie sesji…</p></main>;
  if (authenticated) return <><Chat onLogout={() => void logout()} />{error && <p role="alert">{error}</p>}</>;
  return <main>
    <h1>Wpisz hasło</h1>
    <form onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setError('');
      try {
        const response = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
        });
        setPassword('');
        if (response.ok) setAuthenticated(true);
        else setError(await response.text());
      } catch { setError('Błąd połączenia. Spróbuj ponownie.'); }
      finally { setBusy(false); }
    }}>
      <label htmlFor="password">Hasło</label>
      <input id="password" type="password" autoComplete="current-password" required
        value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      <button disabled={busy} type="submit">Wejdź</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </main>;
}
