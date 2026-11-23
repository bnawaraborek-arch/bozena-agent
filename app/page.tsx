"use client";
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useState } from 'react';
import type { Analysis } from '../lib/analysis';
import { AgentProgress } from './agent-progress';
import { MessageText } from './message-text';

type ChatMessage = UIMessage<{ visionModelId?: string | null }>;
const transport = new DefaultChatTransport<ChatMessage>({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ messages }) => ({
    body: { messages: messages.map(message => ({ ...message, parts: message.parts.filter(part => part.type === 'text' || (message.role === 'user' && part.type === 'file')) })) },
  }),
});

function Source({ url, title }: { url: string; title?: string }) {
  const [receivedAt] = useState(() => new Date());
  let safe = false;
  try { safe = ['http:', 'https:'].includes(new URL(url).protocol); } catch { /* Nieprawidłowy adres. */ }
  return <li>
    {safe ? <a href={url} target="_blank" rel="noopener noreferrer">{title?.trim() || 'Tytuł niedostępny'}</a> : 'Nieprawidłowy adres źródła'}
    {' — otrzymano: '}{receivedAt.toLocaleString('pl-PL')}
  </li>;
}

type AgentMessage = UIMessage<{ limitReached?: boolean; stepLimit?: number; steps?: number; toolCalls?: number; seconds?: number; timedOut?: boolean; toolLimitReached?: boolean }>;
const agentTransport = new DefaultChatTransport<AgentMessage>({
  api: '/api/agent',
  prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.map(message => ({ ...message, parts: message.parts.filter(part => part.type === 'text' || (message.role === 'user' && part.type === 'file')) })) } }),
});

const toolLabels: Record<string, string> = {
  web_search: 'Wyszukiwanie', generate_image: 'Generowanie obrazu', pogoda: 'Pogoda', waluty: 'Waluty',
  swieta: 'Święta', wikipedia: 'Wikipedia', kalkulator: 'Kalkulator', czas: 'Czas', notatki: 'Notatki', diagnostyka: 'Diagnostyka',
};

