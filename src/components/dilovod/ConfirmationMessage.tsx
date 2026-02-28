import { Check } from "lucide-react";

interface ConfirmationMessageProps {
  ids: Record<string, string>;
  actionType?: string;
}

const idLabels: Record<string, string> = {
  order_id: "Замовлення",
  invoice_id: "Рахунок",
  transfer_id: "Передача комісіонеру",
  shipment_id: "Відвантаження",
  return_id: "Повернення",
  receipt_id: "Надходження",
};

export const ConfirmationMessage = ({ ids, actionType }: ConfirmationMessageProps) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-green-600 font-semibold">
        <Check className="h-4 w-4" />
        Записано в Діловод
      </div>
      <div className="space-y-1">
        {Object.entries(ids).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{idLabels[key] || key}:</span>
            <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">{value}</code>
          </div>
        ))}
      </div>
    </div>
  );
};
