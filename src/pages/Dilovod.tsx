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
  } = useChatSessions();

  const [input, setInput] = useState("");
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && !uploadedFile) return;
    if (sendingRef.current) return;
    sendingRef.current = true;

    setInput("");
    const file = uploadedFile;
    setUploadedFile(null);
    setIsProcessing(true);

    const userContent = text || (file ? `📎 ${file.name}` : "");

    await saveMessage({
      role: "user",
      content: userContent,
      metadata: file
        ? { fileName: file.name, actionType: selectedAction || undefined }
        : selectedAction
        ? { actionType: selectedAction }
        : undefined,
    });

    const historyForAI = [
      ...messagesRef.current
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: userContent },
    ];

    let assistantSoFar = "";

    try {
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

          if (!assistantSoFar) {
            setIsProcessing(false);
            sendingRef.current = false;
            return;
          }

          // Check if AI response contains a draft JSON
          const parsedDraft = parseDraftFromText(assistantSoFar);

          if (parsedDraft) {
            // Show resolving indicator
            const resolvingId = `resolving-${Date.now()}`;
            setMessages((prev) => [
              ...prev,
              {
                id: resolvingId,
                role: "assistant" as const,
                content: assistantSoFar,
                metadata: { type: "resolving", resolvingStatus: "🔍 Пошук у каталозі Діловод..." },
                created_at: new Date().toISOString(),
              },
            ]);

            try {
              const resolvePromise = resolveDraft(parsedDraft);
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Resolution timeout")), 15000)
              );
              const { draft, disambiguations, isFullyResolved } = await Promise.race([resolvePromise, timeoutPromise]);

              // Remove resolving placeholder
              setMessages((prev) => prev.filter((m) => m.id !== resolvingId));

              await saveMessage({
                role: "assistant",
                content: assistantSoFar,
                metadata: {
                  type: isFullyResolved ? "draft" : "disambiguation",
                  draft,
                  disambiguations: isFullyResolved ? undefined : disambiguations,
                },
              });
            } catch (err) {
              console.error("Draft resolution failed:", err);
              setMessages((prev) => prev.filter((m) => m.id !== resolvingId));
              toast.error("Не вдалося знайти товари в каталозі. Відповідь збережено як текст.");
              await saveMessage({
                role: "assistant",
                content: assistantSoFar,
              });
            }
          } else {
            await saveMessage({
              role: "assistant",
              content: assistantSoFar,
            });
          }

          setIsProcessing(false);
          sendingRef.current = false;
        },
        onError: (error) => {
          toast.error(error);
          setIsProcessing(false);
          sendingRef.current = false;
        },
      });
    } catch (e) {
      console.error("Stream error:", e);
      toast.error("Помилка з'єднання з AI");
      setIsProcessing(false);
      sendingRef.current = false;
    }
  }, [input, uploadedFile, selectedAction, saveMessage, setMessages]);

  const handleFileSelect = async (file: File) => {
    setUploadedFile(file);
    await saveMessage({
      role: "user",
      content: `📎 Завантажено: ${file.name}`,
      metadata: { fileName: file.name },
    });
    if (!selectedAction) {
      await saveMessage({
        role: "assistant",
        content: "Файл отримано. Оберіть тип операції або опишіть що потрібно зробити:",
        metadata: { type: "text" },
      });
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
