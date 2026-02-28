import type { ActionType } from "@/pages/Dilovod";
import { cn } from "@/lib/utils";
import {
  ShoppingCart, RotateCcw, Factory,
  ClipboardList, FileText, Truck, ArrowDownToLine
} from "lucide-react";

interface ActionTagsProps {
  selected: ActionType | null;
  onSelect: (action: ActionType) => void;
  compact?: boolean;
}

interface ActionDef {
  type: ActionType;
  label: string;
  desc: string;
  icon: typeof ShoppingCart;
}

const groups: { title: string; actions: ActionDef[] }[] = [
  {
    title: "Продажі",
    actions: [
      { type: "sales.order", label: "Замовлення покупцю", desc: "Створює: Замовлення + Рахунок", icon: ClipboardList },
      { type: "sales.commission", label: "Комісія (повний ланцюжок)", desc: "Замовлення → Рахунок → Передача → Видаткова", icon: Truck },
      { type: "sales.report", label: "Звіт комісіонера", desc: "На підставі передачі → Звіт про продажі", icon: FileText },
      { type: "sales.shipment", label: "Відвантаження споживачу", desc: "На підставі замовлення → Відвантаження", icon: ShoppingCart },
      { type: "sales.return", label: "Повернення від покупця", desc: "На підставі відвантаження", icon: RotateCcw },
    ],
  },
  {
    title: "Закупівлі",
    actions: [
      { type: "purchase.receipt", label: "Надходження товарів/послуг", desc: "Замовлення + Надходження (або тільки надходження)", icon: ArrowDownToLine },
    ],
  },
  {
    title: "Виробництво",
    actions: [
      { type: "production.order", label: "Замовлення на виробництво", desc: "Перевірка специфікації → Створення", icon: Factory },
    ],
  },
];

export function ActionTags({ selected, onSelect, compact }: ActionTagsProps) {
  if (compact) {
    const allActions = groups.flatMap((g) => g.actions);
    return (
      <div className="flex flex-wrap gap-1.5">
        {allActions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.type}
              onClick={() => onSelect(a.type)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border text-xs font-medium transition-all px-2.5 py-1",
                selected === a.type
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-foreground border-border hover:bg-accent hover:border-accent"
              )}
            >
              <Icon className="h-3 w-3" />
              {a.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground mb-2 px-1">
            {group.title}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {group.actions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.type}
                  onClick={() => onSelect(a.type)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                    selected === a.type
                      ? "bg-primary/10 border-primary/40 shadow-sm"
                      : "bg-card border-border hover:bg-accent/50 hover:border-accent"
                  )}
                >
                  <div className={cn(
                    "mt-0.5 rounded-lg p-1.5",
                    selected === a.type ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground leading-tight">{a.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{a.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
