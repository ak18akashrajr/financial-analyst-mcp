export function getDynamicGreeting(now = new Date()): { title: string; subtitle: string; emoji: string } {
  const day = now.getDay(); // 0 Sun - 6 Sat
  const hour = now.getHours();
  const period: 'morning' | 'afternoon' | 'evening' | 'night' =
    hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[day];

  // Curated micro-bank keyed by `${day}-${period}`
  const bank: Record<string, { title: string; subtitle: string; emoji: string }> = {
    'Monday-morning': {
      title: 'Rise and grind, Mapla! 💡',
      subtitle: 'The market rewards the patient and resilient. Embrace the volatility, focus on long-term goals. #MondayMotivation',
      emoji: '💡',
    },
    'Monday-afternoon': {
      title: 'Halfway through Monday — keep stacking! 📊',
      subtitle: 'Compounding doesn’t care about your mood. Show up, stay consistent.',
      emoji: '📊',
    },
    'Monday-evening': {
      title: 'Markets closed. Reflect & reset. 🌅',
      subtitle: 'A day in the green or red is just one tick on a long timeline.',
      emoji: '🌅',
    },
    'Tuesday-morning': {
      title: 'Tuesday tactics, Da Mapla! 🎯',
      subtitle: 'Small SIPs. Big future. Consistency > timing.',
      emoji: '🎯',
    },
    'Wednesday-morning': {
      title: 'Hump day hustle! 🐪',
      subtitle: 'You’re not building wealth in a day — you’re building it every day.',
      emoji: '🐪',
    },
    'Wednesday-afternoon': {
      title: 'Mid-week check-in 📈',
      subtitle: 'Trust the process. Review the plan, not the price.',
      emoji: '📈',
    },
    'Thursday-morning': {
      title: 'Thursday thrust! 🚀',
      subtitle: 'Patience compounds quietly. Keep going.',
      emoji: '🚀',
    },
    'Friday-morning': {
      title: 'Friday vibes, but markets don’t take days off! 🎉',
      subtitle: 'End the week strong — review, rebalance, relax.',
      emoji: '🎉',
    },
    'Friday-evening': {
      title: 'Weekend mode, but money still works. 🍻',
      subtitle: 'Your portfolio doesn’t clock out. Enjoy the well-earned break.',
      emoji: '🍻',
    },
    'Saturday-morning': {
      title: 'Saturday strategist 📚',
      subtitle: 'No market noise today — perfect time to plan and learn.',
      emoji: '📚',
    },
    'Saturday-evening': {
      title: 'Chill mode, Mapla 🛋️',
      subtitle: 'Rest is part of the plan. Markets reopen Monday.',
      emoji: '🛋️',
    },
    'Sunday-morning': {
      title: 'Sunday reset ☕',
      subtitle: 'Review, journal, and get ready to dominate the week ahead.',
      emoji: '☕',
    },
    'Sunday-evening': {
      title: 'Eve of Monday — set your intent. 🌙',
      subtitle: 'A small plan tonight beats a big regret tomorrow.',
      emoji: '🌙',
    },
  };

  const exact = bank[`${dayName}-${period}`];
  if (exact) return exact;

  // Fallback by time of day
  const fallback: Record<typeof period, { title: string; subtitle: string; emoji: string }> = {
    morning: {
      title: 'Vanakkam Da Mapla! ☀️',
      subtitle: 'Iniku market epdi iruku nu paklam vaariya 📈',
      emoji: '☀️',
    },
    afternoon: {
      title: 'Afternoon, Mapla! 📈',
      subtitle: 'Markets are moving. So should your discipline.',
      emoji: '📈',
    },
    evening: {
      title: 'Good evening, investor 🌆',
      subtitle: 'Close the day with gratitude — green or red.',
      emoji: '🌆',
    },
    night: {
      title: 'Late night, Mapla? 🌙',
      subtitle: 'Sleep is the best leverage. Tomorrow’s markets need a fresh you.',
      emoji: '🌙',
    },
  };
  return fallback[period];
}
