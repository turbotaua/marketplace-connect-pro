import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Search, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const { data: shopifyProducts, isLoading: loadingProducts } = useQuery({
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
    addItem.mutate({ productId: String(selectedProduct.id), variantId: selectedVariantId });
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

  const getProductImage = (item: any) => {
    const p = productMap.get(item.shopify_product_id);
    return p?.images?.[0]?.src || null;
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
                <div className="h-56 overflow-y-auto rounded-md border border-border">
                  <div className="space-y-1 p-1">
                    {filtered.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProduct(p)}
                        className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent transition-colors"
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
                </div>
              )}
            </div>
          ) : (
            /* Variant selection */
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2">
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
              <div className="h-48 overflow-y-auto rounded-md border border-border">
                <div className="space-y-1 p-1">
                  <button
                    onClick={() => setSelectedVariantId(null)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-md px-3 py-2 text-sm text-left transition-colors",
                      selectedVariantId === null ? "bg-primary/10 text-primary" : "hover:bg-accent"
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
                        "w-full flex items-center justify-between rounded-md px-3 py-2 text-sm text-left transition-colors",
                        selectedVariantId === String(v.id) ? "bg-primary/10 text-primary" : "hover:bg-accent"
                      )}
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{v.title}</span>
                        <span className="text-muted-foreground ml-2">
                          {v.sku && `SKU: ${v.sku}`}{v.price && ` · ₴${v.price}`}
                        </span>
                      </div>
                      {selectedVariantId === String(v.id) && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleAddSelected} className="w-full" disabled={addItem.isPending}>
                <Plus className="h-4 w-4 mr-2" />Додати
              </Button>
            </div>
          )}

          {/* Existing items */}
          <div>
            <p className="text-sm font-medium mb-2">Додані товари ({promo?.promotion_items?.length || 0})</p>
            <div className="h-48 overflow-y-auto rounded-md border border-border">
              <div className="space-y-1 p-1">
                {(!promo?.promotion_items || promo.promotion_items.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Немає товарів</p>
                )}
                {promo?.promotion_items?.map((item: any) => {
                  const sku = getVariantSku(item);
                  const img = getProductImage(item);
                  return (
                    <div key={item.id} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted/50 group">
                      {img ? (
                        <img src={img} alt="" className="h-9 w-9 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded bg-muted flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">{getProductName(item)}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {sku && <span className="text-xs text-muted-foreground">SKU: {sku}</span>}
                          {!item.shopify_variant_id && <Badge variant="outline" className="text-xs h-5">Всі варіанти</Badge>}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0 opacity-50 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => deleteItem.mutate(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ItemsDialog;
