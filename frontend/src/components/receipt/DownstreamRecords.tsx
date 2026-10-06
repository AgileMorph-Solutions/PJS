import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ReceiptLinks } from "../../repository/api";

const n = (x: number | null | undefined, unit = "") => (x === null || x === undefined ? "—" : `${x.toLocaleString()}${unit}`);
const t = (x: string | null | undefined) => (x && String(x).trim() ? x : "—");

function Section({
  icon,
  title,
  source,
  count,
  emptyText,
  children,
}: {
  icon: string;
  title: string;
  /** Which workbook these rows come from — so nobody wonders where a number was found. */
  source: string;
  count: number;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
      <header className="flex items-center gap-2.5 px-5 py-3.5 border-b border-warmstone-100">
        <span className={`material-symbols-outlined text-[20px] ${count ? "text-brand-700" : "text-warmstone-300"}`}>{icon}</span>
        <h3 className="text-[14px] font-bold text-warmstone-900">{title}</h3>
        <span className="text-[11.5px] text-warmstone-400">from {source}</span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-[11px] font-bold ${count ? "bg-brand-50 text-brand-800 border border-brand-200" : "bg-warmstone-100 text-warmstone-400"}`}>
          {count}
        </span>
      </header>
      {count === 0 ? <p className="px-5 py-4 text-[13px] text-warmstone-400">{emptyText}</p> : <div className="divide-y divide-warmstone-100">{children}</div>}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide font-semibold text-warmstone-400">{label}</dt>
      <dd className="text-[13px] font-medium text-warmstone-800 tabular-nums truncate">{value}</dd>
    </div>
  );
}

function Row({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-5 py-3.5">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-[13px] font-bold text-warmstone-900">{title}</span>
        {sub && <span className="text-[12px] text-warmstone-500">{sub}</span>}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-2.5">{children}</dl>
    </div>
  );
}

/** Every row from the other workbooks that carries this Lot (or this receipt's Fiche), shown in full
 * — the point of the page is that none of it needs a visit to another sidebar entry. Sections stay
 * visible when empty so it is plain which steps this Lot has not reached yet. */
export function DownstreamRecords({ links, loading }: { links: ReceiptLinks | null; loading: boolean }) {
  if (loading) return <p className="text-[13px] text-warmstone-400 animate-pulse px-1">Gathering this Lot's records…</p>;
  if (!links) return <p className="text-[13px] text-warmstone-500 px-1">Linked records couldn't be loaded.</p>;

  return (
    <div className="space-y-4">
      <Section icon="light_mode" title="Drying" source="Drying Batch sheet" count={links.dryingBatches.length + links.dryingJobs.length} emptyText="This Lot has not been issued to drying.">
        {links.dryingBatches.map((b) => (
          <Row key={b.id} title={`Batch ${b.sn} · ${b.status ?? "—"}`} sub={b.dryingDate}>
            <Fact label="Method" value={t(b.dryType)} />
            <Fact label="Bin in → out" value={`${t(b.sourceBinNo)} → ${t(b.destinationBinNo)}`} />
            <Fact label="Bags in → out" value={`${n(b.inputBags)} → ${n(b.outputBags)}`} />
            <Fact label="Net in → out" value={`${n(b.issuedNetWeightKg)} → ${n(b.receivedNetWeightKg)}`} />
            <Fact label="Moisture" value={`${n(b.inputMoisturePct, "%")} → ${n(b.outputMoisturePct, "%")}`} />
            <Fact label="KOR" value={`${n(b.inputKor)} → ${n(b.outputKor)}`} />
            <Fact label="Weight loss" value={n(b.dryingLossKg, " kg")} />
            <Fact label="Site" value={t(b.warehouseSite)} />
          </Row>
        ))}
        {links.dryingJobs.map((d) => (
          <Row key={d.id} title={`Drying job ${d.id} · ${d.status}`} sub={d.date}>
            <Fact label="Method" value={t(d.dryType)} />
            <Fact label="Bin" value={t(d.bin)} />
            <Fact label="Destination" value={t(d.destination)} />
            <Fact label="Warehouse" value={t(d.warehouse)} />
          </Row>
        ))}
      </Section>

      <Section icon="local_shipping" title="Dispatch to the factory" source="Chargement sheet" count={links.dispatches.length} emptyText="Not dispatched yet.">
        {links.dispatches.map((d) => (
          <Row key={d.id} title={`Voyage ${t(d.vyogeNumber)}`} sub={d.chargeDate}>
            <Fact label="From" value={t(d.warehouseSite)} />
            <Fact label="Bin" value={t(d.bin)} />
            <Fact label="Truck" value={t(d.truckNo)} />
            <Fact label="Transporter" value={t(d.transporter)} />
            <Fact label="Driver" value={t(d.driver)} />
            <Fact label="Bags" value={n(d.totalBags)} />
            <Fact label="Net weight" value={n(d.netWeight, " kg")} />
          </Row>
        ))}
      </Section>

      <Section icon="factory" title="Received at the factory" source="Warehouse Receiving sheet" count={links.warehouseReceiving.length} emptyText="Not received at the central warehouse yet.">
        {links.warehouseReceiving.map((w) => (
          <Row key={w.id} title={`${w.warehouseSite} · SN ${w.sn}`} sub={w.arrivalDate}>
            <Fact label="Lot there" value={t(w.lotNo)} />
            <Fact label="Truck" value={t(w.truckNo)} />
            <Fact label="Bags received" value={n(w.totalRecd)} />
            <Fact label="Net weight" value={n(w.netWeight, " kg")} />
          </Row>
        ))}
      </Section>

      <Section icon="swap_horiz" title="Transfer receipts" source="Receiving at Factory report" count={links.transfers.length} emptyText="No transfer receipt yet.">
        {links.transfers.map((x) => (
          <Row key={x.sn} title={`SN ${x.sn} · ${x.sourceWarehouse} → ${t(x.destinationWarehouse)}`} sub={x.receivedDate}>
            <Fact label="Truck" value={t(x.truckRegistration)} />
            <Fact label="Bin" value={t(x.binNo)} />
            <Fact label="Bags sent → received" value={`${n(x.bagsDispatched)} → ${n(x.bagsReceived)}`} />
            <Fact label="Net sent" value={n(x.netWeightDispatched, " kg")} />
            <Fact label="Production BTM" value={t(x.idTransfer)} />
          </Row>
        ))}
      </Section>

      <Section icon="precision_manufacturing" title="Production" source="Production workbooks" count={links.btmIntakes.length + links.issuedToProduction.length} emptyText="Not issued to production yet.">
        {links.btmIntakes.map((b) => (
          <Row key={b.btmNo} title={`BTM ${b.btmNo}`}>
            <Fact
              label="Production bin"
              value={<Link to={`/production/btm/${encodeURIComponent(b.btmNo)}`} className="text-brand-700 hover:text-brand-800 font-semibold">{t(b.binNo)}</Link>}
            />
          </Row>
        ))}
        {links.issuedToProduction.map((p) => (
          <Row key={p.id} title={`Issued · BTM ${t(p.btmNo)}`} sub={p.date}>
            <Fact label="Source bin" value={t(p.sourceBin)} />
            <Fact label="Dry bin" value={t(p.dryBin)} />
            <Fact label="Bin status" value={t(p.binStatus)} />
          </Row>
        ))}
      </Section>
    </div>
  );
}
