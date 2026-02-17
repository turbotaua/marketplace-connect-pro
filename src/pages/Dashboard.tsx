import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, CheckCircle, AlertCircle, Clock } from "lucide-react";

const Dashboard = () => {
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

  const getLastLog = (slug: string) => recentLogs?.find((l) => l.marketplace_slug === slug);

  const statusIcon = (status?: string) => {
    if (status === "success") return <CheckCircle className="h-5 w-5 text-success" />;
    if (status === "error") return <AlertCircle className="h-5 w-5 text-destructive" />;
    return <Clock className="h-5 w-5 text-muted-foreground" />;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Дашборд</h2>

        <div className="grid gap-4 md:grid-cols-3">
          {marketplaces?.map((mp) => {
            const lastLog = getLastLog(mp.slug);
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
      </div>
    </AdminLayout>
  );
};

export default Dashboard;
