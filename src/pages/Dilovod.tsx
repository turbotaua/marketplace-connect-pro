import { useState, useRef, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { ChatThread } from "@/components/dilovod/ChatThread";
import { ActionTags } from "@/components/dilovod/ActionTags";
import { FileUpload } from "@/components/dilovod/FileUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send } from "lucide-react";

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
  | "purchase.services";

const Dilovod = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Вітаю! Я AI-асистент для роботи з Діловодом. Завантажте документ і оберіть тип операції, щоб розпочати.",
      created_at: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addMessage = (msg: Omit<ChatMessage, "id" | "created_at">) => {
    setMessages((prev) => [
      ...prev,
      {
        ...msg,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      },
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

    // TODO: connect to dilovod-chat edge function
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

  return (
    <AdminLayout>
      <div className="flex flex-col h-[calc(100vh-3rem)] max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <h1 className="text-xl font-bold text-foreground">Діловод AI</h1>
            <p className="text-sm text-muted-foreground">
              AI-асистент для створення документів
            </p>
          </div>
        </div>

        {/* Action Tags */}
        <ActionTags
          selected={selectedAction}
          onSelect={setSelectedAction}
        />

        {/* Chat Thread */}
        <div className="flex-1 overflow-hidden">
          <ChatThread messages={messages} />
        </div>

        {/* Input Area */}
        <div className="border-t border-border pt-3 space-y-2">
          <FileUpload onFileSelect={handleFileSelect} uploadedFile={uploadedFile} />
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Введіть повідомлення або завантажте документ..."
              disabled={isProcessing}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={isProcessing && !input.trim() && !uploadedFile}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
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
  };
  return labels[action];
}

export default Dilovod;
