import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Trash2 } from "lucide-react";

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

const Prices = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [previewPrice, setPreviewPrice] = useState("500");

  const { data: marketplaces } = useQuery({
    queryKey: ["marketplace_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_config").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

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

  const basePrice = parseFloat(previewPrice) || 0;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Управління цінами</h2>

        {/* Marketplace multipliers */}
        <div className="grid gap-4 md:grid-cols-3">
          {marketplaces?.map((mp) => (
            <Card key={mp.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{mp.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Множник</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    defaultValue={mp.global_multiplier}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (val > 0 && val !== mp.global_multiplier) {
                        updateMarketplace.mutate({ id: mp.id, global_multiplier: val });
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Округлення</label>
                  <Select
                    defaultValue={mp.rounding_rule}
                    onValueChange={(val) => updateMarketplace.mutate({ id: mp.id, rounding_rule: val })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roundingOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Price preview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Превʼю ціни</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <label className="text-sm text-muted-foreground">Shopify ціна:</label>
              <Input
                type="number"
                className="w-32"
                value={previewPrice}
                onChange={(e) => setPreviewPrice(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">грн</span>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {marketplaces?.map((mp) => (
                <div key={mp.id} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{mp.name}</p>
                  <p className="text-lg font-semibold text-foreground">
                    {applyRounding(basePrice * mp.global_multiplier, mp.rounding_rule)} грн
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ×{mp.global_multiplier} ({roundingOptions.find((o) => o.value === mp.rounding_rule)?.label})
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Category multipliers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Множники по категоріях</CardTitle>
          </CardHeader>
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
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => deleteMultiplier.mutate(pm.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                Немає окремих множників по категоріях. Використовуються множники маркетплейсів.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default Prices;
