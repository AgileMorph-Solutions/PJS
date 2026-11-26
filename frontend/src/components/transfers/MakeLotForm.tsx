import { useEffect, useState, type FormEvent } from "react";
import { lotBinsProblems, type FieldProblem } from "@anagroci/contract/domain/transferLot";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import { Button } from "../ui/Button";
import { DateInput } from "../ui/DateInput";
import { Field, Input, inputClass, ProblemText } from "../ui/Input";
import { IconButton } from "../ui/IconButton";
import { SearchSelect, type SearchSelectOption } from "../ui/SearchSelect";
import type { TransferLotPayload } from "../../repository/api";

interface BinRow { binCode: string; bags: string }

/**
 * "Make a lot to send" (24 Nov 2026): the bags taken out of one or more Bins. The weight comes after, once they are weighed.
 * The Lot number starts as the warehouse's next one and may be changed. What can't be right shows in red and stops the save;
 * the server refuses the same (contract lotBinsProblems).
 */
export function MakeLotForm({ binOptions, initialBin, suggestLotNo, onCreate, saving }: {
  /** This warehouse's Bins, each with the stock it shows. */
  binOptions: SearchSelectOption[];
  /** A Bin to start with: the Bin page's "Send on a transfer". */
  initialBin?: string;
  /** The warehouse's next Lot number for a date; undefined while it can't be had. */
  suggestLotNo: (date: string) => Promise<string | undefined>;
  onCreate: (p: TransferLotPayload) => Promise<boolean>;
  saving: boolean;
}) {
  const empty = (bin = ""): BinRow => ({ binCode: bin, bags: "" });
  const [date, setDate] = useState(todayIso());
  const [lotNo, setLotNo] = useState("");
  // Until the person types their own number, the suggestion follows the date (a new year starts a new sequence).
  const [lotNoTyped, setLotNoTyped] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [bins, setBins] = useState<BinRow[]>([empty(initialBin)]);
  const [tried, setTried] = useState(false);

  useEffect(() => { if (initialBin) setBins([empty(initialBin)]); }, [initialBin]);
  useEffect(() => {
    if (lotNoTyped || !date) return;
    let live = true;
    void suggestLotNo(date).then((n) => { if (live && n) setLotNo(n); });
    return () => { live = false; };
  }, [date, lotNoTyped, suggestLotNo]);

  const problems = lotBinsProblems({ lotNo, lotDate: date, bins });
  // A box not touched yet isn't wrong yet: its problem shows once something is typed there, or on trying to save.
  const shown = (key: string, value: string): FieldProblem | undefined => (tried || value.trim() ? problems[key] : undefined);
  const blocked = Object.values(problems).some((p) => !p.soft);
  const setRow = (i: number, next: Partial<BinRow>) => setBins((rows) => rows.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const totalBags = bins.reduce((a, r) => a + (Number.isInteger(Number(r.bags)) && Number(r.bags) > 0 ? Number(r.bags) : 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (blocked) return;
    const ok = await onCreate({ lotDate: date, lotNo: lotNo.trim(), remarks: remarks.trim() || undefined, bins });
    if (ok) {
      setBins([empty()]);
      setRemarks("");
      setLotNoTyped(false);
      setTried(false);
      void suggestLotNo(date).then((n) => n && setLotNo(n));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pt-3" noValidate>
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Date *" problem={shown("lotDate", date)}>
          <DateInput id="lot-date" value={date} onChange={setDate} className={inputClass} />
        </Field>
        <Field label="Lot number *" hint="The next Lot number of this warehouse. Change it if you need to." problem={shown("lotNo", lotNo)}>
          <Input value={lotNo} onChange={(e) => { setLotNoTyped(true); setLotNo(e.target.value); }} aria-invalid={Boolean(shown("lotNo", lotNo))} />
        </Field>
        <Field label="Remarks">
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        <h3 className="text-[13px] font-bold text-warmstone-900">Which Bins, and how many bags from each</h3>
        <p className="text-[12px] text-warmstone-500">Count the bags as they come out. No weight yet: you weigh the whole lot in step 2.</p>
        {problems.bins && tried && <ProblemText problem={problems.bins} />}
        {bins.map((row, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 items-start">
            <Field label={i === 0 ? "Bin *" : ""} problem={shown(`bin.${i}`, row.binCode)}>
              <SearchSelect id={`lot-bin-${i}`} aria-label={`Bin ${i + 1}`} value={row.binCode} options={binOptions} onChange={(binCode) => setRow(i, { binCode })} placeholder="Choose the Bin the bags come from…" />
            </Field>
            <Field label={i === 0 ? "Bags *" : ""} problem={shown(`bags.${i}`, row.bags)}>
              <Input numeric inputMode="numeric" aria-label={`Bags from Bin ${i + 1}`} aria-invalid={Boolean(shown(`bags.${i}`, row.bags))} value={row.bags} onChange={(e) => setRow(i, { bags: e.target.value })} />
            </Field>
            <div className={i === 0 ? "pt-6" : ""}>
              <IconButton icon="close" label={`Remove Bin ${i + 1}`} disabled={bins.length === 1} onClick={() => setBins((rows) => rows.filter((_, j) => j !== i))} />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" icon="add" onClick={() => setBins((rows) => [...rows, empty()])}>Add another Bin</Button>
          <span className="text-[12px] text-warmstone-500 tabular-nums">{totalBags.toLocaleString("en-US")} bags in this lot</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" icon="inventory_2" disabled={saving || (tried && blocked)}>Make the lot ({totalBags.toLocaleString("en-US")} bags)</Button>
        {tried && blocked && <span className="text-[12px] text-danger-700">Fix the boxes in red to make the lot.</span>}
      </div>
    </form>
  );
}
