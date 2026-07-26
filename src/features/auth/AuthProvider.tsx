import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LoginRequest, RegisterRequest, UpdateProfileRequest, User } from "@luminous/schema";
import {
  ApiError,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  register as apiRegister,
  updateProfile as apiUpdateProfile,
  setSessionRecoveryHandler,
} from "../../lib/api";

/** Where the session stands. "loading" only during the mount-time `me()`
    probe (and manual `refresh()`); after that it's a hard either/or. */
export type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  status: AuthStatus;
  /** Non-null exactly when status === "authenticated". */
  user: User | null;
  /** True when the last session probe failed for a reason OTHER than a clean
      401 (network down, api unreachable) — we treat that as anonymous, but a
      caller can distinguish "signed out" from "couldn't ask". */
  probeFailed: boolean;
  /** Wrappers around the api client that also update this context. They let
      ApiError propagate so forms can map `.status` to friendly copy. */
  login: (body: LoginRequest) => Promise<User>;
  register: (body: RegisterRequest) => Promise<User>;
  logout: () => Promise<void>;
  /** Save profile edits (P5-5) and adopt the api's answer as the current user,
      so every surface reading it — the corner control's initial, the generated
      avatar — follows without a re-probe. */
  updateProfile: (body: UpdateProfileRequest) => Promise<User>;
  /** Re-run the `me()` probe (e.g. after returning from an OAuth callback). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Holds "who am I" for the whole app. Mounted in main.tsx around the router
// (mirrors FontProvider): one mount-time `me()` probe resolves the session
// cookie into a User, and the login/register/logout wrappers keep the state
// in sync afterwards. 401 from `me()` is the NORMAL signed-out answer (the
// api client deliberately doesn't swallow it), so it maps to "anonymous"
// without noise; anything else (network down) also lands on "anonymous" but
// flags `probeFailed`.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);

  // Last-writer-wins guard: every state-writing operation claims a fresh
  // token at start and only applies its outcome while still the latest — so
  // a slow mount-time me() settling after a successful login can't clear the
  // fresh user, and a slow me() settling after logout can't resurrect one.
  const opToken = useRef(0);

  const applyUser = useCallback((next: User) => {
    setUser(next);
    setStatus("authenticated");
    setProbeFailed(false);
  }, []);

  const clearUser = useCallback(() => {
    setUser(null);
    setStatus("anonymous");
  }, []);

  // The `me()` probe behind both refresh() and the api client's session
  // recovery. Returns whether the session is alive so the client knows to
  // retry the request that 401'd; the auth state is updated as a side effect
  // (unless a fresher operation has written meanwhile).
  const probe = useCallback(async (): Promise<boolean> => {
    const op = ++opToken.current;
    try {
      const next = await apiMe();
      if (op === opToken.current) applyUser(next);
      return true;
    } catch (error) {
      if (op === opToken.current) {
        clearUser();
        // A 401 is the clean "you're signed out" answer; anything else means
        // the probe itself failed (network, api down) — same UI state, but
        // distinguishable via the flag.
        setProbeFailed(!(error instanceof ApiError && error.status === 401));
      }
      return false;
    }
  }, [applyUser, clearUser]);

  const refresh = useCallback(async () => {
    await probe();
  }, [probe]);

  // The mount-time session probe. `refresh` never rejects, so no cleanup
  // race to guard beyond React batching the state updates.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Own the api client's 401 recovery: an unexpected 401 on a session-gated
  // route re-probes here — true (still signed in; the 401 was a one-off)
  // makes the client retry the request once, false means the probe already
  // flipped the whole app to signed-out.
  useEffect(() => {
    setSessionRecoveryHandler(probe);
    return () => setSessionRecoveryHandler(null);
  }, [probe]);

  const login = useCallback(
    async (body: LoginRequest) => {
      const op = ++opToken.current;
      const next = await apiLogin(body);
      if (op === opToken.current) applyUser(next);
      return next;
    },
    [applyUser],
  );

  const register = useCallback(
    async (body: RegisterRequest) => {
      const op = ++opToken.current;
      const next = await apiRegister(body);
      if (op === opToken.current) applyUser(next);
      return next;
    },
    [applyUser],
  );

  // Same last-writer-wins discipline as login/register: a save that lands
  // after a logout must not resurrect the user.
  const updateProfile = useCallback(
    async (body: UpdateProfileRequest) => {
      const op = ++opToken.current;
      const next = await apiUpdateProfile(body);
      if (op === opToken.current) applyUser(next);
      return next;
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    const op = ++opToken.current;
    try {
      await apiLogout();
    } catch (error) {
      // A 401 just means the session was already gone — that IS signed out.
      // Anything else propagates with the local state untouched.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    if (op === opToken.current) clearUser();
  }, [clearUser]);

  const value = useMemo(
    () => ({ status, user, probeFailed, login, register, logout, updateProfile, refresh }),
    [status, user, probeFailed, login, register, logout, updateProfile, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
