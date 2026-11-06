import { describe, it, expect } from "vitest";
import { canTakeMoistureCheck, canWeigh, rcnReceiptStatus } from "../src/domain/rcnReceipt";
import { emptyPalletCountNote, finalWeightError, palletError, weighingTotals } from "../src/domain/rcnWeighing";

/**
 * BTM 130 exactly as in the client's "19. RCN Receipts Tally Sheet" (Online sheet, 17/08/2026, BIN-10 → ANA-10):
 * 45 pallets as [gross kg, bags], the ten empty-pallet weighings, dust 925.7 and voids 0.5. Their own pivot
 * (Sheet1) gives gross 102,017.8, bags weight 848.9, pallet weight 3,159.2 and net 98,009.7 for it.
 */
const BTM_130: [number, number][] = [[2308.9, 30], [2270.3, 31], [964.8, 12], [2429, 29], [2368.3, 30], [2049.2, 28], [2228.6, 30], [2418.5, 30], [2490.7, 30], [2333.2, 30], [2806.4, 35], [1852, 24], [2510.2, 30], [2259.3, 30], [2300.8, 30], [2490.9, 30], [2457.2, 32], [2255, 30], [2306.4, 29], [2318.7, 30], [2461.8, 30], [2372.7, 30], [2257, 29], [2388.1, 31], [2609.3, 34], [2047.9, 25], [2182.1, 30], [2495.2, 31], [2322.3, 30], [1844.9, 24], [1959.4, 24], [2297.8, 30], [2183.9, 31], [1205.2, 15], [2558.2, 31], [2380.3, 35], [2394, 30], [2456.4, 30], [2288.7, 30], [2406.8, 30], [2523.4, 30], [2296, 31], [2375.3, 30], [2246.7, 30], [2046, 25]];
const BTM_130_EMPTY = [374.3, 211.2, 219.9, 221.4, 394.9, 445.8, 214.2, 452.1, 300, 325.4];

const pallets = BTM_130.map(([g, b]) => ({ grossKg: String(g), bags: String(b) }));
const emptyPallets = BTM_130_EMPTY.map((w) => ({ weightKg: String(w), count: "" }));

describe("weighing totals, as the client's tally sheet", () => {
  it("reproduces their pivot for BTM 130 to the decimal", () => {
    expect(weighingTotals(pallets, { emptyPallets, dustKg: "925.7", voidsKg: "0.5" })).toEqual({
      pallets: 45,
      bags: 1306,
      grossKg: 102017.8,
      bagsKg: 848.9,
      palletKg: 3159.2,
      netKg: 98009.7,
      dustKg: 925.7,
      voidsKg: 0.5,
      toSilosKg: 97083.5,
    });
  });

  it("gives a running total while pallets are still being weighed", () => {
    const t = weighingTotals(pallets.slice(0, 2));
    expect(t).toMatchObject({ pallets: 2, bags: 61, grossKg: 4579.2, bagsKg: 39.65, palletKg: 0, netKg: 4539.55, toSilosKg: 4539.55 });
  });

  it("treats blank dust and voids as not recorded (BTM 131 onward has none)", () => {
    expect(weighingTotals(pallets, { emptyPallets }).toSilosKg).toBe(98009.7);
  });
});

describe("pallet form", () => {
  const ok = { grossKg: "2308.9", bags: "30", factoryBin: "ANA-10" };

  it("accepts a real row", () => expect(palletError(ok)).toBeNull());

  it("refuses what can't be a pallet, and says why", () => {
    expect(palletError({ ...ok, grossKg: "" })).toMatch(/gross weight/);
    expect(palletError({ ...ok, grossKg: "0" })).toMatch(/above 0/);
    expect(palletError({ ...ok, bags: "30.5" })).toMatch(/whole number/);
    expect(palletError({ ...ok, factoryBin: " " })).toMatch(/factory bin/);
  });
});

describe("final weight form", () => {
  it("needs a weighed pallet and the empty pallets' weight; dust and voids are optional", () => {
    expect(finalWeightError({ emptyPallets }, 0)).toMatch(/at least one pallet/);
    expect(finalWeightError({ emptyPallets: [] }, 45)).toMatch(/empty pallets' weight/);
    expect(finalWeightError({ emptyPallets: [{ weightKg: "", count: "" }] }, 45)).toMatch(/empty pallets' weight/);
    expect(finalWeightError({ emptyPallets }, 45)).toBeNull();
    expect(finalWeightError({ emptyPallets, dustKg: "925.7", voidsKg: "0.5" }, 45)).toBeNull();
  });

  it("refuses bad numbers", () => {
    expect(finalWeightError({ emptyPallets: [{ weightKg: "-3" }] }, 1)).toMatch(/above 0/);
    expect(finalWeightError({ emptyPallets: [{ weightKg: "300", count: "4.5" }] }, 1)).toMatch(/whole number/);
    expect(finalWeightError({ emptyPallets, dustKg: "-1" }, 45)).toMatch(/Dust/);
  });

  it("notes, without refusing, empty-pallet counts that don't match the pallets weighed", () => {
    expect(emptyPalletCountNote([{ weightKg: "300", count: "20" }, { weightKg: "400", count: "25" }], 45)).toBeNull();
    expect(emptyPalletCountNote([{ weightKg: "300", count: "20" }], 45)).toMatch(/add up to 20, but 45 pallets were weighed/);
    expect(emptyPalletCountNote(emptyPallets, 45)).toBeNull(); // no counts typed, as in the Online sheet
  });
});

describe("receipt status through weighing", () => {
  const ok = [{ status: "approved", decision: "ok" }] as const;

  it("waits for weighing, then is weighing once a pallet is on, then Intake done", () => {
    expect(rcnReceiptStatus([...ok])).toBe("waiting_for_weighing");
    expect(rcnReceiptStatus([...ok], { pallets: 3, finalised: false })).toBe("weighing");
    expect(rcnReceiptStatus([...ok], { pallets: 3, finalised: true })).toBe("intake_done");
  });

  it("only weighs after an OK moisture check and before the final weight", () => {
    const statuses = ["waiting_for_moisture", "moisture_pending", "on_hold", "waiting_for_weighing", "weighing", "intake_done"] as const;
    expect(statuses.map(canWeigh)).toEqual([false, false, false, true, true, false]);
    expect(statuses.map(canTakeMoistureCheck)).toEqual([true, false, true, false, false, false]);
  });
});
