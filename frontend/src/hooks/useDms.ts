import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { cmpIdDesc } from '../lib/util';
import type { DmChannel, Friend, Message } from '../types';

const POLL_MS = 4000;

function mergeNewestFirst(list: Message[], incoming: Message[]): Message[] {
  if (!incoming.length) return list;
  const seen = new Set(list.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (!fresh.length) return list;
  return [...fresh, ...list].sort((a, b) => cmpIdDesc(a.id, b.id));
}

export interface DmsState {
  dms: DmChannel[];
  friends: Friend[];
  activeId: string | null;
  messages: Message[]; // newest-first
  loadingLists: boolean;
  loadingConvo: boolean;
  sending: boolean;
  error: string | null;
  replyTo: Message | null;
  setReplyTo: (m: Message | null) => void;
  refreshLists: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  openDmWithUser: (userId: string) => Promise<void>;
  send: (content: string, files?: File[]) => Promise<void>;
  loadOlder: () => Promise<number>;
}

export function useDms(): DmsState {
  const [dms, setDms] = useState<DmChannel[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingConvo, setLoadingConvo] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const refreshLists = useCallback(async () => {
    setLoadingLists(true);
    setError(null);
    try {
      const [d, f] = await Promise.all([api.getDms(), api.getFriends()]);
      setDms(d);
      setFriends(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setReplyTo(null);
    setMessages([]);
    setLoadingConvo(true);
    setError(null);
    try {
      const msgs = await api.getDmMessages(id);
      if (activeRef.current === id) setMessages(msgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingConvo(false);
    }
  }, []);

  const openDmWithUser = useCallback(
    async (userId: string) => {
      try {
        const channel = await api.openDm(userId);
        setDms((prev) => (prev.some((d) => d.id === channel.id) ? prev : [channel, ...prev]));
        await openConversation(channel.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [openConversation],
  );

  // Poll the open conversation for new messages.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const msgs = await api.getDmMessages(activeId);
        if (!cancelled && activeRef.current === activeId) {
          setMessages((prev) => mergeNewestFirst(prev, msgs));
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    const iv = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [activeId]);

  const send = useCallback(
    async (content: string, files?: File[]) => {
      const id = activeRef.current;
      const text = content.trim();
      if (!id || (!text && !(files && files.length))) return;
      setSending(true);
      setError(null);
      try {
        const created = await api.sendDm(id, text, replyTo?.id, files);
        setMessages((prev) => mergeNewestFirst(prev, [created]));
        setReplyTo(null);
        // bump conversation to the top of the list
        setDms((prev) => {
          const idx = prev.findIndex((d) => d.id === id);
          if (idx <= 0) return prev;
          const next = [...prev];
          const [c] = next.splice(idx, 1);
          return [c, ...next];
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
      }
    },
    [replyTo],
  );

  const loadOlder = useCallback(async () => {
    const id = activeRef.current;
    if (!id) return 0;
    const oldest = messages[messages.length - 1];
    try {
      const older = await api.getDmMessages(id, oldest?.id);
      setMessages((prev) => mergeNewestFirst(prev, older));
      return older.length;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return 0;
    }
  }, [messages]);

  return {
    dms,
    friends,
    activeId,
    messages,
    loadingLists,
    loadingConvo,
    sending,
    error,
    replyTo,
    setReplyTo,
    refreshLists,
    openConversation,
    openDmWithUser,
    send,
    loadOlder,
  };
}
