export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "bondeth.theme";
export const SIDEBAR_STORAGE_KEY = "bondeth.sidebar";

/**
 * Runs inline in <head> before the first paint. It applies the saved theme (or the
 * system preference) and the sidebar's collapsed state as attributes on <html>, so
 * CSS renders the right colours and layout immediately, with no flash or layout jump.
 */
export const themeInitScript = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.setAttribute("data-theme",t);d.setAttribute("data-sidebar",localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed"?"collapsed":"expanded")}catch(e){}})()`;

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the setting still applies for this visit.
  }
}

export function getTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  save(THEME_STORAGE_KEY, theme);
}

export function toggleSidebar(): void {
  const next = document.documentElement.getAttribute("data-sidebar") === "collapsed" ? "expanded" : "collapsed";
  document.documentElement.setAttribute("data-sidebar", next);
  save(SIDEBAR_STORAGE_KEY, next);
}
