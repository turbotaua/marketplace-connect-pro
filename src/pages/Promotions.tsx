import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CalendarIcon, Package } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const Promotions = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newPromo, setNewPromo] = useState({
    name: "",
    marketplace_id: "",
    discount_percent: "",
    starts_at: undefined as Date | undefined,
    ends_at: undefined as Date | undefined,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [itemsDialogPromoId, setItemsDialogPromoId] = useState<string | null>(null);
  const [newItemProductId, setNewItemProductId] = useState("");
  const [newItemVariantId, setNewItemVariantId] = useState("");

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

  const createPromo = useMutation({
    mutationFn: async () => {
      if (!newPromo.name || !newPromo.marketplace_id || !newPromo.discount_percent || !newPromo.starts_at || !newPromo.ends_at) {
        throw new Error("Заповніть всі поля");
      }
      const { error } = await supabase.from("promotions").insert({
        name: newPromo.name,
        marketplace_id: newPromo.marketplace_id,
        discount_percent: parseFloat(newPromo.discount_percent),
        starts_at: newPromo.starts_at.toISOString(),
        ends_at: newPromo.ends_at.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      setNewPromo({ name: "", marketplace_id: "", discount_percent: "", starts_at: undefined, ends_at: undefined });
      setDialogOpen(false);
      toast({ title: "Промо-акцію створено" });
    },
    onError: (e: Error) => toast({ title: "Помилка", description: e.message, variant: "destructive" }),
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

  const addItem = useMutation({
    mutationFn: async () => {
      if (!itemsDialogPromoId || !newItemProductId) throw new Error("Вкажіть Product ID");
      const { error } = await supabase.from("promotion_items").insert({
        promotion_id: itemsDialogPromoId,
        shopify_product_id: newItemProductId.trim(),
        shopify_variant_id: newItemVariantId.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      setNewItemProductId("");
      setNewItemVariantId("");
      toast({ title: "Товар додано" });
    },
    onError: (e: Error) => toast({ title: "Помилка", description: e.message, variant: "destructive" }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("promotion_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["promotions"] }),
  });

  const getMarketplaceName = (id: string) => marketplaces?.find((m) => m.id === id)?.name || id;

  const isActive = (promo: any) => {
    if (!promo.is_active) return false;
    const now = new Date();
    return new Date(promo.starts_at) <= now && new Date(promo.ends_at) >= now;
  };

  const selectedPromo = promotions?.find((p) => p.id === itemsDialogPromoId);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Промо-акції</h1>
            <p className="text-sm text-muted-foreground mt-1">Знижки для маркетплейсів, незалежні від Shopify</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Нова акція</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Створити промо-акцію</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder="Назва акції"
                  value={newPromo.name}
                  onChange={(e) => setNewPromo({ ...newPromo, name: e.target.value })}
                />
                <Select value={newPromo.marketplace_id} onValueChange={(v) => setNewPromo({ ...newPromo, marketplace_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Маркетплейс" /></SelectTrigger>
                  <SelectContent>
                    {marketplaces?.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="% знижки"
                  value={newPromo.discount_percent}
                  onChange={(e) => setNewPromo({ ...newPromo, discount_percent: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Початок</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !newPromo.starts_at && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {newPromo.starts_at ? format(newPromo.starts_at, "dd.MM.yyyy") : "Обрати"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={newPromo.starts_at} onSelect={(d) => setNewPromo({ ...newPromo, starts_at: d })} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Кінець</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !newPromo.ends_at && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {newPromo.ends_at ? format(newPromo.ends_at, "dd.MM.yyyy") : "Обрати"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={newPromo.ends_at} onSelect={(d) => setNewPromo({ ...newPromo, ends_at: d })} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <Button onClick={() => createPromo.mutate()} className="w-full" disabled={createPromo.isPending}>
                  Створити
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promotions?.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Немає акцій</TableCell></TableRow>
                )}
                {promotions?.map((promo) => {
                  const active = isActive(promo);
                  const now = new Date();
                  const upcoming = promo.is_active && new Date(promo.starts_at) > now;
                  const expired = new Date(promo.ends_at) < now;
                  return (
                    <TableRow key={promo.id} className={cn(!promo.is_active && "opacity-50")}>
                      <TableCell>
                        <Switch checked={promo.is_active} onCheckedChange={(v) => togglePromo.mutate({ id: promo.id, is_active: v })} />
                      </TableCell>
                      <TableCell className="font-medium">{promo.name}</TableCell>
                      <TableCell>{getMarketplaceName(promo.marketplace_id)}</TableCell>
                      <TableCell className="font-mono">-{Number(promo.discount_percent)}%</TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(promo.starts_at), "dd.MM")} — {format(new Date(promo.ends_at), "dd.MM.yy")}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setItemsDialogPromoId(promo.id)}>
                          <Package className="h-4 w-4 mr-1" />
                          {promo.promotion_items?.length || 0}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {active && <Badge className="bg-success text-success-foreground">Активна</Badge>}
                        {upcoming && <Badge variant="outline">Запланована</Badge>}
                        {expired && <Badge variant="secondary">Завершена</Badge>}
                        {!promo.is_active && <Badge variant="secondary">Вимкнена</Badge>}
                      </TableCell>
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

        {/* Items dialog */}
        <Dialog open={!!itemsDialogPromoId} onOpenChange={(open) => !open && setItemsDialogPromoId(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Товари в акції: {selectedPromo?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Shopify Product ID"
                  value={newItemProductId}
                  onChange={(e) => setNewItemProductId(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="Variant ID (опц.)"
                  value={newItemVariantId}
                  onChange={(e) => setNewItemVariantId(e.target.value)}
                  className="w-36"
                />
                <Button onClick={() => addItem.mutate()} disabled={addItem.isPending}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="max-h-64 overflow-auto space-y-1">
                {selectedPromo?.promotion_items?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Немає товарів</p>
                )}
                {selectedPromo?.promotion_items?.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="font-mono">{item.shopify_product_id}{item.shopify_variant_id ? ` / ${item.shopify_variant_id}` : ""}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteItem.mutate(item.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
};

export default Promotions;
