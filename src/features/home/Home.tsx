import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { DecksIcon, SettingsIcon, SimulatorIcon, SwordsIcon } from "../../components/icons";

type MenuItem = {
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const MENU_ITEMS: MenuItem[] = [
  { to: "/simulator", label: "Simulator", Icon: SimulatorIcon },
  { to: "/lobby/create", label: "Online", Icon: SwordsIcon },
  { to: "/decks", label: "Decks", Icon: DecksIcon },
  { to: "/settings", label: "Settings", Icon: SettingsIcon },
];

function MenuCard({ item }: { item: MenuItem }) {
  const { to, label, Icon } = item;
  return (
    <Link
      to={to}
      className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl bg-white/[0.045] p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_30px_rgba(0,0,0,0.40)] ring-1 ring-inset ring-white/10 backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.07] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_14px_40px_rgba(0,0,0,0.50)] hover:ring-white/15 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.98]"
    >
      <Icon className="h-11 w-11 opacity-80 transition-opacity duration-200 group-hover:opacity-100" />
      <span className="text-base font-semibold text-white/90">{label}</span>
    </Link>
  );
}

export function Home() {
  return (
    <AppBackdrop>
      <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center justify-center px-6 py-12">
        <nav aria-label="Main menu" className="grid w-full grid-cols-2 gap-4">
          {MENU_ITEMS.map((item) => (
            <MenuCard key={item.to} item={item} />
          ))}
        </nav>
      </main>
    </AppBackdrop>
  );
}
