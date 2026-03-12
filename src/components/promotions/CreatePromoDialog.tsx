import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const DAYS_OF_WEEK = [
  { value: "1", label: "Понеділок" },
  { value: "2", label: "Вівторок" },
  { value: "3", label: "Середа" },
  { value: "4", label: "Четвер" },
  { value: "5", label: "П'ятниця" },
  { value: "6", label: "Субота" },
  { value: "0", label: "Неділя" },
];

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
    start_time: "00:00",
    end_time: "23:59",
    is_recurring: false,
    recurrence_pattern: "daily" as "daily" | "weekly",
    recurrence_day_of_week: "1",
  });

  const resetForm = () => {
    setNewPromo({
      name: "", marketplace_id: "", discount_percent: "",
      starts_at: undefined, ends_at: undefined,
      start_time: "00:00", end_time: "23:59",
      is_recurring: false, recurrence_pattern: "daily", recurrence_day_of_week: "1",
    });
  };

  const createPromo = useMutation({
    mutationFn: async () => {
      if (!newPromo.name || !newPromo.marketplace_id || !newPromo.discount_percent || !newPromo.starts_at) {
        throw new Error("Заповніть обов'язкові поля");
      }
      if (!newPromo.is_recurring && !newPromo.ends_at) {
        throw new Error("Для одноразової акції потрібна дата закінчення");
      }
      if (newPromo.is_recurring && newPromo.start_time >= newPromo.end_time) {
        throw new Error("Час закінчення повинен бути пізніше часу початку");
      }

      // For one-time promos, combine date + time into starts_at/ends_at
      const startsAt = new Date(newPromo.starts_at);
      const [sh, sm] = newPromo.start_time.split(":").map(Number);
      startsAt.setHours(sh, sm, 0, 0);

      let endsAt: Date | null = null;
      if (newPromo.ends_at) {
        endsAt = new Date(newPromo.ends_at);
        const [eh, em] = newPromo.end_time.split(":").map(Number);
        endsAt.setHours(eh, em, 0, 0);
      }

      const { error } = await supabase.from("promotions").insert({
        name: newPromo.name,
        marketplace_id: newPromo.marketplace_id,
        discount_percent: parseFloat(newPromo.discount_percent),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt?.toISOString() ?? null,
        is_recurring: newPromo.is_recurring,
        recurrence_pattern: newPromo.is_recurring ? newPromo.recurrence_pattern : null,
        recurrence_day_of_week: newPromo.is_recurring && newPromo.recurrence_pattern === "weekly"
          ? parseInt(newPromo.recurrence_day_of_week) : null,
        start_time: newPromo.is_recurring ? newPromo.start_time : null,
        end_time: newPromo.is_recurring ? newPromo.end_time : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promotions"] });
      resetForm();
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
      <DialogContent className="max-w-lg">
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

          {/* Recurring toggle */}
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="recurring" className="text-sm">Повторювана акція</Label>
            <Switch id="recurring" checked={newPromo.is_recurring} onCheckedChange={(v) => setNewPromo({ ...newPromo, is_recurring: v })} />
          </div>

          {newPromo.is_recurring && (
            <div className="space-y-3 rounded-md border border-border p-3 bg-muted/30">
              <Select value={newPromo.recurrence_pattern} onValueChange={(v: "daily" | "weekly") => setNewPromo({ ...newPromo, recurrence_pattern: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Щоденно</SelectItem>
                  <SelectItem value="weekly">Щотижнево</SelectItem>
                </SelectContent>
              </Select>

              {newPromo.recurrence_pattern === "weekly" && (
                <Select value={newPromo.recurrence_day_of_week} onValueChange={(v) => setNewPromo({ ...newPromo, recurrence_day_of_week: v })}>
                  <SelectTrigger><SelectValue placeholder="День тижня" /></SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((d) => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Час початку</Label>
                  <Input type="time" value={newPromo.start_time} onChange={(e) => setNewPromo({ ...newPromo, start_time: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Час закінчення</Label>
                  <Input type="time" value={newPromo.end_time} onChange={(e) => setNewPromo({ ...newPromo, end_time: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {/* Date pickers */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                {newPromo.is_recurring ? "Діє з" : "Початок"}
              </Label>
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
              <Label className="text-xs text-muted-foreground mb-1 block">
                {newPromo.is_recurring ? "Діє до (опціонально)" : "Кінець"}
              </Label>
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

          {/* Time inputs for one-time promos */}
          {!newPromo.is_recurring && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Час початку</Label>
                <Input type="time" value={newPromo.start_time} onChange={(e) => setNewPromo({ ...newPromo, start_time: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Час закінчення</Label>
                <Input type="time" value={newPromo.end_time} onChange={(e) => setNewPromo({ ...newPromo, end_time: e.target.value })} />
              </div>
            </div>
          )}

          <Button onClick={() => createPromo.mutate()} className="w-full" disabled={createPromo.isPending}>Створити</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreatePromoDialog;
