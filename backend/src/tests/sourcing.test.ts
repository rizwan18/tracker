import { describe, it, expect } from "vitest";
import { computeSourcingCosts, goodsCostCents, toAudEstimateCents } from "../services/business/sourcing";

describe("sourcing cost arithmetic", () => {
  it("works out the goods cost from quantity × unit cost, rounding to whole cents", () => {
    expect(goodsCostCents(100, 250)).toBe(25000); // 100 units at $2.50
    expect(goodsCostCents(12.5, 199)).toBe(Math.round(12.5 * 199)); // fractional quantity (e.g. kg)
  });

  it("adds shipping (freight + customs + insurance + other) and inspection costs on top of goods", () => {
    const costs = computeSourcingCosts({
      quantity: 500,
      unitCostCents: 120, // $600 goods
      shipments: [{ freightCostCents: 15000, customsDutyCents: 5000, insuranceCostCents: 1000, otherCostCents: 0 }],
      inspections: [{ costCents: 8000 }],
      payments: [],
    });
    expect(costs.goodsCostCents).toBe(60000);
    expect(costs.shippingCostCents).toBe(21000);
    expect(costs.inspectionCostCents).toBe(8000);
    expect(costs.totalCostCents).toBe(60000 + 21000 + 8000);
  });

  it("sums multiple shipments and inspections, and tracks paid vs. balance across several payments", () => {
    const costs = computeSourcingCosts({
      quantity: 1000,
      unitCostCents: 100, // $1,000 goods
      shipments: [
        { freightCostCents: 10000, customsDutyCents: 2000, insuranceCostCents: 500, otherCostCents: 0 },
        { freightCostCents: 5000, customsDutyCents: 0, insuranceCostCents: 0, otherCostCents: 1000 },
      ],
      inspections: [{ costCents: 3000 }, { costCents: 1500 }],
      payments: [{ amountCents: 50000 }, { amountCents: 20000 }],
    });
    expect(costs.shippingCostCents).toBe(18500);
    expect(costs.inspectionCostCents).toBe(4500);
    expect(costs.totalCostCents).toBe(100000 + 18500 + 4500);
    expect(costs.paidCents).toBe(70000);
    expect(costs.balanceCents).toBe(costs.totalCostCents - 70000);
  });

  it("adds transaction fees to the total cost without changing what's owed to the supplier", () => {
    const base = { quantity: 100, unitCostCents: 1000, shipments: [], inspections: [] }; // $1,000 goods
    const noFee = computeSourcingCosts({ ...base, payments: [{ amountCents: 40000 }] });
    const withFee = computeSourcingCosts({ ...base, payments: [{ amountCents: 40000, feeCents: 2500 }] });

    expect(withFee.transactionFeeCents).toBe(2500);
    expect(withFee.totalCostCents).toBe(noFee.totalCostCents + 2500); // extra cost of the order
    expect(withFee.paidCents).toBe(42500); // cash out includes the fee
    expect(withFee.balanceCents).toBe(noFee.balanceCents); // supplier balance is untouched: $600 still to pay
    expect(withFee.balanceCents).toBe(60000);
  });

  it("sums fees across several payments, and treats a missing fee as zero", () => {
    const costs = computeSourcingCosts({
      quantity: 1, unitCostCents: 100000, shipments: [], inspections: [],
      payments: [{ amountCents: 30000, feeCents: 1500 }, { amountCents: 70000 }, { amountCents: 0, feeCents: 500 }],
    });
    expect(costs.transactionFeeCents).toBe(2000);
    expect(costs.totalCostCents).toBe(102000);
    expect(costs.paidCents).toBe(102000);
    expect(costs.balanceCents).toBe(0); // fully paid, fees included
  });

  it("treats an order with no shipments/inspections/payments as goods cost only, fully outstanding", () => {
    const costs = computeSourcingCosts({ quantity: 10, unitCostCents: 500, shipments: [], inspections: [], payments: [] });
    expect(costs).toEqual({ goodsCostCents: 5000, shippingCostCents: 0, inspectionCostCents: 0, transactionFeeCents: 0, totalCostCents: 5000, paidCents: 0, balanceCents: 5000 });
  });
});

describe("AUD estimate", () => {
  it("returns the amount unchanged for AUD orders regardless of any stray exchange rate", () => {
    expect(toAudEstimateCents(10000, "AUD", 1.5)).toBe(10000);
    expect(toAudEstimateCents(10000, "AUD", null)).toBe(10000);
  });

  it("multiplies by the exchange rate for a foreign-currency order", () => {
    expect(toAudEstimateCents(10000, "USD", 1.52)).toBe(Math.round(10000 * 1.52));
  });

  it("falls back to the face-value amount when no exchange rate has been recorded yet", () => {
    expect(toAudEstimateCents(10000, "CNY", null)).toBe(10000);
    expect(toAudEstimateCents(10000, "CNY", undefined)).toBe(10000);
  });
});
