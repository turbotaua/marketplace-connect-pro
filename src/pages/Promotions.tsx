import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Package, Repeat } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import CreatePromoDialog from "@/components/promotions/CreatePromoDialog";
import ItemsDialog from "@/components/promotions/ItemsDialog";

const DAYS_SHORT = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const isPromoActive = (promo: any): "active" | "upcoming" | "expired" | "disabled" => {
  if (!promo.is_active) return "disabled";

  const now = new Date();

  if (promo.is_recurring) {
    // Check date range first
    if (new Date(promo.starts_at) > now) return "upcoming";
    if (promo.ends_at && new Date(promo.ends_at) < now) return "expired";

    // Check day of week for weekly
    if (promo.recurrence_pattern === "weekly" && promo.recurrence_day_of_week !== null) {
      if (now.getDay() !== promo.recurrence_day_of_week) return "upcoming";
    }

    // Check time window
    if (promo.start_time && promo.end_time) {
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (currentTime < promo.start_time || currentTime > promo.end_time) return "upcoming";
    }

    return "active";
  }

  // One-time promo
  if (new Date(promo.starts_at) > now) return "upcoming";
  if (promo.ends_at && new Date(promo.ends_at) < now) return "expired";
  return "active";
};

const formatPeriod = (promo: any): string => {
  if (promo.is_recurring) {
    const time = promo.start_time && promo.end_time ? `${promo.start_time}–${promo.end_time}` : "";
    if (promo.recurrence_pattern === "weekly" && promo.recurrence_day_of_week !== null) {
      return `Щотиж. ${DAYS_SHORT[promo.recurrence_day_of_week]} ${time}`;
    }
    return `Щоденно ${time}`;
  }
  const start = format(new Date(promo.starts_at), "dd.MM HH:mm");
  const end = promo.ends_at ? format(new Date(promo.ends_at), "dd.MM.yy HH:mm") : "∞";
  return `${start} — ${end}`;
};

const Promotions = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [itemsDialogPromoId, setItemsDialogPromoId] = useState<string | null>(null);

  const { data: marketplaces } = useQuery({
    queryKey: ["marketplace_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_config").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: promotions } = useQuery({
    queryKey: ["promotions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promotions")
        .select("*, promotion_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const togglePromo = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("promotions").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["promotions"] }),
  });

  const deletePromo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("promotions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      toast({ title: "Акцію видалено" });
    },
  });

  const getMarketplaceName = (id: string) => marketplaces?.find((m) => m.id === id)?.name || id;
  const selectedPromo = promotions?.find((p) => p.id === itemsDialogPromoId);

  const statusBadge = (status: string, isRecurring: boolean) => {
    return (
      <div className="flex items-center gap-1.5">
        {isRecurring && (
          <Badge variant="outline" className="gap-1">
            <Repeat className="h-3 w-3" />
          </Badge>
        )}
        {status === "active" && <Badge className="bg-success text-success-foreground">Активна</Badge>}
        {status === "upcoming" && <Badge variant="outline">Запланована</Badge>}
        {status === "expired" && <Badge variant="secondary">Завершена</Badge>}
        {status === "disabled" && <Badge variant="secondary">Вимкнена</Badge>}
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Промо-акції</h1>
            <p className="text-sm text-muted-foreground mt-1">Знижки для маркетплейсів, незалежні від Shopify</p>
          </div>
          <CreatePromoDialog open={dialogOpen} onOpenChange={setDialogOpen} marketplaces={marketplaces} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Активні та заплановані акції</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Вкл</TableHead>
                  <TableHead>Назва</TableHead>
                  <TableHead>Маркетплейс</TableHead>
                  <TableHead>Знижка</TableHead>
                  <TableHead>Період</TableHead>
                  <TableHead>Товарів</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!promotions || promotions.length === 0) && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Немає акцій</TableCell></TableRow>
                )}
                {promotions?.map((promo) => {
                  const status = isPromoActive(promo);
                  return (
                    <TableRow key={promo.id} className={cn(status === "disabled" && "opacity-50")}>
                      <TableCell>
                        <Switch checked={promo.is_active} onCheckedChange={(v) => togglePromo.mutate({ id: promo.id, is_active: v })} />
                      </TableCell>
                      <TableCell className="font-medium">{promo.name}</TableCell>
                      <TableCell>{getMarketplaceName(promo.marketplace_id)}</TableCell>
                      <TableCell className="font-mono">-{Number(promo.discount_percent)}%</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatPeriod(promo)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setItemsDialogPromoId(promo.id)}>
                          <Package className="h-4 w-4 mr-1" />
                          {promo.promotion_items?.length || 0}
                        </Button>
                      </TableCell>
                      <TableCell>{statusBadge(status, promo.is_recurring)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => deletePromo.mutate(promo.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <ItemsDialog promoId={itemsDialogPromoId} promo={selectedPromo} onClose={() => setItemsDialogPromoId(null)} />
      </div>
    </AdminLayout>
  );
};

export default Promotions;
