import type { ActionType } from "@/pages/Dilovod";
import { cn } from "@/lib/utils";
import { ShoppingCart, Users, RotateCcw, Package, Wrench, Factory } from "lucide-react";

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

const productionActions: { type: ActionType; label: string; icon: typeof Factory }[] = [
  { type: "production.order", label: "Виробництво", icon: Factory },
];

const TagButton = ({ type, label, icon: Icon, selected, onSelect }: {
  type: ActionType;
  label: string;
  icon: typeof ShoppingCart;
  selected: ActionType | null;
  onSelect: (action: ActionType) => void;
}) => (
  <button
    onClick={() => onSelect(type)}
    className={cn(
      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
      selected === type
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
    )}
  >
    <Icon className="h-3 w-3" />
    {label}
  </button>
);

export const ActionTags = ({ selected, onSelect }: ActionTagsProps) => {
  const groups = [
    { label: "Продажі", actions: salesActions },
    { label: "Закупівлі", actions: purchaseActions },
    { label: "Виробництво", actions: productionActions },
  ];

  return (
    <div className="py-3 flex flex-wrap gap-4">
      {groups.map((group) => (
        <div key={group.label} className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {group.label}
          </span>
          <div className="flex gap-1.5">
            {group.actions.map((a) => (
              <TagButton
                key={a.type}
                type={a.type}
                label={a.label}
                icon={a.icon}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
