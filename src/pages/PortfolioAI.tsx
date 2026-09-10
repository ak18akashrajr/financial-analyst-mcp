import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Bot,
  User,
  Zap,
  MessageSquare,
  Check,
  Loader2,
  AlertTriangle,
  Building2,
  BarChart3,
  Target,
  TrendingUp,
  Activity,
  Trophy,
  AlertOctagon,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AssistantMarkdown } from '@/components/portfolio-ai/AssistantMarkdown';
import { useAIChat, type ModelPreference } from '@/contexts/PortfolioAIChatContext';

const MODEL_PREFERENCE_OPTIONS: { value: ModelPreference; label: string }[] = [
  { value: 'auto', label: 'Auto (default)' },
  { value: 'nemotron', label: 'NVIDIA Nemotron 3 Ultra — free, rate-limited' },
  { value: 'minimax', label: 'MiniMax M2.7 — free, rate-limited' },
];

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
//
// Icons are plain lucide components (matching SideNav's navGroups shape),
// not emoji — the app's design language is the black & white professional,
// minimalistic one documented in Updates.tsx's changelog, and colorful emoji
// read as decorative/childish against that.
export const PRESET_QUESTIONS = [
  { icon: AlertTriangle, text: 'What is my biggest risk right now?', cat: 'Risk Overview' },
  { icon: Building2, text: 'How bad would a 20% market crash hit me?', cat: 'Stress Testing' },
  { icon: BarChart3, text: 'Give me a full portfolio summary with exposure breakdown.', cat: 'Portfolio Summary' },
  { icon: Target, text: 'Am I too concentrated in any one stock or sector?', cat: 'Concentration Risk' },
  { icon: TrendingUp, text: 'Which holdings are contributing the most to my P&L?', cat: 'Performance' },
  { icon: Activity, text: "How volatile is my portfolio, and what's my beta versus NIFTY 50?", cat: 'Risk Metrics' },
  { icon: Trophy, text: 'How has my portfolio performed against NIFTY 50 over the last 90 days?', cat: 'Benchmark' },
  { icon: AlertOctagon, text: 'Have I breached any of my concentration or exposure limits?', cat: 'Limit Breaches' },
];

const PortfolioAI = () => {
  // Conversation state lives in PortfolioAIChatContext (mounted once in
  // AppLayout, which persists across every protected-page navigation) rather
  // than local useState here — this page itself still unmounts on every route
  // change like any other route, but the chat history no longer lives on it.
  const { messages, isLoading, liveToolCalls, modelPreference, setModelPreference, send } = useAIChat();
  const [input, setInput] = useState('');
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

  // Composer submit just hands the draft off to the context's `send` and
  // clears the local input — the actual request/streaming/message-list
  // bookkeeping all lives in PortfolioAIChatContext now.
  const submit = (text: string) => {
    if (!text.trim() || isLoading) return;
    send(text);
    setInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  // Enter sends; Shift+Enter inserts a newline — the standard chat-composer
  // convention, needed now that this is a multi-line textarea rather than a
  // single-line input.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/80 bg-card/70 backdrop-blur-md sticky top-0 z-50 supports-[backdrop-filter]:bg-card/50">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/overview"
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

      <div className="flex-1 flex max-w-6xl mx-auto w-full min-h-0">
        {/* Sidebar — preset questions */}
        <div className="w-80 border-r border-border/80 flex-shrink-0 flex flex-col bg-card/30 hidden md:flex min-h-0">
          <div className="px-4 py-3.5 border-b border-border/80">
            <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/70 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" />
              Try these questions
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {PRESET_QUESTIONS.map((q, i) => {
              const Icon = q.icon;
              return (
                <button
                  key={i}
                  onClick={() => send(q.text)}
                  disabled={isLoading}
                  className="w-full text-left px-4 py-3.5 border-b border-border/40 hover:bg-accent transition-colors disabled:opacity-50 group"
                >
                  <div className="flex gap-2.5 items-start">
                    <Icon className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <div>
                      <p className="text-xs text-foreground/80 leading-relaxed group-hover:text-foreground transition-colors">
                        {q.text}
                      </p>
                      <p className="text-[9px] font-semibold tracking-wider uppercase text-muted-foreground/70 mt-1">{q.cat}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
                  {PRESET_QUESTIONS.slice(0, 4).map((q, i) => {
                    const Icon = q.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => send(q.text)}
                        className="flex items-center gap-1.5 text-left px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-accent transition-colors"
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground">{q.cat}</span>
                      </button>
                    );
                  })}
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
                      <AssistantMarkdown content={msg.content} />
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
            <div className="max-w-3xl mx-auto mb-2 flex items-center gap-1.5">
              <label htmlFor="model-preference" className="text-[10px] text-muted-foreground/70">
                Model:
              </label>
              <select
                id="model-preference"
                value={modelPreference}
                onChange={(e) => setModelPreference(e.target.value as ModelPreference)}
                disabled={isLoading}
                className="text-[10px] bg-transparent border border-border/60 rounded-md px-1.5 py-0.5 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
              >
                {MODEL_PREFERENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
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
