import { useEffect, useState } from 'react';

const readIsDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/**
 * Tracks whether the `dark` class is on <html>. ThemeToggle owns the theme by toggling that class
 * directly (no next-themes ThemeProvider is mounted), so anything that needs to follow the theme —
 * e.g. the Sonner toaster — has to observe the class rather than ask a theme context.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(readIsDark);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
