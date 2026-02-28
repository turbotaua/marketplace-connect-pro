import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/pages/Dilovod";

export interface ChatSession {
  id: string;
  created_at: string;
  last_active_at: string;
  title?: string;
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  // Keep ref in sync
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Fetch all sessions
  const fetchSessions = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: sessionsData } = await supabase
      .from("dilovod_sessions")
      .select("*")
      .eq("user_id", user.id)
      .order("last_active_at", { ascending: false })
      .limit(50);

    if (!sessionsData) return;

    // Get first user message per session as title
    const sessionIds = sessionsData.map((s) => s.id);
    const { data: firstMessages } = await supabase
      .from("dilovod_messages")
      .select("session_id, content")
      .in("session_id", sessionIds)
      .eq("role", "user")
      .order("created_at", { ascending: true });

    const titleMap = new Map<string, string>();
    firstMessages?.forEach((m) => {
      if (!titleMap.has(m.session_id)) {
        titleMap.set(m.session_id, m.content.slice(0, 60));
      }
    });

    // Filter out sessions without user messages
    const validSessions = sessionsData
      .filter((s) => titleMap.has(s.id))
      .map((s) => ({
        ...s,
        title: titleMap.get(s.id) || "Нова розмова",
      }));

    setSessions(validSessions);
    return validSessions;
  }, []);

  // Auto-load last active session on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loadedSessions = await fetchSessions();
      if (cancelled || !loadedSessions || loadedSessions.length === 0) return;
      // Auto-load the most recent session
      const latest = loadedSessions[0];
      if (latest && !sessionIdRef.current) {
        await loadSessionById(latest.id);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load messages for a session
  const loadSessionById = useCallback(async (sessionId: string) => {
    setLoadingMessages(true);
    setCurrentSessionId(sessionId);
    sessionIdRef.current = sessionId;

    const { data } = await supabase
      .from("dilovod_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    setMessages(
      (data || []).map((m) => ({
        id: m.id,
        role: m.role as ChatMessage["role"],
        content: m.content,
        metadata: m.metadata as ChatMessage["metadata"],
        created_at: m.created_at,
      }))
    );
    setLoadingMessages(false);
  }, []);

  // Create a new session (returns id, does NOT refresh sessions list)
  const createSession = useCallback(async (): Promise<string> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data, error } = await supabase
      .from("dilovod_sessions")
      .insert({ user_id: user.id })
      .select("id")
      .single();

    if (error) throw error;

    setCurrentSessionId(data.id);
    sessionIdRef.current = data.id;
    setMessages([]);
    return data.id;
  }, []);

  // Ensure we have a session id (create if needed)
  const ensureSessionId = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    return createSession();
  }, [createSession]);

  // Start new chat (reset state)
  const startNewChat = useCallback(() => {
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setMessages([]);
  }, []);

  // Save a message, using sessionIdOverride if provided
  const saveMessage = useCallback(
    async (msg: Omit<ChatMessage, "id" | "created_at">, sessionIdOverride?: string) => {
      const sessionId = sessionIdOverride || await ensureSessionId();

      const newMsg: ChatMessage = {
        ...msg,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);

      // Persist to DB
      await supabase.from("dilovod_messages").insert({
        session_id: sessionId,
        role: msg.role,
        content: msg.content,
        metadata: (msg.metadata as any) || {},
      });

      // Update last_active_at
      await supabase
        .from("dilovod_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", sessionId);

      return { msg: newMsg, sessionId };
    },
    [ensureSessionId]
  );

  // Lightweight refresh of sessions list (call after send flow completes)
  const refreshSessions = useCallback(async () => {
    await fetchSessions();
  }, [fetchSessions]);

  return {
    sessions,
    currentSessionId,
    messages,
    setMessages,
    loadingMessages,
    loadSession: loadSessionById,
    startNewChat,
    saveMessage,
    ensureSessionId,
    refreshSessions,
  };
}
