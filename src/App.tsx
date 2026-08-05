import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./components/RootLayout";
import { RouteError } from "./components/RouteError";
import { Home } from "./features/home";
import { NotFound } from "./NotFound";
import { Settings } from "./features/settings";

// Home, Settings and the placeholders are light and on the first-paint path, so
// they stay eager (the settings module is also pulled by FontProvider at the
// root). Playmat (the PixiJS/GSAP card layer) and Decks are the heavy route
// leaves, split into their own chunks and loaded on demand when their route is
// first visited. RootLayout provides the Suspense boundary.
const Playmat = lazy(() => import("./features/playmat").then((m) => ({ default: m.Playmat })));
// The local hot-seat game page shares the heavy playmat chunk's dependencies
// (Pixi/GSAP) via the same dynamic import graph, so it is lazy too.
const GamePage = lazy(() =>
  import("./features/game/GamePage").then((m) => ({ default: m.GamePage })),
);
const Decks = lazy(() => import("./features/decks").then((m) => ({ default: m.Decks })));
const DeckBuilder = lazy(() =>
  import("./features/builder").then((m) => ({ default: m.DeckBuilder })),
);
// The online lobby (BroadcastChannel transport + versus UI) is its own chunk,
// loaded when a player first heads online.
const OnlineHub = lazy(() => import("./features/online").then((m) => ({ default: m.OnlineHub })));
const LobbyRoom = lazy(() => import("./features/online").then((m) => ({ default: m.LobbyRoom })));
// The auth pages split off the first-paint path too — most sessions already
// have a cookie and never visit them. (AuthProvider itself stays eager via
// main.tsx's direct module import.)
const Login = lazy(() => import("./features/auth").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("./features/auth").then((m) => ({ default: m.Register })));

// Data router with a persistent RootLayout shell so the shared background glow
// (index.css) survives navigations and slides between route layouts.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/play", element: <GamePage /> },
      { path: "/simulator", element: <Playmat /> },
      { path: "/lobby", element: <OnlineHub /> },
      { path: "/lobby/:code", element: <LobbyRoom /> },
      { path: "/decks", element: <Decks /> },
      { path: "/decks/:deckId/edit", element: <DeckBuilder /> },
      { path: "/login", element: <Login /> },
      { path: "/register", element: <Register /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
