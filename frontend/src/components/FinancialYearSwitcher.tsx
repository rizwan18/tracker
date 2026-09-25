import { useEffect, useState } from "react";
import { useFinancialYear } from "../context/FinancialYearContext";
import { api } from "../api/client";
import type { FinancialYearOption } from "../api/types";

export function labelFromId(id: string): string {
  const [start] = id.split("-");
  const startYear = Number(start);
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `FY${startYear}\u2013${endShort}`;
}

export function FinancialYearSwitcher() {
  const { financialYearId, setFinancialYearId } = useFinancialYear();
  const [options, setOptions] = useState<FinancialYearOption[]>([]);

  useEffect(() => {
    api
      .get<{ availableFinancialYears: FinancialYearOption[] }>("/dashboard")
      .then((res) => setOptions(res.availableFinancialYears))
      .catch(() => {
        // Fall back to a locally-computed list if the dashboard call fails
        // (e.g. before a household exists yet).
        const now = new Date();
        const startYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
        const list: FinancialYearOption[] = [];
        for (let i = 0; i < 5; i++) {
          const y = startYear - i;
          list.push({ id: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, label: labelFromId(`${y}`) });
        }
        setOptions(list);
      });
  }, []);

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">Select financial year</span>
      <select
        value={financialYearId}
        onChange={(e) => setFinancialYearId(e.target.value)}
        className="rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 font-medium text-[var(--color-ink)] focus:border-[var(--color-eucalyptus)]"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {options.length === 0 && <option value={financialYearId}>{labelFromId(financialYearId)}</option>}
      </select>
    </label>
  );
}
