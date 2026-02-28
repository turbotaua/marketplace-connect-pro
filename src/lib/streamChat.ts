import { supabase } from "@/integrations/supabase/client";

type Msg = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dilovod-chat`;

export async function streamChat({
  messages,
  actionType,
  onDelta,
  onDone,
  onError,
}: {
  messages: Msg[];
  actionType?: string | null;
  onDelta: (deltaText: string) => void;
  onDone: () => Promise<void> | void;
  onError: (error: string) => void;
}) {
  // Get user auth token if available
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const doFetch = async (attempt: number): Promise<Response> => {
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 45000); // 45s connect+response timeout

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages, actionType }),
        signal: controller.signal,
      });
      clearTimeout(fetchTimeout);
      return resp;
    } catch (e: any) {
      clearTimeout(fetchTimeout);
      if (e.name === "AbortError" && attempt === 0) {
        // Retry once on timeout
        console.warn("[streamChat] Retrying after timeout...");
        return doFetch(1);
      }
      throw e;
    }
  };

  let resp: Response;
  try {
    resp = await doFetch(0);
  } catch (e: any) {
    if (e.name === "AbortError") {
      onError("Час очікування відповіді вичерпано. Спробуйте ще раз.");
    } else {
      onError("Помилка з'єднання з AI");
    }
    return;
  }

  if (!resp.ok) {
    let errorMsg = "Помилка з'єднання з AI";
    try {
      const errData = await resp.json();
      errorMsg = errData.error || errorMsg;
    } catch { /* ignore */ }
    onError(errorMsg);
    return;
  }

  if (!resp.body) {
    onError("Порожня відповідь від AI");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  let streamDone = false;

  // First byte timeout: 20s
  let firstByteReceived = false;
  const firstByteTimeout = setTimeout(() => {
    if (!firstByteReceived) {
      reader.cancel();
      onError("AI не відповідає (timeout 20с)");
    }
  }, 20000);

  try {
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!firstByteReceived) {
        firstByteReceived = true;
        clearTimeout(firstByteTimeout);
      }

      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") {
          streamDone = true;
          break;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch {
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }

    // Final flush
    if (textBuffer.trim()) {
      for (let raw of textBuffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (raw.startsWith(":") || raw.trim() === "") continue;
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    clearTimeout(firstByteTimeout);
    if (e.name === "AbortError") {
      onError("Стрім перервано через timeout");
    } else {
      onError("Помилка читання відповіді AI");
    }
    return;
  }

  clearTimeout(firstByteTimeout);

  try {
    await onDone();
  } catch (e) {
    console.error("onDone error:", e);
  }
}
