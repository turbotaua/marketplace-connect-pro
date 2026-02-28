import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ExternalLink, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronRight,
  Play, Loader2, Package, Plus, Trash2, X
} from "lucide-react";

// ── Helpers ──
const roundingOptions = [
  { value: "math", label: "Математичне" },
  { value: "dot99", label: "До .99" },
  { value: "round5", label: "До 5" },
  { value: "round10", label: "До 10" },
];

const applyRounding = (price: number, rule: string): number => {
  switch (rule) {
    case "dot99": return Math.floor(price) + 0.99;
    case "round5": return Math.round(price / 5) * 5;
    case "round10": return Math.round(price / 10) * 10;
    default: return Math.round(price * 100) / 100;
  }
};

const Marketplaces = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Shared queries ──
  const { data: marketplaces } = useQuery({
    queryKey: ["marketplace_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_config").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  // ── Dashboard state & queries ──
  const [productsOpen, setProductsOpen] = useState(false);
  const [generatingSlug, setGeneratingSlug] = useState<string | null>(null);

  const { data: recentLogs } = useQuery({
    queryKey: ["feed_logs_recent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_logs").select("*").order("created_at", { ascending: false }).limit(9);
      if (error) throw error;
      return data;
    },
  });

  const { data: errorCount } = useQuery({
    queryKey: ["validation_errors_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("validation_errors").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: shopifyProducts, isLoading: productsLoading, error: productsError } = useQuery({
    queryKey: ["shopify_products"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("shopify-products");
      if (error) throw error;
      return data as { products: any[]; total: number };
    },
    enabled: productsOpen,
  });

  const generateFeed = useMutation({
    mutationFn: async (slug: string) => {
      setGeneratingSlug(slug);
      const { data, error } = await supabase.functions.invoke(`generate-feed-${slug}`);
      if (error) throw error;
      return data;
    },
    onSuccess: (data, slug) => {
      setGeneratingSlug(null);
      toast({ title: "Фід згенеровано", description: `${slug}: ${data?.product_count ?? 0} товарів` });
    },
    onError: (e) => {
      setGeneratingSlug(null);
      toast({ title: "Помилка генерації", description: e.message, variant: "destructive" });
    },
  });

  const getLastLog = (slug: string) => recentLogs?.find((l) => l.marketplace_slug === slug);
  const statusIcon = (status?: string) => {
    if (status === "success") return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (status === "error") return <AlertCircle className="h-5 w-5 text-destructive" />;
    return <Clock className="h-5 w-5 text-muted-foreground" />;
  };
  const getPriceRange = (product: any) => {
    const prices = product.variants?.map((v: any) => parseFloat(v.price)).filter((p: number) => !isNaN(p)) || [];
    if (prices.length === 0) return "—";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `${min} ₴` : `${min}–${max} ₴`;
  };

  // ── Prices state & mutations ──
  const [previewPrice, setPreviewPrice] = useState("500");
  const basePrice = parseFloat(previewPrice) || 0;

  const { data: categoryMultipliers } = useQuery({
    queryKey: ["price_multipliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("price_multipliers").select("*, marketplace_config(name)");
      if (error) throw error;
      return data;
    },
  });

  const updateMarketplace = useMutation({
    mutationFn: async ({ id, global_multiplier, rounding_rule }: { id: string; global_multiplier?: number; rounding_rule?: string }) => {
      const update: Record<string, unknown> = {};
      if (global_multiplier !== undefined) update.global_multiplier = global_multiplier;
      if (rounding_rule !== undefined) update.rounding_rule = rounding_rule;
      const { error } = await supabase.from("marketplace_config").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplace_config"] });
      toast({ title: "Збережено" });
    },
  });

  const deleteMultiplier = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_multipliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price_multipliers"] });
      toast({ title: "Видалено" });
    },
  });

  // ── Categories state & mutations ──
  const { data: mappings } = useQuery({
    queryKey: ["category_mapping"],
    queryFn: async () => {
      const { data, error } = await supabase.from("category_mapping").select("*, marketplace_config(name, slug)").order("shopify_collection_title");
      if (error) throw error;
      return data;
    },
  });

  const [newMapping, setNewMapping] = useState({
    shopify_collection_id: "", shopify_collection_title: "", marketplace_id: "",
    marketplace_category_id: "", marketplace_category_name: "", portal_id: "", rz_id: "", epicentr_category_code: "",
  });
  const selectedMarketplaceSlug = marketplaces?.find((m) => m.id === newMapping.marketplace_id)?.slug;

  const addMapping = useMutation({
    mutationFn: async () => {
      const payload = {
        shopify_collection_id: newMapping.shopify_collection_id,
        shopify_collection_title: newMapping.shopify_collection_title || null,
        marketplace_id: newMapping.marketplace_id,
        marketplace_category_id: newMapping.marketplace_category_id,
        marketplace_category_name: newMapping.marketplace_category_name || null,
        portal_id: newMapping.portal_id || null, rz_id: newMapping.rz_id || null,
        epicentr_category_code: newMapping.epicentr_category_code || null,
      };
      const { error } = await supabase.from("category_mapping").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category_mapping"] });
      setNewMapping({ shopify_collection_id: "", shopify_collection_title: "", marketplace_id: "", marketplace_category_id: "", marketplace_category_name: "", portal_id: "", rz_id: "", epicentr_category_code: "" });
      toast({ title: "Додано" });
    },
    onError: (e) => toast({ title: "Помилка", description: e.message, variant: "destructive" }),
  });

  const deleteMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("category_mapping").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category_mapping"] });
      toast({ title: "Видалено" });
    },
  });

  const updateMappingField = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const { error } = await supabase.from("category_mapping").update({ [field]: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category_mapping"] });
      toast({ title: "Збережено" });
    },
  });

  const addProductType = (mappingId: string, currentTypes: string[], newType: string) => {
    if (!newType.trim() || currentTypes.includes(newType.trim())) return;
    updateMappingField.mutate({ id: mappingId, field: "shopify_product_types", value: [...currentTypes, newType.trim()] });
  };
  const removeProductType = (mappingId: string, currentTypes: string[], typeToRemove: string) => {
    updateMappingField.mutate({ id: mappingId, field: "shopify_product_types", value: currentTypes.filter(t => t !== typeToRemove) });
  };
  const getMarketplaceSlug = (m: any) => (m.marketplace_config as any)?.slug;

  // ── Logs queries ──
  const { data: logs } = useQuery({
    queryKey: ["feed_logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_logs").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: validationErrors } = useQuery({
    queryKey: ["validation_errors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("validation_errors").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const statusBadge = (status: string) => {
    if (status === "success") return <Badge className="bg-green-600 text-white">Успіх</Badge>;
    if (status === "error") return <Badge variant="destructive">Помилка</Badge>;
    return <Badge variant="secondary">Очікування</Badge>;
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <h2 className="text-2xl font-bold text-foreground">XML та Маркетплейси</h2>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Огляд</TabsTrigger>
            <TabsTrigger value="prices">Ціни</TabsTrigger>
            <TabsTrigger value="categories">Категорії</TabsTrigger>
            <TabsTrigger value="logs">Логи</TabsTrigger>
          </TabsList>

          {/* ═══ OVERVIEW TAB ═══ */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              {marketplaces?.map((mp) => {
                const lastLog = getLastLog(mp.slug);
                const isGenerating = generatingSlug === mp.slug;
                return (
                  <Card key={mp.id}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-base font-semibold">{mp.name}</CardTitle>
                      {mp.is_active ? (
                        <Badge variant="default" className="bg-green-600 text-white">Активний</Badge>
                      ) : (
                        <Badge variant="secondary">Вимкнено</Badge>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2">
                        {statusIcon(lastLog?.status)}
                        <span className="text-sm text-muted-foreground">
                          {lastLog ? `${lastLog.product_count ?? 0} товарів • ${new Date(lastLog.created_at).toLocaleString("uk-UA")}` : "Ще не генерувався"}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Множник: </span>
                        <span className="font-medium text-foreground">×{mp.global_multiplier}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {mp.feed_url && (
                          <a href={mp.feed_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <ExternalLink className="h-3 w-3" /> Фід URL
                          </a>
                        )}
                        <Button size="sm" variant="outline" disabled={!mp.is_active || isGenerating} onClick={() => generateFeed.mutate(mp.slug)}>
                          {isGenerating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                          Генерувати
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Помилки валідації</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">{errorCount ?? 0}</p>
                <p className="text-sm text-muted-foreground">Товарів з проблемами</p>
              </CardContent>
            </Card>

            <Collapsible open={productsOpen} onOpenChange={setProductsOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2">
                      {productsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Package className="h-4 w-4" />
                      <CardTitle className="text-base">
                        Товари Shopify
                        {shopifyProducts && <Badge variant="secondary" className="ml-2">{shopifyProducts.total}</Badge>}
                      </CardTitle>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    {productsLoading && <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
                    {productsError && <p className="text-sm text-destructive">Помилка: {(productsError as Error).message}</p>}
                    {shopifyProducts && shopifyProducts.products.length > 0 && (
                      <div className="overflow-auto max-h-[500px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">Фото</TableHead>
                              <TableHead>Назва</TableHead>
                              <TableHead>Бренд</TableHead>
                              <TableHead>Тип</TableHead>
                              <TableHead>Варіанти</TableHead>
                              <TableHead>Ціна</TableHead>
                              <TableHead>Статус</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {shopifyProducts.products.map((p: any) => (
                              <TableRow key={p.id}>
                                <TableCell>
                                  {p.images?.[0]?.src ? <img src={p.images[0].src} alt="" className="h-8 w-8 rounded object-cover" /> : <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">—</div>}
                                </TableCell>
                                <TableCell className="font-medium max-w-[200px] truncate">{p.title}</TableCell>
                                <TableCell className="text-muted-foreground">{p.vendor || "—"}</TableCell>
                                <TableCell className="text-muted-foreground">{p.product_type || "—"}</TableCell>
                                <TableCell>{p.variants?.length || 0}</TableCell>
                                <TableCell>{getPriceRange(p)}</TableCell>
                                <TableCell><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </TabsContent>

          {/* ═══ PRICES TAB ═══ */}
          <TabsContent value="prices" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              {marketplaces?.map((mp) => (
                <Card key={mp.id}>
                  <CardHeader className="pb-3"><CardTitle className="text-base">{mp.name}</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground">Множник</label>
                      <Input type="number" step="0.01" min="1" defaultValue={mp.global_multiplier} onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (val > 0 && val !== mp.global_multiplier) updateMarketplace.mutate({ id: mp.id, global_multiplier: val });
                      }} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Округлення</label>
                      <Select defaultValue={mp.rounding_rule} onValueChange={(val) => updateMarketplace.mutate({ id: mp.id, rounding_rule: val })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{roundingOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Превʼю ціни</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 mb-4">
                  <label className="text-sm text-muted-foreground">Shopify ціна:</label>
                  <Input type="number" className="w-32" value={previewPrice} onChange={(e) => setPreviewPrice(e.target.value)} />
                  <span className="text-sm text-muted-foreground">грн</span>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  {marketplaces?.map((mp) => (
                    <div key={mp.id} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{mp.name}</p>
                      <p className="text-lg font-semibold text-foreground">{applyRounding(basePrice * mp.global_multiplier, mp.rounding_rule)} грн</p>
                      <p className="text-xs text-muted-foreground">×{mp.global_multiplier} ({roundingOptions.find((o) => o.value === mp.rounding_rule)?.label})</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Множники по категоріях</CardTitle></CardHeader>
              <CardContent>
                {categoryMultipliers && categoryMultipliers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Категорія</TableHead>
                        <TableHead>Маркетплейс</TableHead>
                        <TableHead>Множник</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryMultipliers.map((pm) => (
                        <TableRow key={pm.id}>
                          <TableCell>{pm.shopify_collection_title || pm.shopify_collection_id}</TableCell>
                          <TableCell>{(pm.marketplace_config as any)?.name}</TableCell>
                          <TableCell>×{pm.multiplier}</TableCell>
                          <TableCell><Button variant="ghost" size="icon" onClick={() => deleteMultiplier.mutate(pm.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground">Немає окремих множників. Використовуються множники маркетплейсів.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ CATEGORIES TAB ═══ */}
          <TabsContent value="categories" className="space-y-6">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Додати mapping</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4 items-end">
                  <div>
                    <label className="text-xs text-muted-foreground">Shopify Collection ID</label>
                    <Input value={newMapping.shopify_collection_id} onChange={(e) => setNewMapping((p) => ({ ...p, shopify_collection_id: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Назва колекції</label>
                    <Input value={newMapping.shopify_collection_title} onChange={(e) => setNewMapping((p) => ({ ...p, shopify_collection_title: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Маркетплейс</label>
                    <Select value={newMapping.marketplace_id} onValueChange={(v) => setNewMapping((p) => ({ ...p, marketplace_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Обрати" /></SelectTrigger>
                      <SelectContent>{marketplaces?.map((mp) => <SelectItem key={mp.id} value={mp.id}>{mp.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Category ID</label>
                    <Input value={newMapping.marketplace_category_id} onChange={(e) => setNewMapping((p) => ({ ...p, marketplace_category_id: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Назва категорії</label>
                    <Input value={newMapping.marketplace_category_name} onChange={(e) => setNewMapping((p) => ({ ...p, marketplace_category_name: e.target.value }))} />
                  </div>
                  {selectedMarketplaceSlug === "rozetka" && (
                    <div><label className="text-xs text-muted-foreground">rz_id (Rozetka)</label><Input value={newMapping.rz_id} onChange={(e) => setNewMapping((p) => ({ ...p, rz_id: e.target.value }))} /></div>
                  )}
                  {selectedMarketplaceSlug === "maudau" && (
                    <div><label className="text-xs text-muted-foreground">portal_id (MAUDAU)</label><Input value={newMapping.portal_id} onChange={(e) => setNewMapping((p) => ({ ...p, portal_id: e.target.value }))} /></div>
                  )}
                  {selectedMarketplaceSlug === "epicentr" && (
                    <div><label className="text-xs text-muted-foreground">Category Code (Epicentr)</label><Input value={newMapping.epicentr_category_code} onChange={(e) => setNewMapping((p) => ({ ...p, epicentr_category_code: e.target.value }))} /></div>
                  )}
                  <Button onClick={() => addMapping.mutate()} disabled={!newMapping.shopify_collection_id || !newMapping.marketplace_id || !newMapping.marketplace_category_id}>
                    <Plus className="h-4 w-4 mr-1" /> Додати
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Існуючі mappings</CardTitle></CardHeader>
              <CardContent>
                {mappings && mappings.length > 0 ? (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Активна</TableHead>
                          <TableHead>Shopify Collection</TableHead>
                          <TableHead>Маркетплейс</TableHead>
                          <TableHead>Category ID</TableHead>
                          <TableHead>Назва категорії</TableHead>
                          <TableHead>Product Types</TableHead>
                          <TableHead>rz_id / portal_id / code</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mappings.map((m: any) => {
                          const slug = getMarketplaceSlug(m);
                          const extraField = slug === "rozetka" ? "rz_id" : slug === "maudau" ? "portal_id" : slug === "epicentr" ? "epicentr_category_code" : null;
                          const extraValue = extraField ? (m as any)[extraField] || "" : "";
                          const productTypes: string[] = (m as any).shopify_product_types || [];
                          const isActive = (m as any).is_active !== false;
                          return (
                            <TableRow key={m.id} className={!isActive ? "opacity-50" : ""}>
                              <TableCell><Switch checked={isActive} onCheckedChange={(checked) => updateMappingField.mutate({ id: m.id, field: "is_active", value: checked })} /></TableCell>
                              <TableCell>{m.shopify_collection_title || m.shopify_collection_id}</TableCell>
                              <TableCell>{(m.marketplace_config as any)?.name}</TableCell>
                              <TableCell>
                                <Input defaultValue={m.marketplace_category_id} className="w-28" onBlur={(e) => {
                                  if (e.target.value !== m.marketplace_category_id) updateMappingField.mutate({ id: m.id, field: "marketplace_category_id", value: e.target.value });
                                }} />
                              </TableCell>
                              <TableCell>
                                <Input defaultValue={m.marketplace_category_name || ""} className="w-40" onBlur={(e) => {
                                  if (e.target.value !== (m.marketplace_category_name || "")) updateMappingField.mutate({ id: m.id, field: "marketplace_category_name", value: e.target.value });
                                }} />
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1 items-center min-w-[200px]">
                                  {productTypes.map((pt) => (
                                    <Badge key={pt} variant="secondary" className="gap-1">{pt}<X className="h-3 w-3 cursor-pointer" onClick={() => removeProductType(m.id, productTypes, pt)} /></Badge>
                                  ))}
                                  <Input className="w-32 h-7 text-xs" placeholder="+ тип" onKeyDown={(e) => { if (e.key === "Enter") { addProductType(m.id, productTypes, e.currentTarget.value); e.currentTarget.value = ""; } }} />
                                </div>
                              </TableCell>
                              <TableCell>
                                {extraField && <Input defaultValue={extraValue} className="w-32" placeholder={extraField} onBlur={(e) => { if (e.target.value !== extraValue) updateMappingField.mutate({ id: m.id, field: extraField, value: e.target.value }); }} />}
                              </TableCell>
                              <TableCell><Button variant="ghost" size="icon" onClick={() => deleteMapping.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Немає mappings. Додайте перший вище.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ LOGS TAB ═══ */}
          <TabsContent value="logs" className="space-y-6">
            <Tabs defaultValue="feed_logs">
              <TabsList>
                <TabsTrigger value="feed_logs">Генерації фідів</TabsTrigger>
                <TabsTrigger value="errors">Помилки валідації ({validationErrors?.length ?? 0})</TabsTrigger>
              </TabsList>
              <TabsContent value="feed_logs">
                <Card>
                  <CardContent className="pt-6">
                    {logs && logs.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Дата</TableHead>
                            <TableHead>Маркетплейс</TableHead>
                            <TableHead>Статус</TableHead>
                            <TableHead>Товарів</TableHead>
                            <TableHead>Час (мс)</TableHead>
                            <TableHead>Помилка</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {logs.map((log) => (
                            <TableRow key={log.id}>
                              <TableCell className="text-sm">{new Date(log.created_at).toLocaleString("uk-UA")}</TableCell>
                              <TableCell className="font-medium">{log.marketplace_slug}</TableCell>
                              <TableCell>{statusBadge(log.status)}</TableCell>
                              <TableCell>{log.product_count ?? "—"}</TableCell>
                              <TableCell>{log.duration_ms ?? "—"}</TableCell>
                              <TableCell className="text-xs text-destructive max-w-xs truncate">{log.error_message || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">Немає записів</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="errors">
                <Card>
                  <CardContent className="pt-6">
                    {validationErrors && validationErrors.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Дата</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead>Товар</TableHead>
                            <TableHead>Маркетплейс</TableHead>
                            <TableHead>Тип</TableHead>
                            <TableHead>Повідомлення</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {validationErrors.map((err) => (
                            <TableRow key={err.id}>
                              <TableCell className="text-sm">{new Date(err.created_at).toLocaleString("uk-UA")}</TableCell>
                              <TableCell className="font-mono text-xs">{err.product_sku || "—"}</TableCell>
                              <TableCell>{err.product_title || "—"}</TableCell>
                              <TableCell>{err.marketplace_slug}</TableCell>
                              <TableCell><Badge variant="outline">{err.error_type}</Badge></TableCell>
                              <TableCell className="text-xs max-w-xs truncate">{err.error_message}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">Немає помилок валідації 🎉</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
};

export default Marketplaces;