function Agent() {
  const { messages, sendMessage, status, error, stop } = useChat<AgentMessage>({ transport: agentTransport });
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [localError, setLocalError] = useState('');
  const busy = status === 'streaming' || status === 'submitted';
  useEffect(() => () => { void stop(); }, [stop]);
  return <>
    <section className="conversation" aria-label="Rozmowa z agentem" aria-live="polite">
      {messages.length === 0 && <p>Napisz zadanie dla agenta.</p>}
      {messages.map(message => <article className={`message ${message.role}`} key={message.id}>
        <strong>{message.role === 'user' ? 'Ty' : 'Agent'}</strong>
        {message.role === 'assistant' && <AgentProgress parts={message.parts} {...message.metadata} />}
        {message.parts.map((part, index) => {
          if (part.type === 'text') return message.role === 'assistant' ? <MessageText key={index} text={part.text} /> : <p key={index}>{part.text}</p>;
          if (part.type.startsWith('tool-')) {
            const name = part.type.slice(5);
            const label = toolLabels[name];
            if (label && (name !== 'generate_image' || ('state' in part && part.state !== 'output-available' && part.state !== 'output-error'))) return <span className="tool-badge" key={index}>Narzędzie: {label}</span>;
          }
          if (part.type === 'file' && part.mediaType.startsWith('image/')) return <img key={index} src={part.url} alt="Zdjęcie użytkownika" style={{ maxWidth: 240 }} />;
          if (part.type === 'source-url') return <ul key={index}><Source url={part.url} title={part.title} /></ul>;
          if (part.type === 'tool-generate_image' && part.state === 'output-available') {
            const output = part.output as { ok?: boolean; url?: string; modelId?: string | null; error?: string };
            if (!output?.ok || !output.url?.startsWith('data:image/')) return <div key={index}><span className="tool-badge">Narzędzie: Generowanie obrazu</span><p className="error">{output?.error || 'Nie udało się wygenerować obrazu.'}</p></div>;
            return <div key={index}><span className="tool-badge">Narzędzie: Generowanie obrazu</span><img src={output.url} alt="Wygenerowany obraz" style={{ maxWidth: '100%' }} /><p>{output.modelId ? `Model: ${output.modelId}` : 'Model: informacja niedostępna'}</p></div>;
          }
          if (part.type === 'tool-generate_image' && part.state === 'output-error') return <div key={index}><span className="tool-badge">Narzędzie: Generowanie obrazu</span><p className="error">Nie udało się wykonać narzędzia generowania obrazu.</p></div>;
          return null;
        })}
        {message.role === 'assistant' && message.metadata?.steps !== undefined && <p className="agent-metrics">Kroki modelu: {message.metadata.steps} · Wywołania narzędzi: {message.metadata.toolCalls ?? 0} · Czas: {(message.metadata.seconds ?? 0).toFixed(1)} s</p>}
      </article>)}
    </section>
    {busy && <p className="typing" role="status"><span aria-hidden="true">•••</span> Agent pisze…</p>}
    {(error || localError) && <p role="alert" className="error">{localError || error?.message || 'Błąd agenta.'}</p>}
    <form className="composer" onSubmit={async event => {
      event.preventDefault(); if (!text.trim() || busy) return;
      try {
        const files = photo ? [{ type: 'file' as const, mediaType: photo.type, filename: photo.name, url: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error()); reader.readAsDataURL(photo);
        }) }] : undefined;
        setLocalError(''); void sendMessage({ text: text.trim(), files }); setText(''); setPhoto(null);
      } catch { setLocalError('Nie udało się odczytać zdjęcia.'); }
    }}>
      <label htmlFor="agent-photo">Dodaj zdjęcie (opcjonalnie)</label>
      <input id="agent-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 4 * 1024 * 1024) { setPhoto(null); setLocalError('Wybierz JPG, PNG lub WebP do 4 MB.'); return; }
        setPhoto(file); setLocalError('');
      }} />
      {photo && <p>Wybrano: {photo.name} <button type="button" onClick={() => setPhoto(null)}>Usuń zdjęcie</button></p>}
      <label htmlFor="agent-message">Zadanie dla agenta</label>
      <div className="message-row"><input id="agent-message" value={text} onChange={event => setText(event.target.value)} disabled={busy} /><button disabled={busy || !text.trim()}>Wyślij</button></div>
    </form>
  </>;
}

