import { Link } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { ArrowLeftIcon, SettingsIcon } from "../../components/icons";
import { BACK_ARROW_ICON, GLASS_GHOST_BUTTON, GLASS_ICON_TILE, GLASS_PANEL } from "../../lib/glass";
import { useFont } from "./FontProvider";
import { FONT_OPTIONS, fontFamilyValue } from "./fonts";
import { ProfileSection } from "./ProfileSection";

export function Settings() {
  const { fontId, setFontId } = useFont();

  return (
    <AppBackdrop>
      <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-6 px-6 py-12">
        <header className="flex items-center gap-3">
          <div className={`h-12 w-12 ${GLASS_ICON_TILE}`}>
            <SettingsIcon className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white/90">Settings</h1>
        </header>

        <ProfileSection />

        <section className={`rounded-2xl p-5 ${GLASS_PANEL}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white/90">Font</h2>
              <p className="text-sm text-muted">Typeface used across the app.</p>
            </div>
            <select
              value={fontId}
              onChange={(e) => setFontId(e.target.value)}
              aria-label="App font"
              className="cursor-pointer rounded-lg bg-white/[0.06] px-3 py-2 text-sm font-medium text-white/90 outline-none ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/50 motion-reduce:transition-none"
            >
              {FONT_OPTIONS.map((f) => (
                <option
                  key={f.id}
                  value={f.id}
                  style={{ fontFamily: fontFamilyValue(f.family) }}
                  className="bg-surface text-white"
                >
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Live preview — inherits the body font, which updates instantly. */}
          <p className="mt-4 border-t border-white/10 pt-4 text-lg text-white/80">
            The quick brown fox jumps over the lazy dog — 0123456789
          </p>
        </section>

        <Link
          to="/"
          className={`group inline-flex items-center gap-2 self-start rounded-full px-4 py-2 text-sm font-medium ${GLASS_GHOST_BUTTON}`}
        >
          <ArrowLeftIcon className={BACK_ARROW_ICON} />
          Back to home
        </Link>
      </main>
    </AppBackdrop>
  );
}
