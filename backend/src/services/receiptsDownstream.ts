/**
 * Per-receipt downstream status flags for the Reception list — dispatched / received / dried /
 * issued — so everything that used to be its own sidebar page (Dispatch to Central, Receiving from
 * Unit, Issue to Production) is visible as a status chip on Reception instead, with the full rows
 * available on the receipt detail page (see receiptLinks.ts).
 *
 * Computed with a handful of grouped queries and in-memory Set lookups, never one query per
 * receipt — the join keys are the same ones receiptLinks.ts uses, so a receipt with no matches
 * here is exactly a receipt whose detail page's linked-records card would also come up empty.
 */
import { prisma } from "../db.js";
import { resolveSite } from "../domain/site.js";

export interface DownstreamStatus {
  receiptId: string;
  dispatched: boolean;
  received: boolean;
  dried: boolean;
  issued: boolean;
}

export async function getDownstreamStatus(site?: string[]): Promise<Map<string, DownstreamStatus>> {
  // WarehouseDischarge.warehouseSite stores the sheet's own verbatim site name (e.g.
  // "YAMOUSSOUKRO" for central, not the canonical "YAKRO FACTORY") — resolveSite() expands the
  // canonical name to every real alias/store a source row might carry, same as every other
  // site-scoped query in this codebase.
  const centralSite = await resolveSite("YAKRO FACTORY");

  const [receipts, dispatchFiches, centralReceivingFiches, dryingBatches, transferIdsByLot] = await Promise.all([
    prisma.receipt.findMany({
      where: site ? { warehouse: { in: site } } : {},
      select: {
        id: true,
        verify: { select: { fiche: true } },
        lot: { select: { lotNumber: true, warehouseName: true } },
      },
    }),
    prisma.warehouseDispatchLine.findMany({ where: { ficheCca: { not: null } }, select: { ficheCca: true } }),
    prisma.warehouseDischarge.findMany({
      where: { warehouseSite: { in: centralSite } },
      select: { ficheCca: true },
    }),
    prisma.dryingBatch.findMany({ select: { ficheNoRaw: true, lotNo: true, warehouseSite: true } }),
    prisma.juteWarehouseTransferReceipt.findMany({
      where: { idTransfer: { not: null } },
      select: { lotNo: true, noFiche: true, idTransfer: true },
    }),
  ]);

  // MEASURED (2026-09-28): CHARGEMENT's "No.FicheCCA" column is the same real-world concept as
  // DISCHARGEMENT's own "No. Fiche CCA" (WarehouseDischarge.ficheCca, which DOES match Receipt
  // fiches directly), but its actual values are a genuinely disjoint numeric range — 0 of 402
  // non-null CHARGEMENT fiches match either a receipt's fiche OR a WarehouseDischarge row's fiche.
  // Not a parsing bug (checked both ways); a real gap in the source data this app doesn't invent a
  // fix for — `dispatched` will read false for nearly every receipt until CHARGEMENT starts
  // recording the same fiche series the rest of the pipeline uses.
  const dispatchedFicheSet = new Set(dispatchFiches.map((d) => d.ficheCca!.trim()));
  const receivedFicheSet = new Set(centralReceivingFiches.map((r) => r.ficheCca.trim()));

  const driedFicheSet = new Set<string>();
  const driedLotSiteSet = new Set<string>();
  for (const b of dryingBatches) {
    const fiche = b.ficheNoRaw?.trim();
    if (fiche) driedFicheSet.add(fiche);
    else if (b.lotNo && b.warehouseSite) driedLotSiteSet.add(`${b.lotNo.trim()}::${b.warehouseSite.trim()}`);
  }

  // issued <- transfer.idTransfer -> BtmIntake.btmNo -> IssuedToProduction.btmNo, reached here via
  // a transfer sharing this receipt's own Lot OR its Fiche -> that transfer's idTransfer. Never
  // IssuedToProduction.ficheNo directly — see production_issue_fiche_column_contaminated. The Fiche
  // is what reaches a transfer at another warehouse: since the Oct 2026 ID standardisation a Lot
  // carries its own warehouse's code, so it only ever matches within one warehouse (receiptLinks.ts).
  const idTransfersByLot = new Map<string, string[]>();
  const idTransfersByFiche = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, key: string | null | undefined, v: string) => {
    const k = key?.trim();
    if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  };
  for (const t of transferIdsByLot) {
    push(idTransfersByLot, t.lotNo, t.idTransfer!.trim());
    push(idTransfersByFiche, t.noFiche, t.idTransfer!.trim());
  }
  const allBtmNos = [...new Set(transferIdsByLot.map((t) => t.idTransfer!.trim()))];
  const issuedBtmNos = allBtmNos.length
    ? new Set(
        (await prisma.issuedToProduction.findMany({
          where: { btmNo: { in: allBtmNos } }, select: { btmNo: true },
        })).map((r) => r.btmNo!.trim())
      )
    : new Set<string>();

  const result = new Map<string, DownstreamStatus>();
  for (const r of receipts) {
    const fiche = r.verify?.fiche?.trim() || null;
    const lot = r.lot?.lotNumber?.trim() || null;
    const lotSite = r.lot?.warehouseName?.trim() || null;

    const dried = !!fiche && driedFicheSet.has(fiche)
      ? true
      : !!(lot && lotSite && driedLotSiteSet.has(`${lot}::${lotSite}`));

    const transfers = [...(lot ? idTransfersByLot.get(lot) ?? [] : []), ...(fiche ? idTransfersByFiche.get(fiche) ?? [] : [])];
    const issued = transfers.some((btm) => issuedBtmNos.has(btm));

    result.set(r.id, {
      receiptId: r.id,
      dispatched: !!fiche && dispatchedFicheSet.has(fiche),
      received: !!fiche && receivedFicheSet.has(fiche),
      dried,
      issued,
    });
  }
  return result;
}
