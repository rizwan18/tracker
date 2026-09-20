import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken, setActivePortfolioId } from "../api/client";
import type { User } from "../api/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string, householdName?: string) => Promise<void>;
  logout: () => void;
  updateUser: (patch: Partial<Pick<User, "easyViewEnabled" | "fullName">>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<User>("/auth/me");
        setUser(me);
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (fullName: string, email: string, password: string, householdName?: string) => {
    const res = await api.post<{ token: string; user: User }>("/auth/register", { fullName, email, password, householdName });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setActivePortfolioId(null);
    setUser(null);
  }, []);

  const updateUser = useCallback(async (patch: Partial<Pick<User, "easyViewEnabled" | "fullName">>) => {
    const updated = await api.patch<Partial<User>>("/auth/me", patch);
    setUser((prev) => (prev ? { ...prev, ...updated } : prev));
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
