import { useState, useMemo } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CalendarIcon, Package, Search, Check, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// --- Promo creation dialog ---

interface CreatePromoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  marketplaces: any[] | undefined;
}

const CreatePromoDialog = ({ open, onOpenChange, marketplaces }: CreatePromoDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newPromo, setNewPromo] = useState({
    name: "",
    marketplace_id: "",
    discount_percent: "",
    starts_at: undefined as Date | undefined,
    ends_at: undefined as Date | undefined,
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
      onOpenChange(false);
      toast({ title: "Промо-акцію створено" });
    },
    onError: (e: Error) => toast({ title: "Помилка", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />Нова акція</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Створити промо-акцію</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input placeholder="Назва акції" value={newPromo.name} onChange={(e) => setNewPromo({ ...newPromo, name: e.target.value })} />
          <Select value={newPromo.marketplace_id} onValueChange={(v) => setNewPromo({ ...newPromo, marketplace_id: v })}>
            <SelectTrigger><SelectValue placeholder="Маркетплейс" /></SelectTrigger>
            <SelectContent>
              {marketplaces?.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="number" placeholder="% знижки" value={newPromo.discount_percent} onChange={(e) => setNewPromo({ ...newPromo, discount_percent: e.target.value })} />
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
          <Button onClick={() => createPromo.mutate()} className="w-full" disabled={createPromo.isPending}>Створити</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// --- Items dialog with search ---

interface ItemsDialogProps {
  promoId: string | null;
  promo: any;
  onClose: () => void;
}

const ItemsDialog = ({ promoId, promo, onClose }: ItemsDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Load all Shopify products once when dialog opens
  const { data: shopifyProducts, isLoading: loadingProducts, error: productsError } = useQuery({
    queryKey: ["shopify-products-all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("shopify-products");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data?.products || [];
    },
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    enabled: !!promoId,
  });

  const filtered = useMemo(() => {
    if (!shopifyProducts || !search.trim()) return [];
    const q = search.toLowerCase();
    return shopifyProducts.filter((p: any) =>
      p.title?.toLowerCase().includes(q) ||
      p.variants?.some((v: any) => v.sku?.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [shopifyProducts, search]);

  // Build a map for display
  const productMap = useMemo(() => {
    if (!shopifyProducts) return new Map();
    const m = new Map<string, any>();
    shopifyProducts.forEach((p: any) => m.set(String(p.id), p));
    return m;
  }, [shopifyProducts]);

  const addItem = useMutation({
    mutationFn: async ({ productId, variantId }: { productId: string; variantId: string | null }) => {
      if (!promoId) throw new Error("No promo");
      const { error } = await supabase.from("promotion_items").insert({
        promotion_id: promoId,
        shopify_product_id: productId,
        shopify_variant_id: variantId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      setSelectedProduct(null);
      setSelectedVariantId(null);
      setSearch("");
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

  const handleSelectProduct = (product: any) => {
    setSelectedProduct(product);
    setSelectedVariantId(null);
    setSearch("");
  };

  const handleAddSelected = () => {
    if (!selectedProduct) return;
    addItem.mutate({
      productId: String(selectedProduct.id),
      variantId: selectedVariantId,
    });
  };

  const getProductName = (item: any) => {
    const p = productMap.get(item.shopify_product_id);
    if (!p) return item.shopify_product_id;
    if (!item.shopify_variant_id) return p.title;
    const v = p.variants?.find((v: any) => String(v.id) === item.shopify_variant_id);
    return v ? `${p.title} — ${v.title}` : `${p.title} (${item.shopify_variant_id})`;
  };

  const getVariantSku = (item: any) => {
    const p = productMap.get(item.shopify_product_id);
    if (!p) return null;
    if (item.shopify_variant_id) {
      const v = p.variants?.find((v: any) => String(v.id) === item.shopify_variant_id);
      return v?.sku || null;
    }
    return p.variants?.[0]?.sku || null;
  };

  return (
    <Dialog open={!!promoId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Товари в акції: {promo?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Search / Select product */}
          {!selectedProduct ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Пошук по назві або SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {loadingProducts && (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />Завантаження товарів...
                </div>
              )}
              {search.trim() && !loadingProducts && filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Нічого не знайдено</p>
              )}
              {filtered.length > 0 && (
                <ScrollArea className="max-h-56">
                  <div className="space-y-1">
                    {filtered.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProduct(p)}
                        className="w-full flex items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-accent transition-colors"
                      >
                        {p.images?.[0]?.src ? (
                          <img src={p.images[0].src} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-muted flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.variants?.[0]?.sku && `SKU: ${p.variants[0].sku}`}
                            {p.variants?.length > 1 && ` · ${p.variants.length} варіантів`}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          ) : (
            /* Variant selection */
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2">
                {selectedProduct.images?.[0]?.src ? (
                  <img src={selectedProduct.images[0].src} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded bg-muted flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{selectedProduct.title}</p>
                  <p className="text-xs text-muted-foreground">{selectedProduct.variants?.length} варіантів</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedProduct(null)}>Змінити</Button>
              </div>

              <p className="text-sm text-muted-foreground">Оберіть варіант:</p>
              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {/* All variants option */}
                  <button
                    onClick={() => setSelectedVariantId(null)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm text-left transition-colors",
                      selectedVariantId === null ? "border-primary bg-primary/5" : "hover:bg-accent"
                    )}
                  >
                    <span className="font-medium">Всі варіанти</span>
                    {selectedVariantId === null && <Check className="h-4 w-4 text-primary" />}
                  </button>
                  {selectedProduct.variants?.map((v: any) => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVariantId(String(v.id))}
                      className={cn(
                        "w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm text-left transition-colors",
                        selectedVariantId === String(v.id) ? "border-primary bg-primary/5" : "hover:bg-accent"
                      )}
                    >
                      <div>
                        <span className="font-medium">{v.title}</span>
                        <span className="text-muted-foreground ml-2">
                          {v.sku && `SKU: ${v.sku}`}{v.price && ` · ₴${v.price}`}
                        </span>
                      </div>
                      {selectedVariantId === String(v.id) && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </ScrollArea>

              <Button onClick={handleAddSelected} className="w-full" disabled={addItem.isPending}>
                <Plus className="h-4 w-4 mr-2" />Додати
              </Button>
            </div>
          )}

          {/* Existing items */}
          <div>
            <p className="text-sm font-medium mb-2">Додані товари ({promo?.promotion_items?.length || 0})</p>
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {promo?.promotion_items?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Немає товарів</p>
                )}
                {promo?.promotion_items?.map((item: any) => {
                  const sku = getVariantSku(item);
                  return (
                    <div key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{getProductName(item)}</p>
                        {sku && <p className="text-xs text-muted-foreground">SKU: {sku}</p>}
                        {!item.shopify_variant_id && <Badge variant="outline" className="text-xs mt-0.5">Всі варіанти</Badge>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => deleteItem.mutate(item.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// --- Main page ---

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

        <ItemsDialog promoId={itemsDialogPromoId} promo={selectedPromo} onClose={() => setItemsDialogPromoId(null)} />
      </div>
    </AdminLayout>
  );
};

export default Promotions;
