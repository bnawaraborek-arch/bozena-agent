'use client';
import { useCallback, useEffect, useState } from 'react';

type Document = { id: string | number; title: string; created_at: string; count: number };
export function UploadForm() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [listError, setListError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/documents', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.documents)) throw new Error();
      setDocuments(data.documents); setListError('');
    } catch { setListError('Nie udało się pobrać listy dokumentów. Odśwież stronę.'); setDocuments(null); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <>
    <form className="analysis-form" noValidate onSubmit={async event => {
      event.preventDefault(); if (busy) return; setError(''); setSuccess('');
      if (!title.trim() || !content.trim()) { setError('Podaj tytuł i treść dokumentu.'); return; }
      if (content.length > 20000) { setError('Treść może zawierać maksymalnie 20 000 znaków.'); return; }
      if (!documents) { setError('Poczekaj na listę dokumentów lub odśwież stronę.'); return; }
      const old = documents.filter(item => item.title === title.trim());
      if (old.length && !window.confirm(`Dokument „${title.trim()}” już istnieje. Zastąpić poprzednią wersję?`)) return;
      setBusy(true); setStage('Dzielę tekst…');
      try {
        const response = await fetch('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, replaceIds: old.map(item => item.id) }) });
        if (!response.ok) { setError(await response.text()); await refresh(); return; }
        if (!response.body) throw new Error();
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', completed = false;
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line) continue;
            const data = JSON.parse(line);
            if (data.stage) setStage(data.stage);
            if (data.error) { setError(data.error); completed = true; }
            if (typeof data.title === 'string' && typeof data.count === 'number') { setSuccess(`Zapisano dokument „${data.title}”: ${data.count} fragmentów`); setTitle(''); setContent(''); completed = true; }
          }
          if (done) break;
        }
        if (!completed) throw new Error();
        await refresh();
      } catch { setError('Połączenie zostało przerwane podczas importu. Sprawdź listę dokumentów przed ponowieniem.'); await refresh(); }
      finally { setBusy(false); setStage(''); }
    }}>
      <label htmlFor="document-title">Tytuł</label>
      <input id="document-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={500} disabled={busy} />
      <label htmlFor="document-content">Treść</label>
      <textarea id="document-content" value={content} onChange={event => setContent(event.target.value)} maxLength={20000} rows={16} disabled={busy} />
      <button type="submit" disabled={busy || !documents}>Dodaj do bazy wiedzy</button>
      {stage && <p role="status">{stage}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {success && <p role="status">{success}</p>}
    </form>
    <section className="analysis-result" aria-label="Dokumenty w bazie wiedzy">
      <h2>Dokumenty w bazie wiedzy</h2>
      {listError ? <p role="alert">{listError} <button type="button" onClick={() => void refresh()}>Spróbuj ponownie</button></p> : !documents ? <p role="status">Wczytywanie dokumentów…</p> : !documents.length ? <p>Brak dokumentów.</p> : <ul>
        {documents.map(item => <li key={item.id}><strong>{item.title}</strong>{' — '}{Number.isNaN(Date.parse(item.created_at)) ? 'Data niedostępna' : new Date(item.created_at).toLocaleString('pl-PL')}{' — '}{item.count} fragmentów{' '}
          <button type="button" disabled={busy} onClick={async () => {
            if (!window.confirm(`Usunąć dokument „${item.title}” wraz z fragmentami?`)) return;
            setBusy(true); setError(''); setSuccess('');
            try { const response = await fetch('/api/documents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) }); if (!response.ok) setError(await response.text()); await refresh(); }
            catch { setError('Nie udało się połączyć z serwerem. Odśwież listę przed ponowieniem.'); await refresh(); }
            finally { setBusy(false); }
          }}>Usuń</button></li>)}
      </ul>}
    </section>
  </>;
}
