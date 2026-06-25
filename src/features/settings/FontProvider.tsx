import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { readPersisted, writePersisted } from "../../lib/persistedState";
import { DEFAULT_FONT_ID, FONT_STORAGE_KEY, fontFamilyFor } from "./fonts";

type FontContextValue = {
  fontId: string;
  setFontId: (id: string) => void;
};

const FontContext = createContext<FontContextValue | null>(null);

// Any stored string is accepted; fontFamilyFor defaults gracefully on an
// unknown id, so validation isn't needed here.
const readStoredFontId = () => readPersisted(FONT_STORAGE_KEY, (raw) => raw, DEFAULT_FONT_ID);

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
    writePersisted(FONT_STORAGE_KEY, id);
  }, []);

  const value = useMemo(() => ({ fontId, setFontId }), [fontId, setFontId]);

  return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

export function useFont(): FontContextValue {
  const ctx = useContext(FontContext);
  if (!ctx) throw new Error("useFont must be used within <FontProvider>");
  return ctx;
}
