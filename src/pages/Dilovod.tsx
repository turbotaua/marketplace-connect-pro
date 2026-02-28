import { useState, useRef, useEffect, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";
import { ChatThread } from "@/components/dilovod/ChatThread";
import { ActionTags } from "@/components/dilovod/ActionTags";
import { FileUpload } from "@/components/dilovod/FileUpload";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Sparkles } from "lucide-react";
import { useChatSessions } from "@/hooks/useChatSessions";
import { streamChat } from "@/lib/streamChat";
import { parseDraftFromText, resolveDraft, type DraftData, type Disambiguation } from "@/lib/draftResolver";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: {
    type?: "text" | "draft" | "confirmation" | "disambiguation" | "resolving" | "error";
    draft?: any;
    fileUrl?: string;
    fileName?: string;
    actionType?: string;
    dilovodIds?: Record<string, string>;
    candidates?: any[];
    disambiguations?: Disambiguation[];
    resolvingStatus?: string;
  };
  created_at: string;
}

export type ActionType =
  | "sales.order"
  | "sales.commission"
  | "sales.report"
  | "sales.shipment"
  | "sales.return"
  | "purchase.receipt"
  | "production.order";

const actionLabels: Record<ActionType, string> = {
  "sales.order": "Замовлення покупцю",
  "sales.commission": "Комісія (повний ланцюжок)",
  "sales.report": "Звіт комісіонера",
  "sales.shipment": "Відвантаження споживачу",
  "sales.return": "Повернення від покупця",
  "purchase.receipt": "Надходження товарів/послуг",
  "production.order": "Замовлення на виробництво",
};

export function getActionLabel(action: ActionType): string {
  return actionLabels[action];
}

