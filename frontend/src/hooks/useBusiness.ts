import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { BusinessProfile, LedgerAccount } from "../api/businessTypes";

/** The business profile and chart of accounts, loaded together (used by the entry forms and pages). */
export function useBusinessBasics() {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([api.get<BusinessProfile>("/business/profile"), api.get<{ accounts: LedgerAccount[] }>("/business/accounts")]);
      setProfile(p);
      setAccounts(a.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load your business details.");
    }
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  return { profile, accounts, loading, error, reload };
}
