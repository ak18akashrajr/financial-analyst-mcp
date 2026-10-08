import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { titleForPath } from '@/lib/pageTitles';

/** Keeps document.title in step with the current route, so several open tabs are tellable apart. Renders nothing. */
export function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
  return null;
}
