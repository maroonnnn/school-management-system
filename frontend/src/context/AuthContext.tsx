import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUser } from "../types/auth";
import { apiFetch, getToken, setToken, setUnauthorizedHandler } from "../services/api";
import { clearKioskSession, restoreKioskSession } from "../services/offlineQueue";

const USER_KEY = "sms.user";
const IDLE_LIMIT_MS = 30 * 60 * 1000; // FR-AUTH-02

interface AuthContextValue {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: (reason?: string) => void;
  logoutReason: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw && getToken() ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadUser);
  const [logoutReason, setLogoutReason] = useState<string | null>(null);
  // Offline restart of the kiosk device: the stored kiosk session is restored (online it is never used: the token expires in 30 min)
  const [restoring, setRestoring] = useState(() => !loadUser() && navigator.onLine === false);

  useEffect(() => {
    if (!restoring) return;
    void restoreKioskSession().then((s) => {
      if (s) {
        setToken(s.token);
        try { sessionStorage.setItem(USER_KEY, JSON.stringify(s.user)); } catch { /* ignore */ }
        setUser(s.user);
      }
      setRestoring(false);
    });
  }, [restoring]);

  const logout = useCallback((reason?: string) => {
    void clearKioskSession();
    setToken(null);
    try {
      sessionStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    setLogoutReason(reason ?? null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiFetch<{ data: { token: string; user: AuthUser } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim(), password }),
    });
    setToken(result.data.token);
    try {
      sessionStorage.setItem(USER_KEY, JSON.stringify(result.data.user));
    } catch {
      /* ignore */
    }
    setUser(result.data.user);
    setLogoutReason(null);
    return result.data.user;
  }, []);

  // Expired/invalid token from the server → logout
  useEffect(() => {
    setUnauthorizedHandler(() => logout("انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً"));
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Idle timeout: 30 minutes without activity
  useEffect(() => {
    if (!user) return;
    let timer = window.setTimeout(fire, IDLE_LIMIT_MS);
    function fire() {
      // the attendance kiosk stays signed in (an idle kiosk is normal; the server token expires by itself)
      if (window.location.pathname.startsWith("/kiosk")) { reset(); return; }
      logout("تم إنهاء الجلسة تلقائياً بعد 30 دقيقة من عدم النشاط");
    }
    function reset() {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, IDLE_LIMIT_MS);
    }
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, logout]);

  const value = useMemo(() => ({ user, login, logout, logoutReason }), [user, login, logout, logoutReason]);
  if (restoring) return null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