function Chat({ onLogout }: { onLogout: () => void }) {
  const { messages, sendMessage, status, error, clearError, stop } = useChat<ChatMessage>({ transport });
  useEffect(() => () => { void stop(); }, [stop]);
  const [input, setInput] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Array<{ url: string; prompt: string; modelId: string | null }>>([]);
  const [mode, setMode] = useState<'chat' | 'analysis' | 'agent'>('chat');
  const [analysisInput, setAnalysisInput] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const busy = status === 'submitted' || status === 'streaming';
  return (
    <main className="studio">
      <header className="studio-header">
        <div><span className="eyebrow">Twoja przestrzeń do pracy z AI</span><h1>BONA<span>.AI</span></h1><p>Twój osobisty asystent AI.<br />Wyszukuje, analizuje i tworzy.</p></div>
        <div className="header-actions"><a className="nav-link" href="/dashboard">Dashboard podróży</a><button className="logout" onClick={onLogout}>Wyjdź</button></div>
      </header>
      <nav className="mode-nav" aria-label="Tryb pracy">
        <button type="button" aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}>Czat</button>{' '}
        <button type="button" aria-pressed={mode === 'analysis'} onClick={() => setMode('analysis')}>Analiza wiadomości</button>
        {' '}<button type="button" aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}>Agent</button>
      </nav>
      {mode === 'agent' ? <Agent /> : mode === 'analysis' ? <>
        <form className="analysis-form" onSubmit={async event => {
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
        {analysis && <section className="analysis-result" aria-label="Wynik analizy" aria-live="polite">
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
            {message.parts.map((part, index) => part.type === 'text' ? (message.role === 'assistant' ? <MessageText key={index} text={part.text} /> : <p key={index}>{part.text}</p>) : part.type === 'file' && part.mediaType.startsWith('image/') ? <img key={index} src={part.url} alt="Zdjęcie użytkownika" style={{ maxWidth: 240, maxHeight: 200 }} /> : null)}
            {message.role === 'assistant' && message.metadata?.visionModelId && <p>Model analizy zdjęcia: {message.metadata.visionModelId}</p>}
            {message.role === 'assistant' && (() => {
              const sources = message.parts.filter(part => part.type === 'source-url');
              return sources.length ? <><strong>Źródła:</strong><ul>{sources.map((source, index) =>
                <Source key={`${source.sourceId}-${index}`} url={source.url} title={source.title} />)}</ul></> :
                !(busy && message === messages[messages.length - 1]) && <p>Nie otrzymano źródeł. Aktualne informacje nie zostały potwierdzone źródłami.</p>;
            })()}
          </article>
        ))}
        {generated.map((item, index) => <article className="message assistant" key={index}><strong>Wygenerowany obraz</strong><p>{item.prompt}</p><img src={item.url} alt={item.prompt} style={{ maxWidth: '100%' }} /><p>{item.modelId ? `Model: ${item.modelId}` : 'Model: informacja niedostępna'}</p></article>)}
      </section>
      {busy && <p className="typing" role="status"><span aria-hidden="true">•••</span> Agent pisze…</p>}
      {error && <p className="error" role="alert">{error.message || 'Nie udało się wysłać wiadomości. Sprawdź połączenie i spróbuj ponownie.'}</p>}
      <form className="composer" onSubmit={async event => {
        event.preventDefault();
        const text = input.trim();
        if (!text || busy) return;
        clearError();
        setInput('');
        try {
          const files = photo ? [{ type: 'file' as const, mediaType: photo.type, filename: photo.name, url: await new Promise<string>((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error()); reader.readAsDataURL(photo);
          }) }] : undefined;
          setPhoto(null); setPhotoError('');
          void sendMessage({ text, files });
        } catch { setPhotoError('Nie udało się odczytać zdjęcia.'); }
      }}>
        <label htmlFor="message">Wiadomość</label>
        <label htmlFor="photo">Dodaj zdjęcie</label>
        <input id="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024 || !file.size) { setPhoto(null); setPhotoError('Wybierz JPG, PNG lub WebP o rozmiarze do 4 MB.'); return; }
          setPhoto(file); setPhotoError('');
        }} />
        {photo && <p>Wybrano: {photo.name} <button type="button" onClick={() => setPhoto(null)}>Usuń zdjęcie</button></p>}
        {photoError && <p className="error" role="alert">{photoError}</p>}
        <div className="message-row">
          <input id="message" name="message" placeholder="Napisz wiadomość…" autoComplete="off"
            value={input} onChange={event => setInput(event.target.value)} disabled={busy} />
          <button type="submit" disabled={busy || !input.trim()}>Wyślij</button>
          <button type="button" disabled={generating || busy || !input.trim()} onClick={async () => {
            const prompt = input.trim();
            if (prompt.length > 500) { setPhotoError('Opis obrazu może mieć maksymalnie 500 znaków.'); return; }
            setGenerating(true); setPhotoError('');
            try {
              const response = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
              if (!response.ok) { setPhotoError(await response.text()); return; }
              const result = await response.json();
              setGenerated(items => [...items, { prompt, url: result.url, modelId: result.modelId }]); setInput('');
            } catch { setPhotoError('Nie udało się połączyć z serwerem.'); }
            finally { setGenerating(false); }
          }}>{generating ? 'Generowanie…' : 'Wygeneruj obraz'}</button>
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
  return <main className="login-page"><div className="login-card">
    <span className="eyebrow">Twoja przestrzeń do pracy z AI</span>
    <h1>BONA<span>.AI</span></h1>
    <p>Twój osobisty asystent AI.<br />Wyszukuje, analizuje i tworzy.</p>
    <h2>Witaj w Studio</h2><p>Wpisz hasło, aby kontynuować.</p>
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
  </div></main>;
}
