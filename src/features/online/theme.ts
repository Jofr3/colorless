// The two seats are coloured to echo the app's blue/red background glow
// (index.css): the local player is blue, the opponent red — the same versus
// framing the SwordsIcon and the whole home dashboard lean on. These are the
// exact glow hues, packaged as Tailwind class fragments so the lobby panels read
// as the foreground of that same glow.

export type Side = "blue" | "red";

export type SideStyle = {
  /** Bright text/glyph colour for the seat's accents. */
  accent: string;
  /** Faint wash behind the seat's panel. */
  wash: string;
  /** The "connected" presence dot. */
  dot: string;
};

export const SIDE_STYLES: Record<Side, SideStyle> = {
  blue: {
    accent: "text-[#8fc2ff]",
    wash: "bg-[#2695ff]/[0.06]",
    dot: "bg-[#3a9bff]",
  },
  red: {
    accent: "text-[#ff9aad]",
    wash: "bg-[#ff3456]/[0.06]",
    dot: "bg-[#ff4d6a]",
  },
};
