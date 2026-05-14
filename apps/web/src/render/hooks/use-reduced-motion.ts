/**
 * useReducedMotion — respects prefers-reduced-motion media query.
 *
 * Returns true when the user has requested reduced motion in their OS/browser
 * settings. Components use this to disable or replace animations with
 * instant transitions.
 *
 * Implementation:
 *   MediaQueryList.matches on mount + event listener for changes.
 *   The result is a primitive boolean — React.memo bails out when unchanged.
 *
 * Usage:
 *   const reduced = useReducedMotion();
 *   // instead of: animation: 'pulse 1s infinite'
 *   // use:        animation: reduced ? 'none' : 'pulse 1s infinite'
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return reduced;
}
