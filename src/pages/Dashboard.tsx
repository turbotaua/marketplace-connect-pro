import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronRight, Play, Loader2, Package } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const Dashboard = () => {
  const { toast } = useToast();
  const [productsOpen, setProductsOpen] = useState(false);
  const [generatingSlug, setGeneratingSlug] = useState<string | null>(null);

  const { data: marketplaces } = useQuery({
    queryKey: ["marketplace_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_config").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: recentLogs } = useQuery({
    queryKey: ["feed_logs_recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(9);
      if (error) throw error;
      return data;
    },
  });

  const { data: errorCount } = useQuery({
    queryKey: ["validation_errors_count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("validation_errors")
        .select("*", { count: "exact", head: true });
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
    if (status === "success") return <CheckCircle className="h-5 w-5 text-success" />;
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

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Дашборд</h2>

        <div className="grid gap-4 md:grid-cols-3">
          {marketplaces?.map((mp) => {
            const lastLog = getLastLog(mp.slug);
            const isGenerating = generatingSlug === mp.slug;
            return (
              <Card key={mp.id}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base font-semibold">{mp.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    {mp.is_active ? (
                      <Badge variant="default" className="bg-success text-success-foreground">Активний</Badge>
                    ) : (
                      <Badge variant="secondary">Вимкнено</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    {statusIcon(lastLog?.status)}
                    <span className="text-sm text-muted-foreground">
                      {lastLog
                        ? `${lastLog.product_count ?? 0} товарів • ${new Date(lastLog.created_at).toLocaleString("uk-UA")}`
                        : "Ще не генерувався"}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Множник: </span>
                    <span className="font-medium text-foreground">×{mp.global_multiplier}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {mp.feed_url && (
                      <a
                        href={mp.feed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Фід URL
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!mp.is_active || isGenerating}
                      onClick={() => generateFeed.mutate(mp.slug)}
                    >
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
          <CardHeader>
            <CardTitle className="text-base">Помилки валідації</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{errorCount ?? 0}</p>
            <p className="text-sm text-muted-foreground">Товарів з проблемами</p>
          </CardContent>
        </Card>

        {/* Shopify Products */}
        <Collapsible open={productsOpen} onOpenChange={setProductsOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  {productsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Package className="h-4 w-4" />
                  <CardTitle className="text-base">
                    Товари Shopify
                    {shopifyProducts && (
                      <Badge variant="secondary" className="ml-2">{shopifyProducts.total}</Badge>
                    )}
                  </CardTitle>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                {productsLoading && (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                )}
                {productsError && (
                  <p className="text-sm text-destructive">Помилка: {(productsError as Error).message}</p>
                )}
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
                              {p.images?.[0]?.src ? (
                                <img src={p.images[0].src} alt="" className="h-8 w-8 rounded object-cover" />
                              ) : (
                                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">—</div>
                              )}
                            </TableCell>
                            <TableCell className="font-medium max-w-[200px] truncate">{p.title}</TableCell>
                            <TableCell className="text-muted-foreground">{p.vendor || "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{p.product_type || "—"}</TableCell>
                            <TableCell>{p.variants?.length || 0}</TableCell>
                            <TableCell>{getPriceRange(p)}</TableCell>
                            <TableCell>
                              <Badge variant={p.status === "active" ? "default" : "secondary"}>
                                {p.status}
                              </Badge>
                            </TableCell>
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
      </div>
    </AdminLayout>
  );
};

export default Dashboard;
