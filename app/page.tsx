"use client";
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

const transport = new DefaultChatTransport({ api: '/api/chat' });

export default function Home() {
  const { messages, sendMessage, status, error, clearError } = useChat({ transport });
  const [input, setInput] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const busy = status === 'submitted' || status === 'streaming';
  return (
    <main>
      <h1>Mój chatbot</h1>
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
        if (!text || !accessCode || busy) return;
        clearError();
        setInput('');
        void sendMessage({ text }, { headers: { 'X-Chat-Access-Code': accessCode } });
      }}>
        <label htmlFor="access-code">Kod dostępu</label>
        <input id="access-code" name="access-code" type="password" autoComplete="off"
          required value={accessCode} onChange={event => setAccessCode(event.target.value)} disabled={busy} />
        <label htmlFor="message">Wiadomość</label>
        <div className="message-row">
          <input id="message" name="message" placeholder="Napisz wiadomość…" autoComplete="off"
            value={input} onChange={event => setInput(event.target.value)} disabled={busy} />
          <button type="submit" disabled={busy || !input.trim() || !accessCode}>Wyślij</button>
        </div>
      </form>
    </main>
  );
}
