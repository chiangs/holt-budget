import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

export type ThemeChoice = "system" | "hearth-light" | "hearth-dark";
const themeChoices: readonly ThemeChoice[] = ["system", "hearth-light", "hearth-dark"];
const storageKey = "holt-appearance";

interface Stored {
  theme: ThemeChoice;
  glass: boolean;
}

function load(): Stored {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (raw !== null && typeof raw === "object") {
      const { theme, glass } = raw as Partial<Stored>;
      return { theme: themeChoices.includes(theme as ThemeChoice) ? (theme as ThemeChoice) : "system", glass: glass === true };
    }
  } catch {
    // Storage can be blocked or hold something else. Fall through to the defaults.
  }
  return { theme: "system", glass: false };
}

function save(value: Stored): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // The choice then lasts until the window closes.
  }
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}

interface Appearance {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  glass: boolean;
  setGlass: (glass: boolean) => void;
  /** True when the desktop asks for less transparency. Glass is then off whatever the choice. */
  glassBlocked: boolean;
}

const AppearanceContext = createContext<Appearance | null>(null);

/** Sets data-theme and data-glass on <html>, from the choice, the desktop's colour scheme and its transparency preference. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState(load);
  const desktopIsDark = useMedia("(prefers-color-scheme: dark)");
  const glassBlocked = useMedia("(prefers-reduced-transparency: reduce)");

  const theme = stored.theme === "system" ? (desktopIsDark ? "hearth-dark" : "hearth-light") : stored.theme;
  const glassOn = stored.glass && !glassBlocked;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.glass = glassOn ? "on" : "off";
  }, [theme, glassOn]);

  const update = useCallback((next: Stored) => {
    setStored(next);
    save(next);
  }, []);

  const value = useMemo<Appearance>(
    () => ({
      theme: stored.theme,
      setTheme: (next) => update({ ...stored, theme: next }),
      glass: stored.glass,
      setGlass: (next) => update({ ...stored, glass: next }),
      glassBlocked,
    }),
    [stored, glassBlocked, update],
  );
  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}

export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext);
  if (value === null) throw new Error("useAppearance needs an AppearanceProvider");
  return value;
}
