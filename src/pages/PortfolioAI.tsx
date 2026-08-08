import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Send, Bot, User, Zap, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThemeToggle } from '@/components/ThemeToggle';

type Msg = { role: 'user' | 'assistant'; content: string };

const PRESET_QUESTIONS = [
  { icon: '⚠️', text: 'What is my biggest risk right now?', cat: 'Risk Overview' },
  { icon: '🏦', text: 'How bad would a 20% market crash hit me?', cat: 'Stress Testing' },
  { icon: '📊', text: 'Give me a full portfolio summary with exposure breakdown.', cat: 'Portfolio Summary' },
  { icon: '🎯', text: 'Am I too concentrated in any one stock?', cat: 'Concentration Risk' },
  { icon: '📈', text: 'Which are my top gainers and losers?', cat: 'Performance' },
  { icon: '🌍', text: 'What is my geographic and category exposure?', cat: 'Exposure Analysis' },
  { icon: '💰', text: 'What would happen if I need to liquidate right now?', cat: 'Liquidity' },
  { icon: '🔄', text: 'Suggest a rebalancing strategy for my portfolio.', cat: 'Strategy' },
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
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
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
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Msg = { role: 'user', content: text.trim() };
    const allMsgs = [...messages, userMsg];
    setMessages(allMsgs);
    setInput('');
    setIsLoading(true);
    setToolStatus(null);

    let assistantSoFar = '';
    const upsert = (chunk: string) => {
      setToolStatus(null); // first text chunk means tool resolution is done
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: 'assistant', content: assistantSoFar }];
      });
    };

    const finish = (attribution?: string) => {
      if (attribution) {
        assistantSoFar += `\n\n---\n*🤖 Response by **${attribution}***\n`;
        setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
      }
      setIsLoading(false);
      setToolStatus(null);
    };

    try {
      await streamChat({
        messages: allMsgs,
        onDelta: upsert,
        onToolCall: (name) => setToolStatus(name.replace(/_/g, ' ')),
        onDone: finish,
        onError: (msg) => {
          setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
          setIsLoading(false);
          setToolStatus(null);
        },
      });
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Connection error. Please try again.' }]);
      setIsLoading(false);
      setToolStatus(null);
    }
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-sm font-bold text-foreground">Portfolio Intelligence AI</h1>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-mono">
              MCP Connected
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="flex-1 flex max-w-6xl mx-auto w-full">
        {/* Sidebar — preset questions */}
        <div className="w-80 border-r border-border flex-shrink-0 flex flex-col bg-card/50 hidden md:flex">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-primary">
              <MessageSquare className="w-3 h-3 inline mr-1.5" />
              Try these questions
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {PRESET_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => send(q.text)}
                disabled={isLoading}
                className="w-full text-left px-4 py-3.5 border-b border-border/50 hover:bg-primary/5 transition-colors disabled:opacity-50 group"
              >
                <div className="flex gap-2.5 items-start">
                  <span className="text-base flex-shrink-0 mt-0.5">{q.icon}</span>
                  <div>
                    <p className="text-xs text-foreground/80 italic leading-relaxed group-hover:text-foreground transition-colors">
                      "{q.text}"
                    </p>
                    <p className="text-[9px] font-bold tracking-[0.16em] uppercase text-primary mt-1">{q.cat}</p>
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
                <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <Bot className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-lg font-bold text-foreground mb-2">Portfolio Intelligence AI</h2>
                <p className="text-sm text-muted-foreground max-w-md mb-6">
                  Connected to your live portfolio via MCP. Ask anything about your holdings,
                  risk exposure, stress scenarios, or get actionable insights — all grounded in your real data.
                </p>
                {/* Mobile preset buttons */}
                <div className="grid grid-cols-2 gap-2 w-full max-w-lg md:hidden">
                  {PRESET_QUESTIONS.slice(0, 4).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => send(q.text)}
                      className="text-left px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-primary/5 transition-colors"
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
                <div className={`w-7 h-7 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${
                  msg.role === 'user'
                    ? 'bg-primary/10 border border-primary/30 text-primary'
                    : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-500'
                }`}>
                  {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] tracking-[0.12em] uppercase text-muted-foreground font-semibold mb-1">
                    {msg.role === 'user' ? 'You' : 'Portfolio AI'}
                  </p>
                  <div className={`rounded-md px-3.5 py-2.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary/8 border border-primary/20 text-foreground italic'
                      : 'bg-card border border-border text-foreground'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-ul:my-1.5 prose-strong:text-foreground prose-table:my-3 prose-th:border prose-th:border-border prose-th:bg-muted/50 prose-th:px-2.5 prose-th:py-1.5 prose-td:border prose-td:border-border prose-td:px-2.5 prose-td:py-1.5">
                        <div className="overflow-x-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      msg.content
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
                    {toolStatus ? `Calling ${toolStatus} via MCP...` : 'Thinking...'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-4">
            <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about your portfolio..."
                disabled={isLoading}
                className="flex-1 bg-card border border-border rounded-md px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 transition-colors"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-4 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortfolioAI;
