import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useSecurityIncidents } from '@/contexts/SecurityIncidentsContext';

/**
 * Persistent, app-wide banner for an unacknowledged session-hijack-detection
 * incident — docs/session-hijack-detection-plan.md §4. Deliberately not
 * locally dismissible (no client-side "X" that just hides it): it only
 * clears once acknowledged in DevZone's Security tab, which is the actual
 * intent behind "persistent" in the plan — otherwise a real incident could be
 * closed by accident without ever being looked at.
 */
export function SecurityIncidentBanner() {
  const { unacknowledged, loading } = useSecurityIncidents();
  if (loading || unacknowledged.length === 0) return null;

  return (
    <Link
      to="/dev-zone?tab=security"
      className="flex items-center justify-center gap-2 bg-rose-600 px-4 py-2 text-center text-xs font-semibold text-white transition-colors hover:bg-rose-700"
    >
      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
      Suspicious activity detected from a different network — see Dev Zone
    </Link>
  );
}
