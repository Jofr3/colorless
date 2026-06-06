import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_FONT_ID, FONT_STORAGE_KEY, fontFamilyFor } from "./fonts";

type FontContextValue = {
  fontId: string;
  setFontId: (id: string) => void;
};

const FontContext = createContext<FontContextValue | null>(null);

function readStoredFontId(): string {
  try {
    return localStorage.getItem(FONT_STORAGE_KEY) ?? DEFAULT_FONT_ID;
  } catch {
    return DEFAULT_FONT_ID;
  }
}

// Holds the app-wide font choice, persists it, and applies it as an inline
// font-family on <body> (which every element inherits). Mounted above the
// router so the setting takes effect on every route. The Google Fonts files
// themselves are loaded in index.html; this only switches between them.
export function FontProvider({ children }: { children: ReactNode }) {
  const [fontId, setFontIdState] = useState(readStoredFontId);

  // Layout effect so the font is applied before the browser paints — no flash
  // on first load or when switching in settings.
  useLayoutEffect(() => {
    document.body.style.fontFamily = fontFamilyFor(fontId);
  }, [fontId]);

  const setFontId = useCallback((id: string) => {
    setFontIdState(id);
    try {
      localStorage.setItem(FONT_STORAGE_KEY, id);
    } catch {
      // Storage can fail (private mode, quota) — the choice still applies for
      // this session, it just won't persist.
    }
  }, []);

  const value = useMemo(() => ({ fontId, setFontId }), [fontId, setFontId]);

  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

export function useFont(): FontContextValue {
  const ctx = useContext(FontContext);
  if (!ctx) throw new Error("useFont must be used within <FontProvider>");
  return ctx;
}
