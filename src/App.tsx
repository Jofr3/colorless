import { Navigate, Route, Routes } from "react-router-dom";
import { Playmat } from "./features/playmat";
import { NotFound } from "./NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/simulator" replace />} />
      <Route path="/simulator" element={<Playmat />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
