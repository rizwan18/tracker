import { Link } from "react-router-dom";
import { Card, HelpText } from "./ui";
import { formatPnl, formatReturn, returnPercent, toneOf, type Currency, type PnlBucket, type PnlSummary, type Tone } from "../lib/pnl";

const CURRENCIES: Currency[] = ["AUD", "USD"];

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-[var(--color-eucalyptus)]",
  negative: "text-[var(--color-brick)]",
  neutral: "text-[var(--color-ink-soft)]",
};
const TONE_ACCENT: Record<Tone, string> = {
  positive: "border-l-[var(--color-eucalyptus)]",
  negative: "border-l-[var(--color-brick)]",
  neutral: "border-l-[var(--color-line)]",
};
// Not colour alone: each state also carries a word and a shape.
const TONE_WORD: Record<Tone, string> = { positive: "▲ Gain", negative: "▼ Loss", neutral: "● Break-even" };

function Figure({ bucket, currency, primary, costLabel }: { bucket: PnlBucket; currency: Currency; primary: boolean; costLabel: string }) {
  const tone = toneOf(bucket.amount);
  const pct = returnPercent(bucket);
  return (
    <div>
      <p className={`font-display font-semibold tabular-nums ${primary ? "text-2xl" : "text-xl"} ${TONE_TEXT[tone]}`}>{formatPnl(bucket.amount, currency)}</p>
      <p className="text-xs text-[var(--color-ink-soft)] mt-0.5">
        <span className={`font-medium ${TONE_TEXT[tone]}`}>{TONE_WORD[tone]}</span>
        {pct !== null && (
          <>
            {" · "}
            <span className="tabular-nums">{formatReturn(pct)}</span> {costLabel}
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Realised P&L (sales already made) and Unrealised P&L (what is still held) as two separate cards.
 * Figures come from summarisePnl (lib/pnl.ts); A$ and US$ holdings are never added together.
 */
export function PnlSummaryCards({ pnl }: { pnl: PnlSummary }) {
  const unrealisedCurrencies = CURRENCIES.filter((c) => pnl.unrealised[c].holdings > 0);
  const realisedCurrencies = CURRENCIES.filter((c) => pnl.realised[c].holdings > 0);
  const noUnrealisedFigure = unrealisedCurrencies.length === 0;
  const worstTone = (cs: Currency[], bucket: Record<Currency, PnlBucket>): Tone => {
    const tones = cs.map((c) => toneOf(bucket[c].amount));
    return tones.includes("negative") && !tones.includes("positive") ? "negative" : tones.includes("positive") && !tones.includes("negative") ? "positive" : "neutral";
  };

  return (
    <>
      <Card className={`border-l-4 ${noUnrealisedFigure ? "border-l-[var(--color-line)]" : TONE_ACCENT[worstTone(unrealisedCurrencies, pnl.unrealised)]}`}>
        <p className="text-sm text-[var(--color-ink-soft)]">
          <HelpText term="Unrealised Gain/Loss">
            <span>Unrealised P&amp;L</span>
          </HelpText>
        </p>
        <div className="mt-1 space-y-2" aria-live="polite">
          {noUnrealisedFigure ? (
            <p className="font-display text-2xl font-semibold text-[var(--color-ink-soft)]">{pnl.awaitingPrice > 0 ? "Price pending" : "—"}</p>
          ) : (
            unrealisedCurrencies.map((c, i) => <Figure key={c} bucket={pnl.unrealised[c]} currency={c} primary={i === 0} costLabel="on cost" />)
          )}
        </div>
        <div className="text-xs text-[var(--color-ink-soft)] mt-2 space-y-0.5">
          {noUnrealisedFigure && pnl.awaitingPrice === 0 && pnl.noCostBase === 0 && <p>No open holdings to value.</p>}
          {pnl.awaitingPrice > 0 && (
            <p>
              {pnl.awaitingPrice} {pnl.awaitingPrice === 1 ? "holding is" : "holdings are"} waiting for a market price{noUnrealisedFigure ? "" : " and not counted"}.
            </p>
          )}
          {pnl.noCostBase > 0 && (
            <p>
              {pnl.noCostBase} {pnl.noCostBase === 1 ? "holding has" : "holdings have"} no buy history (no cost) and {pnl.noCostBase === 1 ? "isn’t" : "aren’t"} counted.
            </p>
          )}
          {pnl.recordedPriceOnly > 0 && <p>{pnl.recordedPriceOnly} valued on a recorded price, not a refreshed one.</p>}
          {!noUnrealisedFigure && <p>Still held, at current market prices.</p>}
        </div>
      </Card>

      <Card className={`border-l-4 ${realisedCurrencies.length === 0 ? "border-l-[var(--color-line)]" : TONE_ACCENT[worstTone(realisedCurrencies, pnl.realised)]}`}>
        <p className="text-sm text-[var(--color-ink-soft)]">
          <HelpText term="Realised Gain/Loss">
            <span>Realised P&amp;L</span>
          </HelpText>
        </p>
        <div className="mt-1 space-y-2">
          {realisedCurrencies.length === 0 ? (
            <p className="font-display text-2xl font-semibold text-[var(--color-ink-soft)]">$0</p>
          ) : (
            realisedCurrencies.map((c, i) => <Figure key={c} bucket={pnl.realised[c]} currency={c} primary={i === 0} costLabel="on cost sold" />)
          )}
        </div>
        <p className="text-xs text-[var(--color-ink-soft)] mt-2">{realisedCurrencies.length === 0 ? "No shares sold yet." : "From shares you’ve sold, all time."}</p>
        <Link to="/investments/realised" className="inline-block text-xs mt-1 text-[var(--color-eucalyptus-dark)] underline hover:no-underline">
          View sales by financial year
        </Link>
      </Card>
    </>
  );
}
