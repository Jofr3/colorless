import { Route, Routes } from "react-router-dom";
import { DecksIcon, LobbyIcon, SettingsIcon } from "./components/icons";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { Home } from "./features/home";
import { Playmat } from "./features/playmat";
import { NotFound } from "./NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/simulator" element={<Playmat />} />
      <Route path="/lobby/create" element={<PlaceholderPage title="Online" Icon={LobbyIcon} />} />
      <Route path="/decks" element={<PlaceholderPage title="Decks" Icon={DecksIcon} />} />
      <Route path="/settings" element={<PlaceholderPage title="Settings" Icon={SettingsIcon} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
