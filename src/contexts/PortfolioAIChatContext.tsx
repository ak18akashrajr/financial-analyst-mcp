import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

// `toolTrace` records every real MCP tool this specific answer was grounded
// in, in call order — attached once the answer finishes streaming so it's
// visible after the fact too, not just as a transient "thinking" indicator.
export type Msg = { role: 'user' | 'assistant'; content: string; toolTrace?: string[] };

// Opt-in escalation models via OpenRouter (docs/openrouter-nemotron-plan.md)
// — 'auto' is today's existing behavior (Groq's two-tier router) and is the
// default. Both opt-in models are free-tier
// rate-limited on OpenRouter; the backend falls back to Groq transparently
// (with an honest attribution note) if the daily quota's used up or the
// call itself fails, so there's no error state to handle here beyond that.
export type ModelPreference = 'auto' | 'nemotron' | 'minimax';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portfolio-ai`;

/**
 * Parses portfolio-ai's normalized SSE format — the backend owns the whole
 * generation (real MCP tool-use loop) and emits exactly three event types
 * regardless of which provider/model actually served the request:
 *   event: tool_call   { name, args }   — a real MCP tool is being invoked
 *   event: delta        { text }         — a chunk of the final answer
 *   event: done          { attribution } — stream finished
 *   event: error          { message }    — stream finished with an error
 */
async function streamChat({
  messages,
  modelPreference,
  onDelta,
  onToolCall,
  onDone,
  onError,
}: {
  messages: Msg[];
  modelPreference: ModelPreference;
  onDelta: (text: string) => void;
  onToolCall: (name: string) => void;
  onDone: (attribution?: string) => void;
  onError: (msg: string) => void;
}) {
  // Send the logged-in user's own session token, not the public anon key —
  // portfolio-ai verifies this server-side and rejects unauthenticated
  // callers (see supabase/functions/_shared/auth.ts). The anon key would
  // "work" (it's a valid signed JWT for the project) but doesn't identify a
  // real user, which is exactly the gap that let anyone with the key read
  // the whole portfolio without ever logging in.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { onError('Your session has expired — please sign in again.'); return; }

  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ messages, modelPreference }),
  });

  if (resp.status === 429) { onError('Rate limited — please wait a moment and try again.'); return; }
  if (!resp.ok || !resp.body) {
    const body = await resp.json().catch(() => null);
    onError(body?.error || 'Failed to connect to AI.');
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const handleEvent = (rawEvent: string) => {
    let eventType = 'message';
    let dataLine = '';
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    }
    if (!dataLine) return;
    let parsed: any;
    try { parsed = JSON.parse(dataLine); } catch { return; }

    if (eventType === 'delta') onDelta(parsed.text);
    else if (eventType === 'tool_call') onToolCall(parsed.name);
    else if (eventType === 'done') onDone(parsed.attribution);
    else if (eventType === 'error') onError(parsed.message);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handleEvent(rawEvent);
    }
  }

  if (buf.trim()) handleEvent(buf);
}

interface PortfolioAIChatContextType {
  messages: Msg[];
  isLoading: boolean;
  // Every real MCP tool call for the in-flight turn, in order — accumulates
  // rather than overwrites, so the live indicator shows the whole trace
  // building up (earlier calls checked off, the newest one still spinning)
  // instead of hiding everything but whatever tool happens to be running now.
  liveToolCalls: string[];
  modelPreference: ModelPreference;
  setModelPreference: (pref: ModelPreference) => void;
  send: (text: string) => void;
}

const PortfolioAIChatContext = createContext<PortfolioAIChatContextType | null>(null);

/**
 * Backs the /ai page's conversation. This used to be plain useState inside
 * PortfolioAI itself, which meant navigating to any other page and back blew
 * the whole chat away — every route in App.tsx (PortfolioAI included) is
 * unmounted on route change, only AppLayout and everything above it in the
 * tree survives. Lifting the state into a context and mounting the provider
 * in AppLayout (see SecurityIncidentsProvider right next to it for the same
 * pattern) fixes that: AppLayout persists across every protected-page
 * navigation, so the conversation now does too.
 *
 * This also gives "until the user logs out" for free rather than needing to
 * watch for a sign-out event: ProtectedRoute stops rendering <Outlet/> (and
 * therefore AppLayout and this provider) the moment the session goes away,
 * so the next login always mounts a brand-new provider with empty state —
 * nothing to explicitly clear.
 */
export function PortfolioAIChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [liveToolCalls, setLiveToolCalls] = useState<string[]>([]);
  const [modelPreference, setModelPreference] = useState<ModelPreference>('auto');

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Msg = { role: 'user', content: text.trim() };
    const allMsgs = [...messages, userMsg];
    setMessages(allMsgs);
    setIsLoading(true);
    setLiveToolCalls([]);

    // Plain array (not state) as the source of truth for which tools were
    // called this turn — every tool_call event fires before the answer's
    // first delta (see index.ts's per-turn loop: tool calls happen inside
    // the loop, text streaming only starts after it breaks), so by the time
    // `upsert` creates the assistant message, this is already complete and
    // stable. Reading it here avoids a stale-closure read of React state.
    const collectedTools: string[] = [];
    let assistantSoFar = '';
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: 'assistant', content: assistantSoFar, toolTrace: [...collectedTools] }];
      });
    };

    const finish = (attribution?: string) => {
      if (attribution) {
        assistantSoFar += `\n\n---\n*🤖 Response by **${attribution}***\n`;
        setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
      }
      setIsLoading(false);
      setLiveToolCalls([]);
    };

    try {
      await streamChat({
        messages: allMsgs,
        modelPreference,
        onDelta: upsert,
        onToolCall: (name) => {
          collectedTools.push(name);
          setLiveToolCalls([...collectedTools]);
        },
        onDone: finish,
        onError: (msg) => {
          setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
          setIsLoading(false);
          setLiveToolCalls([]);
        },
      });
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Connection error. Please try again.' }]);
      setIsLoading(false);
      setLiveToolCalls([]);
    }
  }, [messages, isLoading, modelPreference]);

  return (
    <PortfolioAIChatContext.Provider
      value={{ messages, isLoading, liveToolCalls, modelPreference, setModelPreference, send }}
    >
      {children}
    </PortfolioAIChatContext.Provider>
  );
}

export function useAIChat(): PortfolioAIChatContextType {
  const ctx = useContext(PortfolioAIChatContext);
  if (!ctx) throw new Error('useAIChat must be used within a PortfolioAIChatProvider');
  return ctx;
}
