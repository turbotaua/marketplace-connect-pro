import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Logs = () => {
  const { data: logs } = useQuery({
    queryKey: ["feed_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: validationErrors } = useQuery({
    queryKey: ["validation_errors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validation_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const statusBadge = (status: string) => {
    if (status === "success") return <Badge className="bg-success text-success-foreground">Успіх</Badge>;
    if (status === "error") return <Badge variant="destructive">Помилка</Badge>;
    return <Badge variant="secondary">Очікування</Badge>;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Логи та валідація</h2>

        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs">Генерації фідів</TabsTrigger>
            <TabsTrigger value="errors">Помилки валідації ({validationErrors?.length ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="logs">
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
      </div>
    </AdminLayout>
  );
};

export default Logs;
