/** A plain, theme-aware backdrop shared by page shells. */
export function Aurora() {
  return <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-paper" />;
}
