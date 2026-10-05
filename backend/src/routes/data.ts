import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { asyncHandler, FriendlyError } from "../middleware/errorHandler";
import { buildExportCsv } from "../services/dataTransfer/exportData";
import { runImport } from "../services/dataTransfer/importData";
import { EXPORT_SCOPES, isExportScope } from "../services/dataTransfer/sections";
import { exportIncomeExpenses, importIncomeExpenses, templateIncomeExpenses } from "../services/dataTransfer/humanCsv";

const router = Router();
router.use(requireAuth);

function householdOf(req: AuthedRequest): string {
  if (!req.householdId) throw new FriendlyError("Please finish setting up your household first.", 400);
  return req.householdId;
}

// Download everything in the household as one CSV file — or, with ?scope=properties|investments, just that portfolio.
router.get(
  "/export",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const scope = req.query.scope === undefined ? "all" : req.query.scope;
    if (!isExportScope(scope)) throw new FriendlyError("Please choose what to export: your properties or your investments.", 400);
    const stamp = new Date().toISOString().slice(0, 10);
    const csv = await buildExportCsv(householdId, req.userId!, new Date(), scope);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${EXPORT_SCOPES[scope].fileName(stamp)}"`);
    res.setHeader("Cache-Control", "no-store");
    // The leading BOM makes Excel read the file as UTF-8.
    res.send("\uFEFF" + csv);
  })
);

// The simple income & expenses CSV. Personal portfolios get income and expenses; company portfolios get sales and
// expenses (with GST). Readable column names, no IDs — the same file works as the export, the template and the import.
function sendCsv(res: import("express").Response, csv: string, fileName: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send("\uFEFF" + csv); // the BOM makes Excel read it as UTF-8
}

router.get(
  "/income-expenses/export",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { csv, fileName } = await exportIncomeExpenses(householdOf(req));
    sendCsv(res, csv, fileName);
  })
);

router.get(
  "/income-expenses/template",
  asyncHandler(async (req: AuthedRequest, res) => {
    const { csv, fileName } = await templateIncomeExpenses(householdOf(req));
    sendCsv(res, csv, fileName);
  })
);

const incomeExpensesImportSchema = z.object({
  csv: z.string().min(1, "Please choose a file."),
  /** true = only check the file and report what would happen; false = import. */
  dryRun: z.boolean().default(true),
  /** Also add rows that match something you already have. */
  importDuplicates: z.boolean().default(false),
});

router.post(
  "/income-expenses/import",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const { csv, dryRun, importDuplicates } = incomeExpensesImportSchema.parse(req.body);
    res.json(await importIncomeExpenses(csv, householdId, req.userId!, { dryRun, importDuplicates }));
  })
);

const importSchema = z.object({
  csv: z.string().min(1, "Please choose a file."),
  /** true = only report what would happen; false = actually import. */
  dryRun: z.boolean().default(true),
  /** Also apply the name, timezone and display preferences saved in the file. */
  includeProfile: z.boolean().default(true),
  /** all = the Backup & restore import; properties / investments = a portfolio import from that dashboard. */
  scope: z.enum(["all", "properties", "investments"]).default("all"),
});

router.post(
  "/import",
  asyncHandler(async (req: AuthedRequest, res) => {
    const householdId = householdOf(req);
    const { csv, dryRun, includeProfile, scope } = importSchema.parse(req.body);
    const result = await runImport(csv, householdId, req.userId!, { dryRun, includeProfile, scope });
    res.json(result);
  })
);

export default router;
