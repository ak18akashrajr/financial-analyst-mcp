CREATE TABLE public.period_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_key text NOT NULL UNIQUE,
  period_type text NOT NULL,
  fy text NOT NULL,
  commentary text,
  highlights text,
  risks text,
  outlook text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.period_reports TO anon, authenticated;
GRANT ALL ON public.period_reports TO service_role;
ALTER TABLE public.period_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on period_reports" ON public.period_reports FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER update_period_reports_updated_at BEFORE UPDATE ON public.period_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();