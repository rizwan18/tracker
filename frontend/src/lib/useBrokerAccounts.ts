import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { BrokerAccount } from "../api/types";

/** The household's broker accounts, loaded once and re-loadable after they are added, edited or removed. */
export function useBrokerAccounts() {
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    api
      .get<BrokerAccount[]>("/broker-accounts")
      .then(setAccounts)
      // A failure here must never break the page or a form: trades simply show no account until it loads.
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);
  return { accounts, loaded, reload };
}
