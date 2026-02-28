import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/pages/Dilovod";
import { DraftCard } from "./DraftCard";
import { ConfirmationMessage } from "./ConfirmationMessage";
import { cn } from "@/lib/utils";
import { Sparkles, User, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface ChatThreadProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
}

export const ChatThread = ({ messages, isStreaming }: ChatThreadProps) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="h-full overflow-y-auto py-6 space-y-6 px-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "flex gap-3 max-w-[90%]",
            msg.role === "user" ? "ml-auto flex-row-reverse" : ""
          )}
        >
          <div
            className={cn(
              "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5",
              "bg-primary/10 text-primary"
            )}
          >
            {msg.role === "user" ? (
              <User className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </div>

          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm leading-relaxed",
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-foreground"
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

      {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="flex gap-3 max-w-[90%]">
          <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="rounded-2xl px-4 py-3 text-sm bg-card border border-border text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
};
