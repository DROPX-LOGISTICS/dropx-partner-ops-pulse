/**
 * Intentionally empty: a full-page spinner here blanks the shell on every
 * menu navigation and after server-action redirects. Use NavigationProgress
 * (top bar) instead so pages stay interactive while the next route streams in.
 */
export default function Loading() {
  return null;
}
