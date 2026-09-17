import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [dark]);

  // Apply on mount
  useEffect(() => {
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
    <button
      onClick={() => setDark(!dark)}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors shrink-0"
    >
      {dark ? <Sun className="w-3.5 h-3.5 shrink-0" /> : <Moon className="w-3.5 h-3.5 shrink-0" />}
      {/* Narrower than ~400px (e.g. a 320-375px phone), MobileTopNav has no
          room for the label alongside the brand, family switcher, and
          logout button — the icon plus aria-label keep it usable there, and
          the label returns on wider phones and always on the desktop
          SideNav (which never renders below 768px anyway). */}
      <span className="hidden min-[400px]:inline">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