const Dilovod = () => {
  const {
    sessions,
    currentSessionId,
    messages,
    setMessages,
    loadingMessages,
    loadSession,
    startNewChat,
    saveMessage,
    ensureSessionId,
    refreshSessions,
  } = useChatSessions();

  const [input, setInput] = useState("");
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const lastSentRef = useRef<{ content: string; ts: number }>({ content: "", ts: 0 });

  const hasMessages = messages.length > 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Доброго ранку";
    if (hour < 18) return "Доброго дня";
    return "Доброго вечора";
  };

  const handleDisambiguationSelect = useCallback(
    (disambiguationMsgId: string, field: "counterparty" | "item", index: number | undefined, selectedId: string, selectedName: string) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== disambiguationMsgId) return msg;
          if (!msg.metadata?.draft) return msg;

          const draft = JSON.parse(JSON.stringify(msg.metadata.draft)) as DraftData;
          const disambiguations = (msg.metadata.disambiguations || []).filter((d) => {
            if (d.field !== field) return true;
            if (d.field === "item" && d.index !== index) return true;
            return false;
          });

          if (field === "counterparty") {
            draft.counterparty.dilovod_id = selectedId;
            draft.counterparty.dilovod_name = selectedName;
            draft.counterparty.flagged = false;
          } else if (field === "item" && index !== undefined) {
            draft.items[index].dilovod_id = selectedId;
            draft.items[index].dilovod_name = selectedName;
            draft.items[index].flagged = false;
          }

          return {
            ...msg,
            metadata: {
              ...msg.metadata,
              type: disambiguations.length === 0 ? "draft" as const : "disambiguation" as const,
              draft,
              disambiguations,
            },
          };
        })
      );
    },
    [setMessages]
  );

  // Handle draft approval — call createChain via proxy
  const handleDraftApprove = useCallback(async (draft: DraftData) => {
    const hasUnresolved = draft.counterparty.flagged || draft.items.some((i) => i.flagged);
    if (hasUnresolved) {
      toast.error("Спочатку оберіть контрагента та товари зі списку");
      return;
    }

    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dilovod-proxy`;
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "createChain",
          params: {
            actionType: draft.actionType,
            counterpartyId: draft.counterparty.dilovod_id,
            counterpartyName: draft.counterparty.dilovod_name || draft.counterparty.extracted_name,
            date: draft.date,
            items: draft.items.map((item) => ({
              itemId: item.dilovod_id,
              itemName: item.dilovod_name || item.extracted_name,
              qty: item.qty,
              price: item.price,
              total: item.total,
            })),
            totalSum: draft.total_sum,
          },
        }),
      });

      const result = await res.json();

      if (!res.ok || result.error) {
        toast.error(result.error || "Помилка створення документів");
        return;
      }

      // Show confirmation message
      const sessionId = await ensureSessionId();
      const dilovodIds = result.result?.chainIds || result.result || {};
      await saveMessage(
        {
          role: "assistant",
          content: "✅ Документи успішно створено в Діловод!",
          metadata: {
            type: "confirmation",
            dilovodIds,
            actionType: draft.actionType,
          },
        },
        sessionId
      );
      toast.success("Документи створено в Діловод!");
    } catch (e) {
      console.error("createChain error:", e);
      toast.error("Не вдалося створити документи");
    } finally {
      setIsProcessing(false);
    }
  }, [ensureSessionId, saveMessage]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && !uploadedFile) return;
    if (sendingRef.current) return;

    // Idempotency guard: prevent duplicate sends within 800ms
    const now = Date.now();
    if (text === lastSentRef.current.content && now - lastSentRef.current.ts < 800) {
      return;
    }
    lastSentRef.current = { content: text, ts: now };

    sendingRef.current = true;
    setInput("");
    const file = uploadedFile;
    setUploadedFile(null);
    setIsProcessing(true);

    const userContent = text || (file ? `📎 ${file.name}` : "");

    try {
      // Lock session id for this entire send flow
      const sessionId = await ensureSessionId();

      // Snapshot history BEFORE saving new message (prevents duplication)
      const historyForAI = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      // Add current user message
      historyForAI.push({ role: "user" as const, content: userContent });

      await saveMessage(
        {
          role: "user",
          content: userContent,
          metadata: file
            ? { fileName: file.name, actionType: selectedAction || undefined }
            : selectedAction
            ? { actionType: selectedAction }
            : undefined,
        },
        sessionId
      );

      let assistantSoFar = "";

      await streamChat({
        messages: historyForAI,
        actionType: selectedAction,
        onDelta: (chunk) => {
          assistantSoFar += chunk;
          const currentContent = assistantSoFar;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.id.startsWith("streaming-")) {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: currentContent } : m
              );
            }
            return [
              ...prev,
              {
                id: `streaming-${Date.now()}`,
                role: "assistant" as const,
                content: currentContent,
                created_at: new Date().toISOString(),
              },
            ];
          });
        },
        onDone: async () => {
          // Remove streaming placeholder
          setMessages((prev) =>
            prev.filter((m) => !m.id.startsWith("streaming-"))
          );

          if (!assistantSoFar) return;

          // Save assistant text immediately (unblock UI)
          const { msg: savedMsg } = await saveMessage(
            { role: "assistant", content: assistantSoFar },
            sessionId
          );

          // Refresh sessions list (to update sidebar title)
          refreshSessions();

          // Check for draft and resolve in background (non-blocking)
          const parsedDraft = parseDraftFromText(assistantSoFar);
          if (parsedDraft) {
            // Show resolving indicator by updating the saved message metadata
            setMessages((prev) =>
              prev.map((m) =>
                m.id === savedMsg.id
                  ? { ...m, metadata: { type: "resolving" as const, resolvingStatus: "🔍 Пошук у каталозі Діловод..." } }
                  : m
              )
            );

            // resolveDraft never throws — always returns partial results
            const { draft, disambiguations, isFullyResolved } = await resolveDraft(parsedDraft);

            // Always show the draft — flagged fields show "needs selection"
            setMessages((prev) =>
              prev.map((m) =>
                m.id === savedMsg.id
                  ? {
                      ...m,
                      metadata: {
                        type: isFullyResolved ? "draft" as const : "disambiguation" as const,
                        draft,
                        disambiguations: isFullyResolved ? undefined : disambiguations,
                      },
                    }
                  : m
              )
            );
          }
        },
        onError: (error) => {
          // Show error in chat, not just toast
          setMessages((prev) => [
            ...prev.filter((m) => !m.id.startsWith("streaming-")),
            {
              id: `error-${Date.now()}`,
              role: "assistant" as const,
              content: `⚠️ ${error}`,
              metadata: { type: "error" as const },
              created_at: new Date().toISOString(),
            },
          ]);
          toast.error(error);
        },
      });
    } catch (e) {
      console.error("Send error:", e);
      toast.error("Помилка з'єднання з AI");
    } finally {
      setIsProcessing(false);
      sendingRef.current = false;
    }
  }, [input, uploadedFile, selectedAction, messages, saveMessage, setMessages, ensureSessionId, refreshSessions]);

  const handleFileSelect = async (file: File) => {
    setUploadedFile(file);
    const sessionId = await ensureSessionId();
    await saveMessage(
      { role: "user", content: `📎 Завантажено: ${file.name}`, metadata: { fileName: file.name } },
      sessionId
    );
    if (!selectedAction) {
      await saveMessage(
        { role: "assistant", content: "Файл отримано. Оберіть тип операції або опишіть що потрібно зробити:", metadata: { type: "text" } },
        sessionId
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  return (
    <AdminLayout
      chatSessions={sessions}
      currentSessionId={currentSessionId}
      onSelectSession={loadSession}
      onNewChat={startNewChat}
    >
      <div className="flex flex-col h-[calc(100vh)] max-w-3xl mx-auto w-full">
        {loadingMessages ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Завантаження...</p>
          </div>
        ) : !hasMessages ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div className="flex flex-col items-center gap-2 mb-10">
              <div className="flex items-center gap-3">
                <Sparkles className="h-8 w-8 text-primary" />
                <h1 className="text-4xl md:text-5xl font-normal text-foreground"
                    style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}>
                  {getGreeting()}
                </h1>
              </div>
              <p className="text-muted-foreground text-sm">
                Dilovod AI — автоматизація документообігу
              </p>
            </div>

            <div className="w-full max-w-2xl">
              <div className="bg-card rounded-2xl border border-border shadow-sm p-4">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Опишіть задачу або завантажте документ..."
                  disabled={isProcessing}
                  className="border-0 shadow-none resize-none bg-transparent focus-visible:ring-0 text-base placeholder:text-muted-foreground/60 p-0 min-h-[44px]"
                  rows={1}
                />
                <div className="flex items-center justify-between mt-3">
                  <FileUpload onFileSelect={handleFileSelect} uploadedFile={uploadedFile} compact />
                  <Button
                    onClick={handleSend}
                    disabled={isProcessing || (!input.trim() && !uploadedFile)}
                    size="icon"
                    variant="ghost"
                    className="rounded-full h-9 w-9 text-muted-foreground hover:text-foreground"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-6">
                <ActionTags selected={selectedAction} onSelect={setSelectedAction} />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-2 bg-background/80 backdrop-blur-sm">
              <ActionTags selected={selectedAction} onSelect={setSelectedAction} compact />
            </div>

            <div className="flex-1 overflow-hidden">
              <ChatThread
                messages={messages}
                isStreaming={isProcessing}
                onDisambiguationSelect={handleDisambiguationSelect}
                onDraftApprove={handleDraftApprove}
              />
            </div>

            <div className="border-t border-border p-4">
              <div className="bg-card rounded-2xl border border-border shadow-sm p-4">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Введіть повідомлення..."
                  disabled={isProcessing}
                  className="border-0 shadow-none resize-none bg-transparent focus-visible:ring-0 text-base placeholder:text-muted-foreground/60 p-0 min-h-[44px]"
                  rows={1}
                />
                <div className="flex items-center justify-between mt-3">
                  <FileUpload onFileSelect={handleFileSelect} uploadedFile={uploadedFile} compact />
                  <Button
                    onClick={handleSend}
                    disabled={isProcessing || (!input.trim() && !uploadedFile)}
                    size="icon"
                    variant="ghost"
                    className="rounded-full h-9 w-9 text-muted-foreground hover:text-foreground"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
};

export default Dilovod;
