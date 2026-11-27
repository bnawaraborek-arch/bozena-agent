"use client";
import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';

export type Conversation = { id: number; title: string | null; created_at: string };
export function useConversationHistory<T extends UIMessage>(key: string, setMessages: (messages: T[]) => void) {
  const id = useRef<number | null>(null);
  const pending = useRef<Promise<number> | null>(null);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listError, setListError] = useState('');
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  async function refreshList() {
    try {
      const response = await fetch('/api/conversations', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.conversations)) throw new Error();
      setConversations(data.conversations); setListError('');
    } catch { setListError('Nie udało się pobrać listy rozmów.'); }
  }
  useEffect(() => { void refreshList(); }, []);
  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const stored = window.localStorage.getItem(key);
        if (!stored) { if (active) setReady(true); return; }
        if (!/^[1-9]\d*$/.test(stored) || !Number.isSafeInteger(Number(stored))) throw new Error();
        const response = await fetch(`/api/conversations/${stored}`, { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data.messages) || data.id !== Number(stored)) throw new Error();
        if (active) { id.current = data.id; setActiveId(data.id); setMessages(data.messages); setReady(true); }
      } catch { if (active) setError('Nie udało się odczytać historii rozmowy. Odśwież stronę i spróbuj ponownie.'); }
    }
    void restore();
    return () => { active = false; };
  }, [key, setMessages]);

  async function getOrCreate(): Promise<number> {
    if (id.current) return id.current;
    if (pending.current) return pending.current;
    setCreating(true);
    pending.current = (async () => {
      try {
        const response = await fetch('/api/conversations', { method: 'POST' });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Number.isSafeInteger(data.id) || data.id <= 0) throw new Error();
        window.localStorage.setItem(key, String(data.id));
        id.current = data.id; setActiveId(data.id); setError(''); void refreshList(); return data.id;
      } catch {
        const message = 'Nie udało się utworzyć rozmowy. Spróbuj ponownie.';
        setError(message); throw new Error(message);
      }
    })();
    try { return await pending.current; }
    finally { pending.current = null; setCreating(false); }
  }
  function startNew() {
    try { window.localStorage.removeItem(key); id.current = null; setActiveId(null); setMessages([]); setError(''); setReady(true); }
    catch { setError('Nie udało się rozpocząć nowej rozmowy.'); }
  }
  async function selectConversation(selectedId: number) {
    setLoadingConversation(true);
    try {
      const response = await fetch(`/api/conversations/${selectedId}`, { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (data.id !== selectedId || !Array.isArray(data.messages)) throw new Error();
      window.localStorage.setItem(key, String(selectedId));
      id.current = selectedId; setActiveId(selectedId); setMessages(data.messages); setError(''); setReady(true);
      return true;
    } catch { setError('Nie udało się odczytać rozmowy. Spróbuj ponownie.'); return false; }
    finally { setLoadingConversation(false); }
  }
  return { ready, creating, error, getOrCreate, startNew, conversations, listError, refreshList, selectConversation, loadingConversation, activeId };
}
