import { useState, useRef, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { ChatThread } from "@/components/dilovod/ChatThread";
import { ActionTags } from "@/components/dilovod/ActionTags";
import { FileUpload } from "@/components/dilovod/FileUpload";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Plus, Sparkles } from "lucide-react";

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
  | "sales.commission"
  | "sales.end_consumer"
  | "sales.return"
  | "purchase.goods"
  | "purchase.services"
  | "purchase.order"
  | "production.order";

const Dilovod = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  const addMessage = (msg: Omit<ChatMessage, "id" | "created_at">) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: crypto.randomUUID(), created_at: new Date().toISOString() },
    ]);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text && !uploadedFile) return;

    addMessage({
      role: "user",
      content: text || (uploadedFile ? `📎 ${uploadedFile.name}` : ""),
      metadata: uploadedFile
        ? { fileName: uploadedFile.name, actionType: selectedAction || undefined }
        : undefined,
    });

    setInput("");
    setUploadedFile(null);

    setTimeout(() => {
      addMessage({
        role: "assistant",
        content: selectedAction
          ? `Обробляю документ як **${getActionLabel(selectedAction)}**... (підключення до backend буде у наступних фазах)`
          : "Оберіть тип операції або завантажте документ для початку роботи.",
      });
    }, 500);
  };

  const handleFileSelect = (file: File) => {
    setUploadedFile(file);
    addMessage({
      role: "user",
      content: `📎 Завантажено: ${file.name}`,
      metadata: { fileName: file.name },
    });
    if (!selectedAction) {
      addMessage({
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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  return (
    <AdminLayout>
      <div className="flex flex-col h-[calc(100vh)] max-w-3xl mx-auto w-full">
        {!hasMessages ? (
          /* Empty state — Claude-like greeting */
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div className="flex items-center gap-3 mb-10">
              <Sparkles className="h-8 w-8 text-primary" />
              <h1 className="text-4xl md:text-5xl font-normal text-foreground"
                  style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}>
                {getGreeting()}, Turbota
              </h1>
            </div>

            {/* Input box */}
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

              {/* Action Tags below input */}
              <div className="mt-4 flex justify-center">
                <ActionTags selected={selectedAction} onSelect={setSelectedAction} />
              </div>
            </div>
          </div>
        ) : (
          /* Chat mode */
          <>
            {/* Action Tags — sticky top */}
            <div className="border-b border-border px-4 py-2 bg-background/80 backdrop-blur-sm">
              <ActionTags selected={selectedAction} onSelect={setSelectedAction} compact />
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-hidden">
              <ChatThread messages={messages} />
            </div>

            {/* Input Area */}
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

function getActionLabel(action: ActionType): string {
  const labels: Record<ActionType, string> = {
    "sales.commission": "Комісія (магазини)",
    "sales.end_consumer": "Кінцевий споживач",
    "sales.return": "Повернення",
    "purchase.goods": "Надходження товарів",
    "purchase.services": "Надходження послуг",
    "purchase.order": "Замовлення постачальнику",
    "production.order": "Замовлення на виробництво",
  };
  return labels[action];
}

export default Dilovod;
