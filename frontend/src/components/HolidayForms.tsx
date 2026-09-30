import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { HolidayDetail, HolidayExpense, HolidayMilestone, HolidayStatus, HolidayExpenseCategory, HolidayMilestoneType } from "../api/types";
import { Button, Field, inputClass } from "./ui";
import { toInputDate } from "../lib/format";
import { EXPENSE_CATEGORY_LABELS, MILESTONE_TYPE_LABELS, STATUS_LABELS, STATUS_ORDER } from "../lib/holidays";

const ErrorBox = ({ message }: { message: string | null }) =>
  message ? <p className="text-sm text-[var(--color-brick)] bg-[var(--color-brick-tint)] rounded-lg px-3 py-2">{message}</p> : null;

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "We couldn't save that. Please check the details and try again.");

/** Blank input → null, otherwise the number. */
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function FormButtons({ onCancel, saving, label }: { onCancel: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-3 pt-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : label}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function HolidayPlanForm({ initial, onSaved, onCancel }: { initial?: HolidayDetail; onSaved: (plan: HolidayDetail) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [status, setStatus] = useState<HolidayStatus>(initial?.status ?? "PLANNING");
  const [startDate, setStartDate] = useState(toInputDate(initial?.startDate));
  const [endDate, setEndDate] = useState(toInputDate(initial?.endDate));
  const [travellers, setTravellers] = useState(String(initial?.travellers ?? 1));
  const [budget, setBudget] = useState(initial?.budget != null ? String(initial.budget) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please name this holiday.");
    if (startDate && endDate && endDate < startDate) return setError("The return date can't be before the departure date.");
    setSaving(true);
    try {
      const body = {
        name, destination: destination || null, status, startDate: startDate || null, endDate: endDate || null,
        travellers: Number(travellers) || 1, budget: numOrNull(budget), notes: notes || null,
      };
      const saved = initial ? await api.put<HolidayDetail>(`/holidays/${initial.id}`, body) : await api.post<HolidayDetail>("/holidays", body);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBox message={error} />
      <Field label="Holiday name" htmlFor="hol-name" hint="e.g. “Japan – cherry blossoms”, “Christmas at the coast”">
        <input id="hol-name" required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Destination (optional)" htmlFor="hol-dest">
        <input id="hol-dest" className={inputClass} value={destination} onChange={(e) => setDestination(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Departing (optional)" htmlFor="hol-start">
          <input id="hol-start" type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Returning (optional)" htmlFor="hol-end">
          <input id="hol-end" type="date" className={inputClass} min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Travellers" htmlFor="hol-travellers">
          <input id="hol-travellers" type="number" min="1" step="1" className={inputClass} value={travellers} onChange={(e) => setTravellers(e.target.value)} />
        </Field>
        <Field label="Overall budget (optional)" htmlFor="hol-budget" hint="The most you want to spend, in AUD.">
          <input id="hol-budget" type="number" min="0" step="0.01" className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
      </div>
      <Field label="Where are you up to?" htmlFor="hol-status">
        <select id="hol-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as HolidayStatus)}>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes (optional)" htmlFor="hol-notes">
        <textarea id="hol-notes" rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormButtons onCancel={onCancel} saving={saving} label={initial ? "Save changes" : "Create holiday"} />
    </form>
  );
}

// ---------------------------------------------------------------------------
export function HolidayExpenseForm({ planId, initial, onSaved, onCancel }: { planId: string; initial?: HolidayExpense; onSaved: (plan: HolidayDetail) => void; onCancel: () => void }) {
  const [category, setCategory] = useState<HolidayExpenseCategory>(initial?.category ?? "FLIGHTS");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [estimated, setEstimated] = useState(initial ? String(initial.estimatedAmount) : "");
  const [actual, setActual] = useState(initial?.actualAmount != null ? String(initial.actualAmount) : "");
  const [dueDate, setDueDate] = useState(toInputDate(initial?.dueDate));
  const [paidDate, setPaidDate] = useState(toInputDate(initial?.paidDate));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim()) return setError("Please describe this expense.");
    if (estimated === "" && actual === "") return setError("Enter an estimate, or the real amount if you already know it.");
    setSaving(true);
    try {
      const body = {
        category, description, estimatedAmount: Number(estimated || actual), actualAmount: numOrNull(actual),
        dueDate: dueDate || null, paidDate: paidDate || null, notes: notes || null,
      };
      const saved = initial ? await api.put<HolidayDetail>(`/holidays/${planId}/expenses/${initial.id}`, body) : await api.post<HolidayDetail>(`/holidays/${planId}/expenses`, body);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBox message={error} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="hx-cat">
          <select id="hx-cat" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as HolidayExpenseCategory)}>
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What is it?" htmlFor="hx-desc">
          <input id="hx-desc" required className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Return flights" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Estimated cost" htmlFor="hx-est" hint="Your best guess, in AUD.">
          <input id="hx-est" type="number" min="0" step="0.01" className={inputClass} value={estimated} onChange={(e) => setEstimated(e.target.value)} />
        </Field>
        <Field label="Actual cost (optional)" htmlFor="hx-act" hint="Once you have a quote or invoice.">
          <input id="hx-act" type="number" min="0" step="0.01" className={inputClass} value={actual} onChange={(e) => setActual(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pay by (optional)" htmlFor="hx-due" hint="Shows on the timeline.">
          <input id="hx-due" type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Paid on (optional)" htmlFor="hx-paid" hint="Leave blank if not paid yet.">
          <input id="hx-paid" type="date" className={inputClass} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)" htmlFor="hx-notes">
        <textarea id="hx-notes" rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormButtons onCancel={onCancel} saving={saving} label={initial ? "Save changes" : "Add expense"} />
    </form>
  );
}

// ---------------------------------------------------------------------------
export function HolidayMilestoneForm({ planId, initial, onSaved, onCancel }: { planId: string; initial?: HolidayMilestone; onSaved: (plan: HolidayDetail) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState<HolidayMilestoneType>(initial?.type ?? "BOOKING");
  const [date, setDate] = useState(toInputDate(initial?.date));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Please give this a title.");
    if (!date) return setError("Please choose a date.");
    setSaving(true);
    try {
      const body = { title, type, date, done: initial?.done ?? false, notes: notes || null };
      const saved = initial ? await api.put<HolidayDetail>(`/holidays/${planId}/milestones/${initial.id}`, body) : await api.post<HolidayDetail>(`/holidays/${planId}/milestones`, body);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBox message={error} />
      <Field label="What needs to happen?" htmlFor="hm-title" hint="e.g. “Book flights”, “Renew passport”, “Buy travel insurance”">
        <input id="hm-title" required className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="hm-type">
          <select id="hm-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as HolidayMilestoneType)}>
            {Object.entries(MILESTONE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Do it by" htmlFor="hm-date">
          <input id="hm-date" type="date" required className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)" htmlFor="hm-notes">
        <textarea id="hm-notes" rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormButtons onCancel={onCancel} saving={saving} label={initial ? "Save changes" : "Add to timeline"} />
    </form>
  );
}
