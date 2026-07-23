import { useEffect, useState, useCallback } from "react";

const KEY = "sh_theme";
export type ThemeMode = "light" | "dark";

function apply(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(KEY) as ThemeMode) || "light";
  });
  useEffect(() => {
    apply(mode);
    try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
  }, [mode]);
  const toggle = useCallback(() => setMode((m) => (m === "dark" ? "light" : "dark")), []);
  return { mode, setMode, toggle };
}
