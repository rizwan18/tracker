import type { ReactNode } from "react";
import type { SourcingDetail } from "../../api/businessTypes";
import { Card } from "../ui";
import { formatCurrencyIn } from "../../lib/format";
import { formatOrderMoney, formatPercent } from "../../lib/sourcing";

function Line({ label, children, strong = false, hint }: { label: string; children: ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "font-semibold text-[var(--color-ink)]" : "text-sm"}`}>
      <dt className={strong ? "" : "text-[var(--color-ink-soft)]"}>
        {label}
        {hint && <span className="block text-xs font-normal text-[var(--color-ink-soft)]">{hint}</span>}
      </dt>
      <dd className="tabular-nums text-right whitespace-nowrap">{children}</dd>
    </div>
  );
}

/**
 * Landed sourcing cost → cost price per unit → recommended selling price at the target GROSS margin
 * (selling price = cost per unit ÷ (1 − margin)). Every figure comes from the server (services/business/pricing.ts),
 * so the screen can't drift from the calculation. Amounts are in the order's currency; per-unit figures are
 * rounded to 2 decimals only here, for display.
 */
export function SourcingPricingCard({ record: r }: { record: SourcingDetail }) {
  const { pricing } = r;
  const money = (cents: number) => formatOrderMoney(cents, r.currency);
  const u = pricing.unit;
  const margin = formatPercent(pricing.targetMarginPercent);
  const inProgress = r.status !== "DELIVERED" && r.status !== "CANCELLED";

  return (
    <Card>
      <h3 className="font-display font-semibold">Cost &amp; selling price per unit</h3>
      <p className="text-xs text-[var(--color-ink-soft)] mt-0.5">
        Total sourcing cost ÷ quantity, then the selling price that earns your target gross margin.{inProgress ? " Based on the costs recorded so far." : ""}
      </p>

      <dl className="mt-3">
        <Line label="Quantity">{r.quantity.toLocaleString("en-AU")} units</Line>
        <Line label="Manufacturing cost">{money(pricing.landed.manufacturingCents)}</Line>
        <Line label="Inspection cost">{money(pricing.landed.inspectionCents)}</Line>
        <Line label="Freight cost">{money(pricing.landed.freightCents)}</Line>
        <Line label="Other sourcing costs" hint="Customs duty, insurance, other shipping costs and payment fees">
          {money(pricing.landed.otherCents)}
        </Line>
        <div className="border-t border-[var(--color-line)] mt-1 pt-1">
          <Line label="Total sourcing cost" strong>
            {money(pricing.landed.totalCents)}
          </Line>
        </div>
      </dl>

      {u.ok ? (
        <>
          <dl className="mt-2 border-t border-[var(--color-line)] pt-2">
            <Line label="Cost price per unit" strong>
              {money(u.costPerUnitCents)}
            </Line>
            <Line label="Target gross margin">{margin}</Line>
          </dl>

          <div className="mt-3 rounded-xl bg-[var(--color-eucalyptus-tint)] px-4 py-3" role="status">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm font-medium text-[var(--color-eucalyptus-dark)]">Recommended selling price per unit</p>
              <p className="text-2xl font-display font-semibold text-[var(--color-eucalyptus-dark)] tabular-nums">{money(u.sellingPricePerUnitCents)}</p>
            </div>
            <p className="text-xs text-[var(--color-eucalyptus-dark)] mt-1">
              {money(u.costPerUnitCents)} ÷ {Number((1 - pricing.targetMarginPercent / 100).toFixed(4))} · gross profit {money(u.grossProfitPerUnitCents)} per unit ({margin} of the selling price)
            </p>
            {u.sellingPricePerUnitAudEstCents !== null && u.costPerUnitAudEstCents !== null && (
              <p className="text-xs text-[var(--color-eucalyptus-dark)] mt-1">
                About {formatCurrencyIn(u.costPerUnitAudEstCents / 100, "AUD")} cost → {formatCurrencyIn(u.sellingPricePerUnitAudEstCents / 100, "AUD")} selling in Australian dollars at 1 {r.currency} = {r.exchangeRateToAud} AUD.
              </p>
            )}
          </div>
        </>
      ) : (
        <p role="status" className="mt-3 rounded-xl bg-[var(--color-ochre-tint)] text-[#7a4d1a] px-4 py-3 text-sm">
          {u.message}
        </p>
      )}
      <p className="text-xs text-[var(--color-ink-soft)] mt-3">
        Margin is a share of the selling price, not a markup on cost. Selling fees (marketplace, payment processing, advertising), GST and tax aren&apos;t included. Change the target under Edit.
      </p>
    </Card>
  );
}
