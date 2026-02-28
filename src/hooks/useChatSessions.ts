import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/pages/Dilovod";

export interface ChatSession {
  id: string;
  created_at: string;
  last_active_at: string;
  title?: string; // derived from first user message
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

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

    // For each session, get the first user message as title
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

    setSessions(
      sessionsData.map((s) => ({
        ...s,
        title: titleMap.get(s.id) || "Нова розмова",
      }))
    );
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Load messages for a session
  const loadSession = useCallback(async (sessionId: string) => {
    setLoadingMessages(true);
    setCurrentSessionId(sessionId);

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

  // Create a new session
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
    setMessages([]);
    await fetchSessions();
    return data.id;
  }, [fetchSessions]);

  // Start new chat (reset state)
  const startNewChat = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
  }, []);

  // Save a message to the current session (creates session if needed)
  const saveMessage = useCallback(
    async (msg: Omit<ChatMessage, "id" | "created_at">) => {
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = await createSession();
      }

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

      // Refresh sessions list to update title/order
      if (msg.role === "user") {
        await fetchSessions();
      }

      return newMsg;
    },
    [currentSessionId, createSession, fetchSessions]
  );

  return {
    sessions,
    currentSessionId,
    messages,
    loadingMessages,
    loadSession,
    startNewChat,
    saveMessage,
    fetchSessions,
  };
}
