import { createBrowserRouter } from "react-router-dom";
import { DecksIcon, SettingsIcon, SwordsIcon } from "./components/icons";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { RootLayout } from "./components/RootLayout";
import { Home } from "./features/home";
import { Playmat } from "./features/playmat";
import { NotFound } from "./NotFound";

// Data router with a persistent RootLayout shell so the shared background glow
// (index.css) survives navigations and slides between route layouts.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/simulator", element: <Playmat /> },
      { path: "/lobby/create", element: <PlaceholderPage title="Online" Icon={SwordsIcon} /> },
      { path: "/decks", element: <PlaceholderPage title="Decks" Icon={DecksIcon} /> },
      { path: "/settings", element: <PlaceholderPage title="Settings" Icon={SettingsIcon} /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
