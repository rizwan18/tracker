import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { Investment, SalePreview, SaleResult } from "../api/types";
import { Alert, Button, Field, inputClass } from "./ui";
import { Modal } from "./Modal";
import { formatDate } from "../lib/format";
import { formatPrice, formatUnits } from "../lib/holdings";
import { OUTCOME_LABEL, formatCentsIn, formatCentsSigned, localToday, newRequestId, outcomeColour, parseTyped, validateSaleInputs } from "../lib/sale";

type Step = "form" | "review" | "done";

/** What the preview was asked for — a preview is only shown while it still matches what's typed. */
type Draft = { quantity: number; pricePerShare: number; saleDate: string; fees: number };
type PreviewState = { key: string; preview: SalePreview | null; error: string | null };

const keyOf = (d: Draft) => `${d.quantity}|${d.pricePerShare}|${d.saleDate}|${d.fees}`;

/**
 * Record the sale of (part of) a share holding.
 *
 * Form → live figures (worked out by the server, so what you review is exactly what gets recorded) → review →
 * confirm. The figures are an accounting gain/loss for tracking only: no CGT discount, tax rate or offset is applied.
 * `onFinished` runs once the person is done (so the page behind reloads after the success message, not before).
 */
export function SellSharesDialog({ investment, onCancel, onFinished }: { investment: Investment; onCancel: () => void; onFinished: () => void }) {
  const currency = investment.currency === "USD" ? "USD" : "AUD";
  const available = investment.sellable?.availableQuantity ?? 0;
  const label = investment.ticker ?? investment.name;
  const today = useMemo(() => localToday(), []);

  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today);
  const [fees, setFees] = useState("0");
  const [step, setStep] = useState<Step>("form");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);

  // One idempotency key per sale attempt, kept for as long as this dialog is open: if "Confirm" is pressed twice, or the
  // request is retried after a dropped connection, the server records the sale once.
  const [requestId] = useState(newRequestId);
  // Guards against a second submit starting before React has re-rendered the button as disabled.
  const inFlight = useRef(false);

  const inputError = validateSaleInputs({ quantity, price, date, fees, available, today });
  const anyTyped = quantity.trim() !== "" || price.trim() !== "";
  const draft: Draft | null = useMemo(() => {
    if (inputError) return null;
    return { quantity: parseTyped(quantity)!, pricePerShare: parseTyped(price)!, saleDate: date, fees: parseTyped(fees) ?? 0 };
  }, [inputError, quantity, price, date, fees]);
  const draftKey = draft ? keyOf(draft) : null;

  // Ask the server for the figures shortly after typing stops.
  useEffect(() => {
    if (!draft || !draftKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .post<SalePreview>(`/investments/${investment.id}/sales/preview`, draft)
        .then((preview) => !cancelled && setPreviewState({ key: draftKey, preview, error: null }))
        .catch((err) => !cancelled && setPreviewState({ key: draftKey, preview: null, error: err instanceof ApiError ? err.message : "We couldn't work out the figures. Please try again." }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `draft` is derived from draftKey; depending on the key avoids re-running for an unchanged draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, investment.id]);

  const current = previewState && previewState.key === draftKey ? previewState : null;
  const preview = current?.preview ?? null;
  const calculating = !!draft && !current;
  const money = (cents: number) => formatCentsIn(cents, currency);

  async function confirm() {
    if (!draft || !preview || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.post<SaleResult>(`/investments/${investment.id}/sales`, { ...draft, clientRequestId: requestId });
      setResult(res);
      setStep("done");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "We couldn't record this sale, so nothing has been changed. Please check your connection and try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return; // never walk away from a sale that's being saved
    if (step === "done") onFinished();
    else onCancel();
  }

  const row = (name: ReactNode, value: ReactNode, strong = false) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-[var(--color-ink-soft)]">{name}</dt>
      <dd className={`text-sm text-right tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{value}</dd>
    </div>
  );

  const figures = (p: SalePreview) => (
    <dl className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)] px-4" aria-live="polite">
      {row("Gross sale proceeds", money(p.grossProceedsCents))}
      {row("Selling fees", p.feesCents > 0 ? `− ${money(p.feesCents)}` : money(0))}
      {row("Net sale proceeds", money(p.netProceedsCents), true)}
      {row(
        <>
          Cost base of shares sold <span className="block text-xs font-normal">average cost {formatPrice(p.costBasePerShare, currency)} × {formatUnits(p.quantity)}</span>
        </>,
        money(p.costBaseCents)
      )}
      <div className="flex items-baseline justify-between gap-4 py-2.5">
        <dt className={`text-sm font-semibold ${outcomeColour(p.outcome)}`}>{OUTCOME_LABEL[p.outcome]}</dt>
        <dd className={`text-lg font-display font-semibold tabular-nums ${outcomeColour(p.outcome)}`}>{p.outcome === "BREAK_EVEN" ? money(0) : formatCentsSigned(p.gainLossCents, currency)}</dd>
      </div>
    </dl>
  );

  return (
    <Modal title={step === "done" ? "Sale recorded" : step === "review" ? "Review your sale" : "Sell shares"} onClose={handleClose}>
      {step === "form" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (preview) setStep("review");
          }}
          noValidate
        >
          <div className="rounded-xl bg-[var(--color-paper-dim)] px-4 py-3">
            <p className="font-medium">
              {investment.name} {investment.ticker && <span className="font-normal text-[var(--color-ink-soft)]">({investment.ticker})</span>}
            </p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              {formatUnits(available)} {available === 1 ? "share" : "shares"} available to sell
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity to sell" htmlFor="sell-qty">
              <input id="sell-qty" inputMode="decimal" autoComplete="off" className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
              <button type="button" className="text-xs text-[var(--color-eucalyptus-dark)] hover:underline mt-1" onClick={() => setQuantity(String(available))}>
                Sell all {formatUnits(available)}
              </button>
            </Field>
            <Field label={currency === "USD" ? "Sale price per share (US$)" : "Sale price per share"} htmlFor="sell-price">
              <input id="sell-price" inputMode="decimal" autoComplete="off" className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sale date" htmlFor="sell-date">
              <input id="sell-date" type="date" max={today} className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={currency === "USD" ? "Transaction fees (US$)" : "Transaction fees"} htmlFor="sell-fees" hint="Optional brokerage or selling fees.">
              <input id="sell-fees" inputMode="decimal" autoComplete="off" className={inputClass} value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" />
            </Field>
          </div>

          {anyTyped && inputError && <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{inputError}</p>}
          {current?.error && <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{current.error}</p>}
          {calculating && <p className="text-sm text-[var(--color-ink-soft)]">Calculating…</p>}
          {preview && figures(preview)}
          {preview?.closesHolding && <Alert severity="info" message="This sells your whole holding. It will be closed and moved out of your active holdings; its history is kept." />}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!preview}>
              Review sale
            </Button>
          </div>
        </form>
      )}

      {step === "review" && preview && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-ink-soft)]">Check these figures. Once you confirm, the sale is permanently recorded and can't be deleted.</p>
          <dl className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)] px-4">
            {row("Asset", `${investment.name}${investment.ticker ? ` (${investment.ticker})` : ""}`)}
            {row("Sale date", formatDate(preview.saleDate))}
            {row("Quantity sold", `${formatUnits(preview.quantity)} ${preview.quantity === 1 ? "share" : "shares"}`)}
            {row("Sale price per share", formatPrice(preview.pricePerShare, currency))}
          </dl>
          {figures(preview)}
          <p className="text-sm">
            {preview.closesHolding ? (
              <>After this sale you will hold <strong>no {label} shares</strong>; the holding will be closed.</>
            ) : (
              <>
                After this sale you will hold <strong>{formatUnits(preview.remainingQuantity)}</strong> shares with a cost base of <strong>{money(preview.remainingCostBaseCents)}</strong> (unchanged per share).
              </>
            )}
          </p>
          <p className="text-xs text-[var(--color-ink-soft)]">
            Cost base uses the average-cost method across everything you held at the sale date. This is a record of the accounting gain or loss only — no capital gains tax discount, rate or offset is applied, and it may not equal the amount for your tax return.
          </p>
          {submitError && <p role="alert" className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{submitError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setStep("form")} disabled={submitting}>
              Back
            </Button>
            <Button onClick={confirm} disabled={submitting}>
              {submitting ? "Recording…" : submitError ? "Try again" : "Confirm sale"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4">
          <Alert
            severity="info"
            message={
              result.duplicate
                ? "This sale had already been recorded — nothing was added twice."
                : `Sold ${formatUnits(result.sale.quantity)} ${label} for ${money(result.sale.netProceedsCents)} net.`
            }
          />
          <p className="text-sm">
            <span className={`font-semibold ${outcomeColour(result.sale.outcome)}`}>{OUTCOME_LABEL[result.sale.outcome]}</span>
            {result.sale.outcome !== "BREAK_EVEN" && <span className={`font-semibold tabular-nums ${outcomeColour(result.sale.outcome)}`}>: {formatCentsSigned(result.sale.gainLossCents, currency)}</span>}
          </p>
          <p className="text-sm text-[var(--color-ink-soft)]">
            {result.closed ? "The holding is now closed. Its history stays in your trades." : `${formatUnits(result.remainingQuantity)} shares remain.`} You can see this sale under Shares → View Trades.
          </p>
          <div className="flex justify-end pt-2">
            <Button onClick={onFinished}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
