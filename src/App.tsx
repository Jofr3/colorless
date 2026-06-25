import { createBrowserRouter } from "react-router-dom";
import { SwordsIcon } from "./components/icons";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { RootLayout } from "./components/RootLayout";
import { RouteError } from "./components/RouteError";
import { Decks } from "./features/decks";
import { Home } from "./features/home";
import { Playmat } from "./features/playmat";
import { Settings } from "./features/settings";
import { NotFound } from "./NotFound";

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
