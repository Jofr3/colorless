// Barrel for the LAZY route imports in App.tsx. The always-eager pieces —
// AuthProvider (main.tsx) and AccountButton (RootLayout) — are imported by
// their module paths directly, NOT through here: an eager import of this
// barrel would drag the login/register pages into the main chunk.
export { Login, Register } from "./AuthPage";
export { AuthProvider, useAuth } from "./AuthProvider";
