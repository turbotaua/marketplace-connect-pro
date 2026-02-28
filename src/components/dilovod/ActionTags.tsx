import type { ActionType } from "@/pages/Dilovod";
import { cn } from "@/lib/utils";
import { ShoppingCart, Users, RotateCcw, Package, Wrench, Factory, ClipboardList } from "lucide-react";

interface ActionTagsProps {
  selected: ActionType | null;
  onSelect: (action: ActionType) => void;
  compact?: boolean;
}

const allActions: { type: ActionType; label: string; icon: typeof ShoppingCart; group: string }[] = [
  { type: "sales.commission", label: "Комісія", icon: Users, group: "Продажі" },
  { type: "sales.end_consumer", label: "Споживач", icon: ShoppingCart, group: "Продажі" },
  { type: "sales.return", label: "Повернення", icon: RotateCcw, group: "Продажі" },
  { type: "purchase.order", label: "Замовлення", icon: ClipboardList, group: "Закупівлі" },
  { type: "purchase.goods", label: "Товари", icon: Package, group: "Закупівлі" },
  { type: "purchase.services", label: "Послуги", icon: Wrench, group: "Закупівлі" },
  { type: "production.order", label: "Виробництво", icon: Factory, group: "Виробництво" },
];

export const ActionTags = ({ selected, onSelect, compact }: ActionTagsProps) => {
  return (
    <div className={cn("flex flex-wrap gap-2", compact ? "" : "justify-center")}>
      {allActions.map((a) => (
        <button
          key={a.type}
          onClick={() => onSelect(a.type)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border text-xs font-medium transition-all",
            compact ? "px-2.5 py-1" : "px-3.5 py-2",
            selected === a.type
              ? "bg-primary text-primary-foreground border-primary shadow-sm"
              : "bg-card text-foreground border-border hover:bg-accent hover:border-accent"
          )}
        >
          <a.icon className="h-3 w-3" />
          {a.label}
        </button>
      ))}
    </div>
  );
};
