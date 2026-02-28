import type { ActionType } from "@/pages/Dilovod";
import { cn } from "@/lib/utils";
import { ShoppingCart, Users, RotateCcw, Package, Wrench } from "lucide-react";

interface ActionTagsProps {
  selected: ActionType | null;
  onSelect: (action: ActionType) => void;
}

const salesActions: { type: ActionType; label: string; icon: typeof ShoppingCart }[] = [
  { type: "sales.commission", label: "Комісія", icon: Users },
  { type: "sales.end_consumer", label: "Кінцевий споживач", icon: ShoppingCart },
  { type: "sales.return", label: "Повернення", icon: RotateCcw },
];

const purchaseActions: { type: ActionType; label: string; icon: typeof Package }[] = [
  { type: "purchase.goods", label: "Товари", icon: Package },
  { type: "purchase.services", label: "Послуги", icon: Wrench },
];

export const ActionTags = ({ selected, onSelect }: ActionTagsProps) => {
  return (
    <div className="py-3 flex flex-wrap gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Продажі
        </span>
        <div className="flex gap-1.5">
          {salesActions.map((a) => (
            <button
              key={a.type}
              onClick={() => onSelect(a.type)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                selected === a.type
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <a.icon className="h-3 w-3" />
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Закупівлі
        </span>
        <div className="flex gap-1.5">
          {purchaseActions.map((a) => (
            <button
              key={a.type}
              onClick={() => onSelect(a.type)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                selected === a.type
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <a.icon className="h-3 w-3" />
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
