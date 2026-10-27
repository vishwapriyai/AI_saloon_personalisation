import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Every page change (menu, tab, button or back/forward) starts at the top of the new page.
 * Also resets inner scroll areas marked with data-scroll-root, and drops focus from the
 * clicked menu item so the next Tab starts at the top of the page.
 */
export const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    document.querySelectorAll<HTMLElement>('[data-scroll-root]').forEach((el) => { el.scrollTop = 0; });
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  }, [pathname]);

  return null;
};
