import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Candidate {
  id: string;
  name: string;
  score?: number;
  code?: string;
}

interface DisambiguationCardProps {
  title: string;
  extractedName: string;
  candidates: Candidate[];
  onSelect: (id: string) => void;
  onRetrySearch?: () => void;
  timedOut?: boolean;
}

export const DisambiguationCard = ({
  title,
  extractedName,
  candidates,
  onSelect,
  onRetrySearch,
  timedOut,
}: DisambiguationCardProps) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // No candidates — timeout or empty result
  if (candidates.length === 0) {
    return (
      <Card className="w-full max-w-sm border-border/60 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{title}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {timedOut
              ? <>Пошук «<span className="font-medium text-foreground">{extractedName}</span>» не встиг завершитися</>
              : <>Не знайдено результатів для «<span className="font-medium text-foreground">{extractedName}</span>»</>
            }
          </p>
          {onRetrySearch && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetrySearch}
              className="w-full gap-2 text-xs"
            >
              <RefreshCw className="h-3 w-3" />
              Повторити пошук
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm border-border/60 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Знайдено «<span className="font-medium text-foreground">{extractedName}</span>» — оберіть:
        </p>

        <div className="space-y-1">
          {candidates.map((c) => {
            const scorePercent = c.score !== undefined ? Math.round(c.score * 100) : null;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                onMouseEnter={() => setHoveredId(c.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                  "border border-transparent",
                  hoveredId === c.id
                    ? "bg-accent/50 border-border"
                    : "hover:bg-accent/30"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex-shrink-0 w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                    {hoveredId === c.id && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground block truncate">
                      {c.name}
                    </span>
                    {c.code && (
                      <span className="text-[11px] text-muted-foreground">
                        {c.code}
                      </span>
                    )}
                  </div>
                </div>
                {scorePercent !== null && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-5 flex-shrink-0 font-normal"
                  >
                    {scorePercent}%
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
