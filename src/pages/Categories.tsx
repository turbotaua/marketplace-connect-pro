import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

const Categories = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: marketplaces } = useQuery({
    queryKey: ["marketplace_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_config").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: mappings } = useQuery({
    queryKey: ["category_mapping"],
    queryFn: async () => {
      const { data, error } = await supabase.from("category_mapping").select("*, marketplace_config(name, slug)").order("shopify_collection_title");
      if (error) throw error;
      return data;
    },
  });

  const [newMapping, setNewMapping] = useState({
    shopify_collection_id: "",
    shopify_collection_title: "",
    marketplace_id: "",
    marketplace_category_id: "",
    marketplace_category_name: "",
    portal_id: "",
    rz_id: "",
    epicentr_category_code: "",
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
        portal_id: newMapping.portal_id || null,
        rz_id: newMapping.rz_id || null,
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

  const updateMapping = useMutation({
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
    updateMapping.mutate({ id: mappingId, field: "shopify_product_types", value: [...currentTypes, newType.trim()] });
  };

  const removeProductType = (mappingId: string, currentTypes: string[], typeToRemove: string) => {
    updateMapping.mutate({ id: mappingId, field: "shopify_product_types", value: currentTypes.filter(t => t !== typeToRemove) });
  };

  const getMarketplaceSlug = (m: any) => (m.marketplace_config as any)?.slug;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Mapping категорій</h2>

        {/* Add new */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Додати mapping</CardTitle>
          </CardHeader>
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
                  <SelectContent>
                    {marketplaces?.map((mp) => (
                      <SelectItem key={mp.id} value={mp.id}>{mp.name}</SelectItem>
                    ))}
                  </SelectContent>
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

              {/* Marketplace-specific fields */}
              {selectedMarketplaceSlug === "rozetka" && (
                <div>
                  <label className="text-xs text-muted-foreground">rz_id (Rozetka)</label>
                  <Input value={newMapping.rz_id} onChange={(e) => setNewMapping((p) => ({ ...p, rz_id: e.target.value }))} placeholder="ID категорії Rozetka" />
                </div>
              )}
              {selectedMarketplaceSlug === "maudau" && (
                <div>
                  <label className="text-xs text-muted-foreground">portal_id (MAUDAU)</label>
                  <Input value={newMapping.portal_id} onChange={(e) => setNewMapping((p) => ({ ...p, portal_id: e.target.value }))} placeholder="ID категорії MAUDAU" />
                </div>
              )}
              {selectedMarketplaceSlug === "epicentr" && (
                <div>
                  <label className="text-xs text-muted-foreground">Category Code (Epicentr)</label>
                  <Input value={newMapping.epicentr_category_code} onChange={(e) => setNewMapping((p) => ({ ...p, epicentr_category_code: e.target.value }))} placeholder="Код категорії" />
                </div>
              )}

              <Button onClick={() => addMapping.mutate()} disabled={!newMapping.shopify_collection_id || !newMapping.marketplace_id || !newMapping.marketplace_category_id}>
                <Plus className="h-4 w-4 mr-1" /> Додати
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Existing mappings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Існуючі mappings</CardTitle>
          </CardHeader>
          <CardContent>
            {mappings && mappings.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shopify Collection</TableHead>
                    <TableHead>Маркетплейс</TableHead>
                    <TableHead>Category ID</TableHead>
                    <TableHead>Назва категорії</TableHead>
                     <TableHead>Shopify Product Types</TableHead>
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
                    return (
                      <TableRow key={m.id}>
                        <TableCell>{m.shopify_collection_title || m.shopify_collection_id}</TableCell>
                        <TableCell>{(m.marketplace_config as any)?.name}</TableCell>
                        <TableCell>
                          <Input
                            defaultValue={m.marketplace_category_id}
                            className="w-28"
                            onBlur={(e) => {
                              if (e.target.value !== m.marketplace_category_id) {
                                updateMapping.mutate({ id: m.id, field: "marketplace_category_id", value: e.target.value });
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            defaultValue={m.marketplace_category_name || ""}
                            className="w-40"
                            onBlur={(e) => {
                              if (e.target.value !== (m.marketplace_category_name || "")) {
                                updateMapping.mutate({ id: m.id, field: "marketplace_category_name", value: e.target.value });
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 items-center min-w-[200px]">
                            {productTypes.map((pt) => (
                              <Badge key={pt} variant="secondary" className="gap-1">
                                {pt}
                                <X className="h-3 w-3 cursor-pointer" onClick={() => removeProductType(m.id, productTypes, pt)} />
                              </Badge>
                            ))}
                            <Input
                              className="w-32 h-7 text-xs"
                              placeholder="+ тип"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  addProductType(m.id, productTypes, e.currentTarget.value);
                                  e.currentTarget.value = "";
                                }
                              }}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          {extraField && (
                            <Input
                              defaultValue={extraValue}
                              className="w-32"
                              placeholder={extraField}
                              onBlur={(e) => {
                                if (e.target.value !== extraValue) {
                                  updateMapping.mutate({ id: m.id, field: extraField, value: e.target.value });
                                }
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => deleteMapping.mutate(m.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Немає mappings. Додайте перший вище.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default Categories;
