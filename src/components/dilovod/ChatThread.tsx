import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/pages/Dilovod";
import { DraftCard } from "./DraftCard";
import { ConfirmationMessage } from "./ConfirmationMessage";
import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface ChatThreadProps {
  messages: ChatMessage[];
}

export const ChatThread = ({ messages }: ChatThreadProps) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="h-full overflow-y-auto py-4 space-y-4 px-1">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "flex gap-3 max-w-[85%]",
            msg.role === "user" ? "ml-auto flex-row-reverse" : ""
          )}
        >
          {/* Avatar */}
          <div
            className={cn(
              "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </div>

          {/* Content */}
          <div
            className={cn(
              "rounded-lg px-4 py-2.5 text-sm",
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground"
            )}
          >
            {msg.metadata?.type === "draft" && msg.metadata.draft ? (
              <DraftCard draft={msg.metadata.draft} />
            ) : msg.metadata?.type === "confirmation" && msg.metadata.dilovodIds ? (
              <ConfirmationMessage ids={msg.metadata.dilovodIds} actionType={msg.metadata.actionType} />
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:m-0">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
};
