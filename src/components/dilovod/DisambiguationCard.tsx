import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpCircle, Plus } from "lucide-react";

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
  onCreateNew?: () => void;
}

export const DisambiguationCard = ({
  title,
  extractedName,
  candidates,
  onSelect,
  onCreateNew,
}: DisambiguationCardProps) => {
  return (
    <Card className="w-full max-w-sm border-yellow-500/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-yellow-600" />
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Знайдено «{extractedName}». Оберіть відповідник:
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {candidates.map((c) => (
          <Button
            key={c.id}
            variant="outline"
            size="sm"
            className="w-full justify-start text-left h-auto py-2"
            onClick={() => onSelect(c.id)}
          >
            <div className="flex flex-col items-start">
              <span className="text-xs font-medium">{c.name}</span>
              {c.code && (
                <span className="text-[10px] text-muted-foreground">
                  Код: {c.code}
                  {c.score !== undefined && ` • Збіг: ${(c.score * 100).toFixed(0)}%`}
                </span>
              )}
            </div>
          </Button>
        ))}
        {onCreateNew && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={onCreateNew}
          >
            <Plus className="h-3 w-3" /> Створити нового
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
