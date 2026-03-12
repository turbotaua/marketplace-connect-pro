
ALTER TABLE public.promotions 
  ADD COLUMN is_recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN recurrence_pattern text,
  ADD COLUMN recurrence_day_of_week integer,
  ADD COLUMN start_time text,
  ADD COLUMN end_time text,
  ALTER COLUMN ends_at DROP NOT NULL;
