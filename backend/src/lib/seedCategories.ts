import type { PrismaClient } from "@prisma/client";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "./constants";

/** Gives a brand-new portfolio the standard Australian income and expense categories. */
export async function seedDefaultCategories(db: Pick<PrismaClient, "category">, householdId: string): Promise<void> {
  await db.category.createMany({
    data: [
      ...INCOME_CATEGORIES.map((name) => ({ name, direction: "INCOME" as const, householdId })),
      ...EXPENSE_CATEGORIES.map((name) => ({ name, direction: "EXPENSE" as const, householdId })),
    ],
  });
}
