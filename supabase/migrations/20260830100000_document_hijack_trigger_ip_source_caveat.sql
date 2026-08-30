-- Documentation-only fix for security-review.md finding #11 (Low, accepted risk):
-- the hijack-detection trigger's IP source has a caveat that was previously only
-- recorded in docs/session-hijack-detection-plan.md, not attached to the actual
-- database object. Records the same reminder as a real Postgres catalog comment
-- on the function, so it's visible from a DB introspection tool
-- (`\df+ detect_session_hijack`, pgAdmin, etc.), not just the docs.
--
-- No behavior change — `detect_session_hijack()` itself is untouched.

comment on function public.detect_session_hijack() is
  'Session-hijack IP-mismatch check. Primary IP source is cf-connecting-ip '
  '(set by Cloudflare''s edge, unspoofable by the client); falls back to '
  'x-forwarded-for only when cf-connecting-ip is absent. CAVEAT (accepted risk, '
  'security-review.md finding #11): this trust boundary depends on Cloudflare '
  'fronting every request path to this project. If Cloudflare is ever removed, '
  'bypassed, or a direct-to-Supabase path is added without going through it, '
  'every request falls back to the client-controlled x-forwarded-for header, '
  'and an attacker can forge whatever IP they like — silently defeating this '
  'mismatch check by making every request look like it came from one fake IP, '
  'not by tampering with any row.';
