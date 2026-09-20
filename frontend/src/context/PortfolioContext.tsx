import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getActivePortfolioId, setActivePortfolioId } from "../api/client";
import type { Portfolio, PortfolioType } from "../api/types";
import { useAuth } from "./AuthContext";

interface PortfolioContextValue {
  portfolios: Portfolio[];
  loading: boolean;
  /** The portfolio this tab is working in (null until one is chosen, when there are several). */
  active: Portfolio | null;
  /** True when there's more than one portfolio and none has been chosen yet — show the selection page. */
  needsSelection: boolean;
  select: (id: string) => void;
  refresh: (keepId?: string | null) => Promise<Portfolio[]>;
  add: (type: PortfolioType, name: string) => Promise<Portfolio>;
  rename: (id: string, name: string) => Promise<void>;
  setup: (items: Array<{ type: PortfolioType; name: string }>) => Promise<Portfolio[]>;
}

const PortfolioContext = createContext<PortfolioContextValue | undefined>(undefined);

/**
 * Knows which portfolios the signed-in person has and which one this tab is using.
 * With one portfolio there is nothing to choose; with two or more, the person picks
 * one on the selection page before the app opens.
 */
export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activeId, setActiveId] = useState<string | null>(getActivePortfolioId());
  // The person whose portfolios have been loaded. Until it matches the signed-in person we are "loading",
  // so the app never renders (and fetches data) before we know which portfolio to use.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  /**
   * Stores the list. With several portfolios, keeps this tab's choice if it is still valid
   * (or `keepId`, used when the person adds a portfolio while already working in one, so
   * they aren't thrown to the selection page mid-session).
   */
  const apply = useCallback((list: Portfolio[], keepId?: string | null) => {
    setPortfolios(list);
    if (list.length <= 1) {
      // Nothing to choose — use the default portfolio (no header needed).
      setActivePortfolioId(null);
      setActiveId(null);
    } else {
      const stored = getActivePortfolioId() ?? keepId ?? null;
      const valid = stored && list.some((p) => p.id === stored) ? stored : null;
      setActivePortfolioId(valid);
      setActiveId(valid);
    }
  }, []);

  const refresh = useCallback(
    async (keepId?: string | null) => {
      const res = await api.get<{ portfolios: Portfolio[] }>("/portfolios");
      apply(res.portfolios, keepId);
      return res.portfolios;
    },
    [apply]
  );

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPortfolios([]);
      setLoadedFor(null);
      return;
    }
    api
      .get<{ portfolios: Portfolio[] }>("/portfolios")
      .then((res) => !cancelled && apply(res.portfolios ?? []))
      .catch(() => !cancelled && setPortfolios([]))
      .finally(() => !cancelled && setLoadedFor(user.id));
    return () => {
      cancelled = true;
    };
  }, [user, apply]);

  const select = useCallback(
    (id: string) => {
      if (!portfolios.some((p) => p.id === id)) return;
      setActivePortfolioId(id);
      setActiveId(id);
    },
    [portfolios]
  );

  const add = useCallback(
    async (type: PortfolioType, name: string) => {
      // Stay in the portfolio you're in; the selection page appears from the next sign-in.
      const currentId = portfolios.length === 1 ? portfolios[0]!.id : activeId;
      const created = await api.post<Portfolio>("/portfolios", { type, name });
      await refresh(currentId);
      return created;
    },
    [refresh, portfolios, activeId]
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await api.patch(`/portfolios/${id}`, { name });
      await refresh();
    },
    [refresh]
  );

  const setup = useCallback(
    async (items: Array<{ type: PortfolioType; name: string }>) => {
      const res = await api.post<{ portfolios: Portfolio[] }>("/portfolios/setup", { portfolios: items });
      apply(res.portfolios);
      return res.portfolios;
    },
    [apply]
  );

  const loading = !!user && loadedFor !== user.id;

  const value = useMemo<PortfolioContextValue>(() => {
    const active = portfolios.length === 1 ? portfolios[0]! : portfolios.find((p) => p.id === activeId) ?? null;
    return { portfolios, loading, active, needsSelection: portfolios.length > 1 && !active, select, refresh, add, rename, setup };
  }, [portfolios, activeId, loading, select, refresh, add, rename, setup]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio must be used within PortfolioProvider");
  return ctx;
}
