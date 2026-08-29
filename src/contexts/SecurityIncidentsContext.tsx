import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SecurityIncident {
  id: string;
  detected_at: string;
  session_id: string;
  table_name: string;
  operation: string;
  row_id: string | null;
  old_values: unknown;
  new_values: unknown;
  ip: string | null;
  user_agent: string | null;
  acknowledged: boolean;
}

interface SecurityIncidentsContextType {
  /** Unacknowledged incidents only — what the app-wide banner watches for. */
  unacknowledged: SecurityIncident[];
  loading: boolean;
  refetch: () => Promise<void>;
}

const SecurityIncidentsContext = createContext<SecurityIncidentsContextType>({
  unacknowledged: [],
  loading: true,
  refetch: async () => {},
});

/**
 * Backs the session-hijack-detection banner
 * (docs/session-hijack-detection-plan.md §4). Queried once when AppLayout
 * mounts — AppLayout persists across every protected-page navigation, so this
 * isn't a per-page re-fetch, matching the plan's "checked once ... on every
 * route" intent.
 *
 * A context (not a plain hook) deliberately: DevZone's Security tab
 * acknowledges incidents via its own separate query (it needs the full
 * ack+unack history, not just the unacknowledged subset this context tracks)
 * and then calls this context's `refetch` so the banner clears immediately,
 * in the same tab session, without a page reload — "clears the banner
 * app-wide" per the plan, for a single-user app with no per-viewer state.
 */
export function SecurityIncidentsProvider({ children }: { children: ReactNode }) {
  const [unacknowledged, setUnacknowledged] = useState<SecurityIncident[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('security_incidents')
      .select('*')
      .eq('acknowledged', false)
      .order('detected_at', { ascending: false });
    if (!error) setUnacknowledged((data ?? []) as SecurityIncident[]);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return (
    <SecurityIncidentsContext.Provider value={{ unacknowledged, loading, refetch }}>
      {children}
    </SecurityIncidentsContext.Provider>
  );
}

export const useSecurityIncidents = () => useContext(SecurityIncidentsContext);
