import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, Edit2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DraftItem {
  extracted_name: string;
  dilovod_id?: string | null;
  qty: number;
  price: number;
  total: number;
  account?: string;
  flagged?: boolean;
}

interface DraftData {
  actionType: string;
  counterparty: { extracted_name: string; dilovod_id?: string | null; flagged?: boolean };
  date: string;
  items: DraftItem[];
  total_sum: number;
  flags?: string[];
  chain?: string[];
}

interface DraftCardProps {
  draft: DraftData;
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
}

const actionLabels: Record<string, string> = {
  "sales.order": "Замовлення покупцю",
  "sales.commission": "Комісія (повний ланцюжок)",
  "sales.report": "Звіт комісіонера",
  "sales.shipment": "Відвантаження споживачу",
  "sales.return": "Повернення від покупця",
  "purchase.receipt": "Надходження товарів/послуг",
  "production.order": "Замовлення на виробництво",
};

const chainLabels: Record<string, string[]> = {
  "sales.order": ["Замовлення", "Рахунок"],
  "sales.commission": ["Замовлення", "Рахунок", "Передача комісіонеру", "Видаткова накладна"],
  "sales.report": ["Звіт про продажі"],
  "sales.shipment": ["Замовлення", "Відвантаження"],
  "sales.return": ["Повернення від покупця"],
  "purchase.receipt": ["Замовлення (опціонально)", "Надходження"],
  "production.order": ["Замовлення на виробництво"],
};

export const DraftCard = ({ draft, onApprove, onReject, onEdit }: DraftCardProps) => {
  const hasFlags = draft.flags && draft.flags.length > 0;

  return (
    <Card className="w-full max-w-lg border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            📄 DRAFT — {actionLabels[draft.actionType] || draft.actionType}
          </CardTitle>
          {hasFlags && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-500">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Потребує уваги
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Counterparty */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Контрагент:</span>
          <span className="font-medium">{draft.counterparty.extracted_name}</span>
          {draft.counterparty.dilovod_id ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />
          )}
        </div>

        {/* Date */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Дата:</span>
          <span className="font-medium">{draft.date}</span>
        </div>

        {/* Items table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Найменування</TableHead>
              <TableHead className="text-xs text-right">К-сть</TableHead>
              <TableHead className="text-xs text-right">Ціна</TableHead>
              <TableHead className="text-xs text-right">Сума</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.items.map((item, i) => (
              <TableRow key={i} className={cn(item.flagged && "bg-yellow-50 dark:bg-yellow-950/20")}>
                <TableCell className="text-xs py-1.5">
                  {item.extracted_name}
                  {item.flagged && <AlertTriangle className="h-3 w-3 text-yellow-600 inline ml-1" />}
                </TableCell>
                <TableCell className="text-xs text-right py-1.5">{item.qty}</TableCell>
                <TableCell className="text-xs text-right py-1.5">{item.price.toFixed(2)}₴</TableCell>
                <TableCell className="text-xs text-right py-1.5">{item.total.toFixed(2)}₴</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Total */}
        <div className="flex items-center justify-between font-semibold border-t border-border pt-2">
          <span>Сума:</span>
          <span>{draft.total_sum.toFixed(2)} ₴</span>
        </div>

        {/* Chain preview */}
        {chainLabels[draft.actionType] && (
          <div className="text-xs text-muted-foreground">
            <span>Ланцюжок: </span>
            {chainLabels[draft.actionType].join(" → ")}
          </div>
        )}
      </CardContent>

      {(onApprove || onReject || onEdit) && (
        <CardFooter className="gap-2">
          {onApprove && (
            <Button size="sm" onClick={onApprove} className="gap-1">
              <Check className="h-3.5 w-3.5" /> Підтвердити
            </Button>
          )}
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit} className="gap-1">
              <Edit2 className="h-3.5 w-3.5" /> Редагувати
            </Button>
          )}
          {onReject && (
            <Button size="sm" variant="ghost" onClick={onReject} className="gap-1 text-destructive">
              <X className="h-3.5 w-3.5" /> Відхилити
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
};
