import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Send, Bot, User, Zap, MessageSquare, Check, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThemeToggle } from '@/components/ThemeToggle';
import { supabase } from '@/integrations/supabase/client';

// `toolTrace` records every real MCP tool this specific answer was grounded
// in, in call order — attached once the answer finishes streaming so it's
// visible after the fact too, not just as a transient "thinking" indicator.
type Msg = { role: 'user' | 'assistant'; content: string; toolTrace?: string[] };

/** "get_portfolio_summary" -> "Get Portfolio Summary" — for display only, the
 * real tool name is what's actually sent to/from MCP. */
function humanizeToolName(name: string): string {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Each preset maps 1:1 (or a small combination) onto a real MCP tool in
// _shared/mcp-tools.ts, so every one of these gets a real, data-grounded
// answer rather than the model reasoning in a vacuum. Two prior entries got
// dropped for that reason instead of just reworded: "What would happen if I
// need to liquidate right now?" has no backing tool (no liquidation/tax-impact
// calc exists), and "Suggest a rebalancing strategy" directly invites the
// recommendation-style answer portfolio-ai's SYSTEM_PROMPT is instructed to
// decline ("Never recommend a trade") — a preset shouldn't set the user up
// for a guardrail refusal. Replaced with get_risk_metrics and
// compare_to_benchmark, both real tools that had no preset pointing at them.
export const PRESET_QUESTIONS = [
  { icon: '⚠️', text: 'What is my biggest risk right now?', cat: 'Risk Overview' },
  { icon: '🏦', text: 'How bad would a 20% market crash hit me?', cat: 'Stress Testing' },
  { icon: '📊', text: 'Give me a full portfolio summary with exposure breakdown.', cat: 'Portfolio Summary' },
  { icon: '🎯', text: 'Am I too concentrated in any one stock or sector?', cat: 'Concentration Risk' },
  { icon: '📈', text: 'Which holdings are contributing the most to my P&L?', cat: 'Performance' },
  { icon: '📉', text: "How volatile is my portfolio, and what's my beta versus NIFTY 50?", cat: 'Risk Metrics' },
  { icon: '🏆', text: 'How has my portfolio performed against NIFTY 50 over the last 90 days?', cat: 'Benchmark' },
  { icon: '🚨', text: 'Have I breached any of my concentration or exposure limits?', cat: 'Limit Breaches' },
];

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
  onDelta,
  onToolCall,
  onDone,
  onError,
}: {
  messages: Msg[];
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
    body: JSON.stringify({ messages }),
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

const PortfolioAI = () => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Every real MCP tool call for the in-flight turn, in order — accumulates
  // rather than overwrites, so the live indicator shows the whole trace
  // building up (earlier calls checked off, the newest one still spinning)
  // instead of hiding everything but whatever tool happens to be running now.
  const [liveToolCalls, setLiveToolCalls] = useState<string[]>([]);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-grow the composer as the draft gets longer, capped so a huge paste
  // doesn't push the send button off-screen — it switches to an internal
  // scrollbar past that height instead of growing forever.
  const MAX_TEXTAREA_HEIGHT = 200;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Msg = { role: 'user', content: text.trim() };
    const allMsgs = [...messages, userMsg];
    setMessages(allMsgs);
    setInput('');
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
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  // Enter sends; Shift+Enter inserts a newline — the standard chat-composer
  // convention, needed now that this is a multi-line textarea rather than a
  // single-line input.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border/80 bg-card/70 backdrop-blur-md sticky top-0 z-50 supports-[backdrop-filter]:bg-card/50">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 -ml-1 hover:bg-muted/60"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2.5">
              <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-emerald-500/20 border border-primary/20">
                <Bot className="w-3.5 h-3.5 text-primary" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-card animate-pulse" />
              </div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">Portfolio Intelligence AI</h1>
            </div>
            <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-mono tracking-wide">
              MCP Connected
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="flex-1 flex max-w-6xl mx-auto w-full">
        {/* Sidebar — preset questions */}
        <div className="w-80 border-r border-border/80 flex-shrink-0 flex flex-col bg-card/30 hidden md:flex">
          <div className="px-4 py-3.5 border-b border-border/80">
            <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-primary flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" />
              Try these questions
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {PRESET_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => send(q.text)}
                disabled={isLoading}
                className="w-full text-left px-4 py-3.5 border-b border-border/40 hover:bg-primary/5 transition-colors duration-200 disabled:opacity-50 group relative"
              >
                <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform duration-200 origin-center" />
                <div className="flex gap-2.5 items-start">
                  <span className="text-base flex-shrink-0 mt-0.5">{q.icon}</span>
                  <div>
                    <p className="text-xs text-foreground/80 italic leading-relaxed group-hover:text-foreground transition-colors">
                      "{q.text}"
                    </p>
                    <p className="text-[9px] font-bold tracking-[0.16em] uppercase text-primary/80 mt-1">{q.cat}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/15 to-emerald-500/15 border border-primary/20 flex items-center justify-center mb-4 shadow-sm">
                  <Bot className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-lg font-bold text-foreground mb-2 tracking-tight">Portfolio Intelligence AI</h2>
                <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
                  Connected to your live portfolio via MCP. Ask anything about your holdings,
                  risk exposure, stress scenarios, or get actionable insights — all grounded in your real data.
                </p>
                {/* Mobile preset buttons */}
                <div className="grid grid-cols-2 gap-2 w-full max-w-lg md:hidden">
                  {PRESET_QUESTIONS.slice(0, 4).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => send(q.text)}
                      className="text-left px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 transition-colors"
                    >
                      <span className="text-sm mr-1">{q.icon}</span>
                      <span className="text-[11px] text-muted-foreground">{q.cat}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className="flex gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center text-[10px] font-bold shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-primary/10 border border-primary/30 text-primary'
                    : 'bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border border-emerald-500/30 text-emerald-500'
                }`}>
                  {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] tracking-[0.12em] uppercase text-muted-foreground font-semibold mb-1">
                    {msg.role === 'user' ? 'Ak' : 'Portfolio AI'}
                  </p>
                  {msg.role === 'assistant' && msg.toolTrace && msg.toolTrace.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1 flex-wrap">
                      <Zap className="w-3 h-3 flex-shrink-0" />
                      Used {msg.toolTrace.length} MCP tool{msg.toolTrace.length > 1 ? 's' : ''}:{' '}
                      {msg.toolTrace.map(humanizeToolName).join(' → ')}
                    </p>
                  )}
                  <div className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed transition-shadow ${
                    msg.role === 'user'
                      ? 'bg-primary/8 border border-primary/20 text-foreground italic'
                      : 'bg-card border border-border text-foreground shadow-sm'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-ul:my-1.5 prose-strong:text-foreground prose-table:my-3 prose-th:border prose-th:border-border prose-th:bg-muted/50 prose-th:px-2.5 prose-th:py-1.5 prose-td:border prose-td:border-border prose-td:px-2.5 prose-td:py-1.5">
                        <div className="overflow-x-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded flex-shrink-0 flex items-center justify-center bg-emerald-500/10 border border-emerald-500/30 text-emerald-500">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                {liveToolCalls.length === 0 ? (
                  <div className="flex items-center gap-1 py-2">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
                          style={{ animationDelay: `${i * 0.18}s` }}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground ml-2 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      Understanding your question...
                    </span>
                  </div>
                ) : (
                  // Every real MCP tool call so far this turn, in order — the
                  // running one still spinning, earlier ones checked off, so
                  // the trace visibly builds up rather than replacing itself
                  // and hiding what already happened.
                  <div className="flex flex-col gap-1 py-2">
                    {liveToolCalls.map((name, idx) => {
                      const isRunning = idx === liveToolCalls.length - 1;
                      return (
                        <span key={idx} className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                          {isRunning ? (
                            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                          ) : (
                            <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                          )}
                          {isRunning ? 'Calling' : 'Called'} <span className="font-medium">{humanizeToolName(name)}</span> via MCP{isRunning ? '...' : ''}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border/80 bg-card/40 backdrop-blur-sm p-4">
            <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto items-end">
              <div className="flex-1 bg-card border border-border rounded-xl px-1 shadow-sm focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition-colors">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your portfolio..."
                  disabled={isLoading}
                  rows={1}
                  className="w-full resize-none bg-transparent px-2.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 leading-relaxed"
                  style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:opacity-90 hover:shadow-md active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 transition-all flex items-center gap-1.5 h-[42px]"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
            <p className="text-[10px] text-muted-foreground/70 text-center mt-2 max-w-3xl mx-auto">
              Enter to send · Shift + Enter for a new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortfolioAI;
