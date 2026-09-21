import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import type { Portfolio } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { Button, Card, SectionHeading, inputClass } from "../components/ui";
import { Modal } from "../components/Modal";
import { PortfolioAddForm } from "../components/PortfolioAddForm";
import { PortfolioTypeBadge } from "../components/PortfolioTypeBadge";
import { BusinessProfileCard } from "../components/business/BusinessProfileCard";

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuth();
  const { portfolios, active, rename } = usePortfolio();
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [renaming, setRenaming] = useState<Portfolio | null>(null);
  const [newName, setNewName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  async function saveRename() {
    if (!renaming) return;
    if (!newName.trim()) return setRenameError("Please give this portfolio a name.");
    try {
      await rename(renaming.id, newName.trim());
      setRenaming(null);
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : "We couldn't rename this portfolio. Please try again.");
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <SectionHeading title="Settings" />

      <Card>
        <h3 className="font-display font-semibold mb-1">Your details</h3>
        <p className="text-sm text-[var(--color-ink-soft)] mb-3">{user?.fullName} · {user?.email}</p>
      </Card>

      {active?.type === "COMPANY" && <BusinessProfileCard />}

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold">Your portfolios</h3>
            <p className="text-sm text-[var(--color-ink-soft)] mt-1 max-w-sm">
              Keep personal, company, trust or other finances separate. With more than one, you'll choose which to open after signing in.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            + Add portfolio
          </Button>
        </div>
        <ul className="mt-4 divide-y divide-[var(--color-line)]">
          {portfolios.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {p.name}
                  {active?.id === p.id && <span className="ml-2 text-xs text-[var(--color-eucalyptus)]">open now</span>}
                </p>
                <PortfolioTypeBadge type={p.type} />
              </div>
              <button
                onClick={() => {
                  setRenaming(p);
                  setNewName(p.name);
                  setRenameError(null);
                }}
                className="text-xs text-[var(--color-sky)] px-2 py-1 hover:underline"
              >
                Rename
              </button>
            </li>
          ))}
        </ul>
        {justAdded && portfolios.length > 1 && (
          <p role="status" className="text-sm text-[var(--color-eucalyptus-dark)] bg-[var(--color-eucalyptus-tint)] rounded-lg px-3 py-2 mt-3">
            Portfolio added. You now have {portfolios.length}, so you'll be asked which to open each time you sign in.
          </p>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold">Easy View</h3>
            <p className="text-sm text-[var(--color-ink-soft)] max-w-sm mt-1">Larger text, bigger buttons, and simpler screens — good if you're using a phone or prefer less on the page.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={user?.easyViewEnabled ?? false}
              onChange={(e) => updateUser({ easyViewEnabled: e.target.checked })}
            />
            <div className="w-12 h-7 bg-[var(--color-line)] peer-checked:bg-[var(--color-eucalyptus)] rounded-full transition-colors" />
            <div className="absolute left-1 top-1 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
          </label>
        </div>
      </Card>

      <Card>
        <h3 className="font-display font-semibold mb-1">About your data</h3>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Your financial information is only visible to you and members of your household. This app is a record-keeping and planning tool — it does not give tax or
          financial advice. Always review your records with a registered tax professional or financial adviser.
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold">Import / Export</h3>
            <p className="text-sm text-[var(--color-ink-soft)] mt-1">Export or import your property and investment portfolios as CSV files.</p>
          </div>
          <Link to="/import-export">
            <Button size="sm" variant="secondary">
              Open
            </Button>
          </Link>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold">Your data</h3>
            <p className="text-sm text-[var(--color-ink-soft)] mt-1">Download everything as a CSV backup, or import a file you saved earlier.</p>
          </div>
          <Link to="/data">
            <Button size="sm" variant="secondary">
              Open
            </Button>
          </Link>
        </div>
      </Card>

      <button onClick={logout} className="text-sm text-[var(--color-brick)] font-medium">
        Sign out
      </button>

      {adding && (
        <Modal title="Add a portfolio" onClose={() => setAdding(false)}>
          <PortfolioAddForm
            onCancel={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              setJustAdded(true);
            }}
          />
        </Modal>
      )}

      {renaming && (
        <Modal title="Rename portfolio" onClose={() => setRenaming(null)}>
          <div className="space-y-3">
            {renameError && (
              <p role="alert" className="text-sm text-[var(--color-brick)]">
                {renameError}
              </p>
            )}
            <input aria-label="Portfolio name" className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button onClick={saveRename}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
