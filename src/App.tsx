import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { SwordsIcon } from "./components/icons";
import { PlaceholderPage } from "./components/PlaceholderPage";
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
const Decks = lazy(() => import("./features/decks").then((m) => ({ default: m.Decks })));

// Data router with a persistent RootLayout shell so the shared background glow
// (index.css) survives navigations and slides between route layouts.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/simulator", element: <Playmat /> },
      { path: "/lobby/create", element: <PlaceholderPage title="Online" Icon={SwordsIcon} /> },
      { path: "/decks", element: <Decks /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
