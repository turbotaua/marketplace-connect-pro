import { useState, useRef, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { ChatThread } from "@/components/dilovod/ChatThread";
import { ActionTags } from "@/components/dilovod/ActionTags";
import { FileUpload } from "@/components/dilovod/FileUpload";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Sparkles } from "lucide-react";
import { useChatSessions } from "@/hooks/useChatSessions";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: {
    type?: "text" | "draft" | "confirmation" | "disambiguation" | "error";
    draft?: any;
    fileUrl?: string;
    fileName?: string;
    actionType?: string;
    dilovodIds?: Record<string, string>;
    candidates?: any[];
  };
  created_at: string;
}

export type ActionType =
  | "sales.order"
  | "sales.commission"
  | "sales.report"
  | "sales.shipment"
  | "sales.return"
  | "purchase.order"
  | "purchase.receipt"
  | "production.order";

const actionLabels: Record<ActionType, string> = {
  "sales.order": "Замовлення покупцю",
  "sales.commission": "Передача комісіонеру",
  "sales.report": "Звіт комісіонера",
  "sales.shipment": "Відвантаження споживачу",
  "sales.return": "Повернення від покупця",
  "purchase.order": "Замовлення постачальнику",
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

  const hasMessages = messages.length > 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Доброго ранку";
    if (hour < 18) return "Доброго дня";
    return "Доброго вечора";
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text && !uploadedFile) return;

    setInput("");
    const file = uploadedFile;
    setUploadedFile(null);

    await saveMessage({
      role: "user",
      content: text || (file ? `📎 ${file.name}` : ""),
      metadata: file
        ? { fileName: file.name, actionType: selectedAction || undefined }
        : undefined,
    });

    // Simulated assistant response
    setTimeout(async () => {
      await saveMessage({
        role: "assistant",
        content: selectedAction
          ? `Обробляю документ як **${getActionLabel(selectedAction)}**... (підключення до backend буде у наступних фазах)`
          : "Оберіть тип операції або завантажте документ для початку роботи.",
      });
    }, 500);
  };

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
        content: "Файл отримано. Оберіть тип операції:",
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
                    disabled={isProcessing && !input.trim() && !uploadedFile}
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
              <ChatThread messages={messages} />
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
                    disabled={isProcessing && !input.trim() && !uploadedFile}
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
