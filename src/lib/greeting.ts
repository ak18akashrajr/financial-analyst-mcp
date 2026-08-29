export interface GreetingStats {
  /** Overall unrealized P/L %, i.e. PortfolioSummary.totalPnlPercent. */
  totalPnlPercent?: number | null;
  /**
   * Annualized return, i.e. PortfolioSummary.xirr — a decimal fraction (0.0661 for 6.61%),
   * matching what XirrDetailsCard receives. This module multiplies by 100 before display.
   */
  xirr?: number | null;
}

export interface GreetingStat {
  /** e.g. "+3.5% · 6.6% XIRR" — compact, meant for a colored pill, not a sentence. */
  text: string;
  positive: boolean;
}

export interface Greeting {
  title: string;
  subtitle: string;
  emoji: string;
  /** null when stats weren't provided, or totalPnlPercent is missing/non-finite. */
  stat: GreetingStat | null;
}

export function getDynamicGreeting(now = new Date(), stats?: GreetingStats): Greeting {
  const day = now.getDay(); // 0 Sun - 6 Sat
  const hour = now.getHours();
  const period: 'morning' | 'afternoon' | 'evening' | 'night' =
    hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[day];

  // Curated micro-bank keyed by `${day}-${period}`. Full English, elite/sharp,
  // timing-relevant, addressed to Ak / Ak18 / Akash on rotation.
  const bank: Record<string, { title: string; subtitle: string; emoji: string }> = {
    'Monday-morning': {
      title: 'New week, new leverage, Ak. ⚡',
      subtitle: 'The market pays patience, not panic. Set the tone for the week right now.',
      emoji: '⚡',
    },
    'Monday-afternoon': {
      title: 'Momentum check, Akash. 📊',
      subtitle: 'Halfway through Monday — compounding doesn’t care about your mood. Stay the course.',
      emoji: '📊',
    },
    'Monday-evening': {
      title: 'Books closed. Head held high, Ak18. 🌆',
      subtitle: 'One session is a rounding error on a decades-long chart. Reset and reload.',
      emoji: '🌆',
    },
    'Tuesday-morning': {
      title: 'Sharp start, Ak. 🎯',
      subtitle: 'Discipline compounds faster than any single trade. Show up like it matters — it does.',
      emoji: '🎯',
    },
    'Wednesday-morning': {
      title: 'Midweek command, Akash. 🐪',
      subtitle: 'You’re not built in a day — you’re built in the days nobody’s watching.',
      emoji: '🐪',
    },
    'Wednesday-afternoon': {
      title: 'Stay locked in, Ak18. 📈',
      subtitle: 'Review the plan, not the price. Elite portfolios are boring on purpose.',
      emoji: '📈',
    },
    'Thursday-morning': {
      title: 'Thursday thrust, Ak. 🚀',
      subtitle: 'Almost there. Quiet patience is the loudest edge you have.',
      emoji: '🚀',
    },
    'Thursday-evening': {
      title: 'One session from the weekend, Akash. 🌇',
      subtitle: 'Finish strong. Tomorrow’s the last lap before you clock out in style.',
      emoji: '🌇',
    },
    'Friday-morning': {
      title: 'Friday, but markets don’t clock out, Ak18. 🔥',
      subtitle: 'Close the week like a professional — review, rebalance, then go enjoy it.',
      emoji: '🔥',
    },
    'Friday-evening': {
      title: 'Weekend mode unlocked, Ak. 🥂',
      subtitle: 'Your portfolio keeps working while you don’t. Go enjoy the well-earned break.',
      emoji: '🥂',
    },
    'Saturday-morning': {
      title: 'Strategist mode, Akash. 🧠',
      subtitle: 'No noise today — the best portfolios are shaped on quiet weekends like this one.',
      emoji: '🧠',
    },
    'Saturday-evening': {
      title: 'Recharge mode, Ak18. 🛋️',
      subtitle: 'Rest is part of the strategy, not a break from it. Markets reopen Monday — so will you.',
      emoji: '🛋️',
    },
    'Sunday-morning': {
      title: 'Sunday reset, Ak. ☕',
      subtitle: 'Review the week, journal the wins and misses, and line up the next move.',
      emoji: '☕',
    },
    'Sunday-evening': {
      title: 'Eve of the grind, Akash. 🌙',
      subtitle: 'Set tomorrow’s intent tonight. A sharp plan beats a scramble every time.',
      emoji: '🌙',
    },
  };

  const exact = bank[`${dayName}-${period}`];
  const base = exact ?? getFallback(period);

  return { ...base, stat: buildStat(stats) };
}

function getFallback(period: 'morning' | 'afternoon' | 'evening' | 'night') {
  const fallback: Record<typeof period, { title: string; subtitle: string; emoji: string }> = {
    morning: {
      title: 'Rise and build, Ak. ☀️',
      subtitle: 'Every great portfolio starts with one disciplined morning. This is yours.',
      emoji: '☀️',
    },
    afternoon: {
      title: 'Eyes on the horizon, Akash. 📈',
      subtitle: 'Markets are moving. Make sure your discipline is moving with them.',
      emoji: '📈',
    },
    evening: {
      title: 'Evening debrief, Ak18. 🌆',
      subtitle: 'Close the day with clarity — green or red, the plan stays the plan.',
      emoji: '🌆',
    },
    night: {
      title: 'Still up, Ak? 🌙',
      subtitle: 'Sleep is the highest-leverage asset you own. Tomorrow’s markets need a sharp you.',
      emoji: '🌙',
    },
  };
  return fallback[period];
}

function buildStat(stats?: GreetingStats): GreetingStat | null {
  if (!stats) return null;
  const { totalPnlPercent, xirr } = stats;
  if (typeof totalPnlPercent !== 'number' || !Number.isFinite(totalPnlPercent)) return null;

  const positive = totalPnlPercent >= 0;
  const pnlStr = `${positive ? '+' : ''}${totalPnlPercent.toFixed(1)}%`;
  const xirrStr =
    typeof xirr === 'number' && Number.isFinite(xirr) ? ` · ${(xirr * 100).toFixed(1)}% XIRR` : '';
  return { text: `${pnlStr}${xirrStr}`, positive };
}
