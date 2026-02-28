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
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 30000); // 30s total timeout

  let resp: Response;
  try {
    resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ messages, actionType }),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(fetchTimeout);
    if (e.name === "AbortError") {
      onError("Час очікування відповіді вичерпано (30с)");
    } else {
      onError("Помилка з'єднання з AI");
    }
    return;
  }

  clearTimeout(fetchTimeout);

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

  // First byte timeout: 15s
  let firstByteReceived = false;
  const firstByteTimeout = setTimeout(() => {
    if (!firstByteReceived) {
      reader.cancel();
      onError("AI не відповідає (timeout 15с)");
    }
  }, 15000);

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

  // Await onDone to ensure cleanup runs after async work
  try {
    await onDone();
  } catch (e) {
    console.error("onDone error:", e);
  }
}
