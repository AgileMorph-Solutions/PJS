import { useState } from "react";
import type { TransferRequest } from "../../types/receipt";
import type { TransferEditPayload } from "../../repository/api";
import { Button } from "../ui/Button";
import { Card, CardTitle } from "../ui/Card";
import { DateInput } from "../ui/DateInput";
import { Field, Input, inputClass } from "../ui/Input";
import { lineLabel } from "./TransferPanel";

type Line = TransferRequest["lines"][number];
const str = (x: number | string | null | undefined) => (x === null || x === undefined ? "" : String(x));

/** The boxes of one line, as they are now. A lot's net weight starts blank when it is its share of the lot (worked out). */
const lineDraft = (l: Line) => ({ bags: str(l.bags), netWeightKg: str(l.netWeightKg), moisture: str(l.moisture), kor: str(l.kor), nutCount: str(l.nutCount), remove: false });

/**
 * Correcting what left on a BKT once made: an Admin (25 Nov 2026) or the sending warehouse's Incharge (26 Nov 2026). Every box starts at what is saved;
 * only what is changed is sent, and the server checks it as when it was first entered. What was worked out from the BKT
 * (stock, what is left of a lot, the variance) follows by itself; the truck number reaches each lot's reception.
 */
export function EditTransferForm({ t, saving, error, onSave, onCancel }: {
  t: TransferRequest;
  saving: boolean;
  error?: string | null;
  onSave: (p: TransferEditPayload) => Promise<boolean>;
  onCancel: () => void;
}) {
  const left = t.status !== "requested";
  const head = {
    transferDate: t.transferDate, remarks: str(t.remarks), truckNo: str(t.truckNo), transporter: str(t.transporter), driver: str(t.driver),
    driverPhone: str(t.driverPhone), dispatchedGrossKg: str(t.dispatchedGrossKg), dispatchWhReceiptNo: str(t.dispatchWhReceiptNo),
  };
  const [d, setD] = useState(head);
  const [lines, setLines] = useState<Record<number, ReturnType<typeof lineDraft>>>(() => Object.fromEntries(t.lines.map((l) => [l.id, lineDraft(l)])));
  const setLine = (id: number, patch: Partial<ReturnType<typeof lineDraft>>) => setLines((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));

  function changes(): TransferEditPayload {
    const out: TransferEditPayload = {};
    for (const k of Object.keys(head) as (keyof typeof head)[]) if (d[k].trim() !== head[k].trim()) out[k] = d[k];
    const lineOut: NonNullable<TransferEditPayload["lines"]> = [];
    for (const l of t.lines) {
      const now = lines[l.id]!;
      const was = lineDraft(l);
      if (now.remove) continue;
      const changed = (["bags", "netWeightKg", "moisture", "kor", "nutCount"] as const).filter((k) => now[k].trim() !== was[k].trim());
      if (changed.length) lineOut.push({ lineId: l.id, ...Object.fromEntries(changed.map((k) => [k, now[k]])) });
    }
    if (lineOut.length) out.lines = lineOut;
    const removing = t.lines.filter((l) => lines[l.id]!.remove).map((l) => l.id);
    if (removing.length) out.removeLines = removing;
    return out;
  }
  const pending = changes();
  const nothing = Object.keys(pending).length === 0;

  const box = (key: keyof typeof head, label: string, numeric = false) => (
    <Field label={label}><Input numeric={numeric} value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} /></Field>
  );

  return (
    <Card highlight>
      <form
        className="p-5 space-y-5"
        onSubmit={(e) => { e.preventDefault(); if (!nothing) void onSave(pending); }}
      >
        <div>
          <CardTitle>Edit {t.id}</CardTitle>
          <p className="text-[12px] text-warmstone-500 mt-1">
            As an Admin you can correct this BKT. Each change is checked as when it was first entered and kept in the change log.
            Stock and what is left of each lot follow by themselves; a new truck number reaches each lot's reception.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Date" hint="Stays in the year of the BKT number.">
            <DateInput value={d.transferDate} onChange={(v) => setD({ ...d, transferDate: v })} className={inputClass} />
          </Field>
          <div className="lg:col-span-3">{box("remarks", "Remarks")}</div>
        </div>

        {left && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {box("dispatchWhReceiptNo", "Warehouse receipt no.")}
            {box("truckNo", "Truck number")}
            {box("transporter", "Transporter")}
            {box("driver", "Driver")}
            {box("driverPhone", "Driver phone")}
            {box("dispatchedGrossKg", "Loaded weight (kg)", true)}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">On the truck</p>
          {t.lines.map((l) => {
            const v = lines[l.id]!;
            const locked = Boolean(l.receptionId);
            return (
              <div key={l.id} className={`grid sm:grid-cols-3 lg:grid-cols-7 gap-3 items-end rounded-xl border border-warmstone-200 p-3 ${v.remove ? "opacity-60" : ""}`}>
                <div className="lg:col-span-1">
                  <p className="text-[13px] font-medium text-warmstone-900">{lineLabel(l)}</p>
                  {locked && <p className="text-[12px] text-warmstone-500">Reception started: stays on the truck.</p>}
                </div>
                {(["bags", "netWeightKg", "moisture", "kor", "nutCount"] as const).map((k) => (
                  <Field key={k} label={{ bags: "Bags", netWeightKg: "Net (kg)", moisture: "Moisture (%)", kor: "KOR", nutCount: "Nut count" }[k]}
                    hint={k === "netWeightKg" && l.transferLotId ? "Blank: its share of the lot" : undefined}>
                    <Input numeric disabled={v.remove} value={v[k]} onChange={(e) => setLine(l.id, { [k]: e.target.value })} />
                  </Field>
                ))}
                <label className="flex items-center gap-2 text-[12px] font-semibold text-warmstone-700 pb-2">
                  <input type="checkbox" disabled={locked || t.lines.length === 1} checked={v.remove} onChange={(e) => setLine(l.id, { remove: e.target.checked })} />
                  Take off the truck
                </label>
              </div>
            );
          })}
        </div>

        {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="submit" icon="save" disabled={saving || nothing}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Card>
  );
}
