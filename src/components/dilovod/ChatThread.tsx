import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/pages/Dilovod";
import { DraftCard } from "./DraftCard";
import { ConfirmationMessage } from "./ConfirmationMessage";
import { DisambiguationCard } from "./DisambiguationCard";
import { cn } from "@/lib/utils";
import { Sparkles, User, Loader2, Search, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Disambiguation, DraftData } from "@/lib/draftResolver";

interface ChatThreadProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  onDisambiguationSelect?: (
    msgId: string,
    field: "counterparty" | "item",
    index: number | undefined,
    selectedId: string,
    selectedName: string
  ) => void;
  onDraftApprove?: (draft: DraftData) => void;
  onRetrySearch?: (msgId: string, field: "counterparty" | "item", extractedName: string) => void;
}

export function ChatThread({ messages, isStreaming, onDisambiguationSelect, onDraftApprove, onRetrySearch }: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const renderMessageContent = (msg: ChatMessage) => {
    if (msg.metadata?.type === "error") {
      return (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{msg.content}</span>
        </div>
      );
    }

    if (msg.metadata?.type === "resolving") {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4 animate-pulse" />
          <span>{msg.metadata.resolvingStatus || "Пошук у каталозі..."}</span>
        </div>
      );
    }

    if (msg.metadata?.type === "draft" && msg.metadata.draft) {
      return (
        <DraftCard
          draft={msg.metadata.draft}
          onApprove={onDraftApprove ? () => onDraftApprove(msg.metadata!.draft as DraftData) : undefined}
        />
      );
    }

    if (msg.metadata?.type === "disambiguation" && msg.metadata.draft) {
      const disambiguations: Disambiguation[] = msg.metadata.disambiguations || [];
      return (
        <div className="space-y-3">
          <DraftCard draft={msg.metadata.draft} />
          {disambiguations.map((d, i) => (
            <DisambiguationCard
              key={`${d.field}-${d.index ?? "cp"}-${i}`}
              title={d.field === "counterparty" ? "Контрагент" : `Товар: рядок ${(d.index ?? 0) + 1}`}
              extractedName={d.extractedName}
              candidates={d.candidates}
              timedOut={d.timedOut}
              onSelect={(id) => {
                const selected = d.candidates.find((c) => c.id === id);
                if (selected && onDisambiguationSelect) {
                  onDisambiguationSelect(msg.id, d.field, d.index, selected.id, selected.name);
                }
              }}
              onRetrySearch={
                d.candidates.length === 0 && onRetrySearch
                  ? () => onRetrySearch(msg.id, d.field, d.extractedName)
                  : undefined
              }
            />
          ))}
        </div>
      );
    }

    if (msg.metadata?.type === "confirmation" && msg.metadata.dilovodIds) {
      return <ConfirmationMessage ids={msg.metadata.dilovodIds} actionType={msg.metadata.actionType} />;
    }

    let displayContent = msg.content;
    if (msg.metadata?.draft) {
      displayContent = displayContent.replace(/```(?:json)?\s*\n?\{[\s\S]*?"type"\s*:\s*"draft"[\s\S]*?\}\s*```/g, "").trim();
    }

    return (
      <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:m-0">
        <ReactMarkdown>{displayContent}</ReactMarkdown>
      </div>
    );
  };

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
                : msg.metadata?.type === "error"
                ? "bg-destructive/10 border border-destructive/30 text-foreground"
                : "bg-card border border-border text-foreground"
            )}
          >
            {renderMessageContent(msg)}
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
}
