import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

// portfolio-ai's SYSTEM_PROMPT (supabase/functions/portfolio-ai/index.ts) leans on GFM tables
// and short bullet points for anything data-heavy — holdings, exposure breakdowns, risk metrics,
// benchmark comparisons. Plain react-markdown renders those as bare <table>/<p> tags; this module
// only adds presentation on top of that same markdown (styled cards for tables, callouts for
// blockquotes, sign-colored numeric cells) — the SSE contract and the markdown content itself are
// untouched. See PR discussion: "Wire A2UI into AI Agent frontend response" — a real A2UI renderer
// needs a structured JSON payload the backend doesn't emit, so this is a frontend-only,
// A2UI-inspired upgrade rather than the actual protocol.

/** Flattens a react-markdown children tree back to plain text so cell content can be pattern-matched
 * (sign, currency, %) regardless of how many inline nodes (bold, links, etc.) it's made of. */
function flattenText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return flattenText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

type Sentiment = 'positive' | 'negative' | null;

/** A leading +/− sign is the only reliable gain/loss signal the model's own formatting gives us
 * (bare positive numbers carry no sign) — so this only ever flags explicit "+2.3%" / "-₹4,500"
 * style cells, never guesses from magnitude or column context. */
function cellSentiment(text: string): Sentiment {
  const t = text.trim();
  if (!t) return null;
  if (/^[-−–]\s*[₹$%\d]/.test(t)) return 'negative';
  if (/^\+\s*[₹$%\d]/.test(t)) return 'positive';
  return null;
}

/** Right-align + tabular-nums for cells that are (optionally signed/currency/percent) numbers, so
 * a column of ₹ figures or percentages lines up like a real financial table instead of prose. */
function looksNumeric(text: string): boolean {
  return /^[+\-−–]?\s*[₹$]?\s*[\d,]+(\.\d+)?\s*%?$/.test(text.trim());
}

const components: Components = {
  table: ({ children }) => (
    <div className="not-prose my-3 overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs sm:text-sm">{children}</table>
      </div>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border/50 last:border-b-0 even:bg-muted/10 hover:bg-primary/5 transition-colors">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => {
    const text = flattenText(children);
    const sentiment = cellSentiment(text);
    return (
      <td
        className={cn(
          'whitespace-nowrap px-3 py-2 text-foreground/90',
          looksNumeric(text) && 'text-right font-mono tabular-nums',
          sentiment === 'positive' && 'text-emerald-500 font-medium',
          sentiment === 'negative' && 'text-rose-500 font-medium',
        )}
      >
        {children}
      </td>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-2.5 rounded-r-md border-l-2 border-primary/40 bg-primary/5 py-2 pl-3 pr-2 text-foreground/90 italic">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className ?? '');
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
        {children}
      </code>
    );
  },
};

/** Drop-in replacement for the old `<ReactMarkdown remarkPlugins={[remarkGfm]}>` used directly in
 * PortfolioAI.tsx — same markdown in, same GFM support, just styled tables/callouts/inline code
 * instead of bare typography-plugin defaults. */
export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-ul:my-1.5 prose-strong:text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
