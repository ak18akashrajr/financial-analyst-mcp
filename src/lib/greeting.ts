export interface Greeting {
  title: string;
  subtitle: string;
  emoji: string;
}

export function getDynamicGreeting(name: string, now = new Date()): Greeting {
  const day = now.getDay(); // 0 Sun - 6 Sat
  const hour = now.getHours();
  const period: 'morning' | 'afternoon' | 'evening' | 'night' =
    hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[day];

  // Curated micro-bank keyed by `${day}-${period}`. Full English, elite/sharp,
  // timing-relevant, addressed to whoever's portfolio is active (see the
  // `name` param — resolved by the caller from the family member switcher).
  const bank: Record<string, Greeting> = {
    'Monday-morning': {
      title: `New week, new leverage, ${name}. ⚡`,
      subtitle: 'The market pays patience, not panic. Set the tone for the week right now.',
      emoji: '⚡',
    },
    'Monday-afternoon': {
      title: `Momentum check, ${name}. 📊`,
      subtitle: 'Halfway through Monday — compounding doesn’t care about your mood. Stay the course.',
      emoji: '📊',
    },
    'Monday-evening': {
      title: `Books closed. Head held high, ${name}. 🌆`,
      subtitle: 'One session is a rounding error on a decades-long chart. Reset and reload.',
      emoji: '🌆',
    },
    'Tuesday-morning': {
      title: `Sharp start, ${name}. 🎯`,
      subtitle: 'Discipline compounds faster than any single trade. Show up like it matters — it does.',
      emoji: '🎯',
    },
    'Wednesday-morning': {
      title: `Midweek command, ${name}. 🐪`,
      subtitle: 'You’re not built in a day — you’re built in the days nobody’s watching.',
      emoji: '🐪',
    },
    'Wednesday-afternoon': {
      title: `Stay locked in, ${name}. 📈`,
      subtitle: 'Review the plan, not the price. Elite portfolios are boring on purpose.',
      emoji: '📈',
    },
    'Thursday-morning': {
      title: `Thursday thrust, ${name}. 🚀`,
      subtitle: 'Almost there. Quiet patience is the loudest edge you have.',
      emoji: '🚀',
    },
    'Thursday-evening': {
      title: `One session from the weekend, ${name}. 🌇`,
      subtitle: 'Finish strong. Tomorrow’s the last lap before you clock out in style.',
      emoji: '🌇',
    },
    'Friday-morning': {
      title: `Friday, but markets don’t clock out, ${name}. 🔥`,
      subtitle: 'Close the week like a professional — review, rebalance, then go enjoy it.',
      emoji: '🔥',
    },
    'Friday-evening': {
      title: `Weekend mode unlocked, ${name}. 🥂`,
      subtitle: 'Your portfolio keeps working while you don’t. Go enjoy the well-earned break.',
      emoji: '🥂',
    },
    'Saturday-morning': {
      title: `Strategist mode, ${name}. 🧠`,
      subtitle: 'No noise today — the best portfolios are shaped on quiet weekends like this one.',
      emoji: '🧠',
    },
    'Saturday-evening': {
      title: `Recharge mode, ${name}. 🛋️`,
      subtitle: 'Rest is part of the strategy, not a break from it. Markets reopen Monday — so will you.',
      emoji: '🛋️',
    },
    'Sunday-morning': {
      title: `Sunday reset, ${name}. ☕`,
      subtitle: 'Review the week, journal the wins and misses, and line up the next move.',
      emoji: '☕',
    },
    'Sunday-evening': {
      title: `Eve of the grind, ${name}. 🌙`,
      subtitle: 'Set tomorrow’s intent tonight. A sharp plan beats a scramble every time.',
      emoji: '🌙',
    },
  };

  return bank[`${dayName}-${period}`] ?? getFallback(name, period);
}

function getFallback(name: string, period: 'morning' | 'afternoon' | 'evening' | 'night'): Greeting {
  const fallback: Record<typeof period, Greeting> = {
    morning: {
      title: `Rise and build, ${name}. ☀️`,
      subtitle: 'Every great portfolio starts with one disciplined morning. This is yours.',
      emoji: '☀️',
    },
    afternoon: {
      title: `Eyes on the horizon, ${name}. 📈`,
      subtitle: 'Markets are moving. Make sure your discipline is moving with them.',
      emoji: '📈',
    },
    evening: {
      title: `Evening debrief, ${name}. 🌆`,
      subtitle: 'Close the day with clarity — green or red, the plan stays the plan.',
      emoji: '🌆',
    },
    night: {
      title: `Still up, ${name}? 🌙`,
      subtitle: 'Sleep is the highest-leverage asset you own. Tomorrow’s markets need a sharp you.',
      emoji: '🌙',
    },
  };
  return fallback[period];
}
