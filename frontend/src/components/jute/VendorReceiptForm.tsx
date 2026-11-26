import { useState, type FormEvent } from "react";
import { parseBags, shortQuantity, shortQuantityLabel, vendorReceiptProblems } from "@anagroci/contract/domain/juteVendorReceipt";
import { todayIso } from "@anagroci/contract/domain/dateFormat";
import { api } from "../../repository/api";
import { DateInput } from "../ui/DateInput";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { field, inputCls, receivingWarehouseField } from "./receiptFormParts";

const blank = () => ({ vendorName: "", deliveryNoteNo: "", date: todayIso(), invoicedQty: "", receivedQty: "", remarks: "" });

interface Props {
  /** Where the bags are received: their warehouse stock goes up here. Blank until one is chosen. */
  warehouse: string;
  /** Every warehouse in the master. */
  warehouses: string[];
  /** The person is assigned to `warehouse`, so it isn't theirs to change. */
  fixed: boolean;
  onWarehouseChange: (warehouse: string) => void;
  onSaved: () => void;
}

/** Records one delivery from a vendor. The rules shown are the ones the server applies (vendorReceiptProblems). */
export function VendorReceiptForm({ warehouse, warehouses, fixed, onWarehouseChange, onSaved }: Props) {
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => {
    setV((s) => ({ ...s, [k]: val }));
    setNotice(null);
  };

  const invoiced = parseBags(v.invoicedQty);
  const received = parseBags(v.receivedQty);
  const short = invoiced !== null && received !== null ? shortQuantityLabel(shortQuantity(invoiced, received)) : "";
  const problems = [...(warehouse ? [] : ["Choose the warehouse receiving the bags."]), ...vendorReceiptProblems(v)];

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api.createVendorReceipt({ ...v, warehouse });
      setNotice(`${saved.receivedQty.toLocaleString()} bags added to the warehouse stock at ${saved.warehouse}.`);
      setV(blank());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4 pt-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* A choice when the person has no warehouse of their own; filled in for them otherwise, and then shown last (below). */}
        {!fixed && receivingWarehouseField({ id: "jute-vendor-to", value: warehouse, options: warehouses, fixed, onChange: onWarehouseChange })}
        {field("Vendor name *", <Input value={v.vendorName} onChange={(e) => set("vendorName", e.target.value)} />)}
        {field("Delivery note no. *", <Input value={v.deliveryNoteNo} onChange={(e) => set("deliveryNoteNo", e.target.value)} />)}
        {field("Date *", <DateInput value={v.date} onChange={(d) => set("date", d)} className={inputCls} />)}
        {field("Invoiced quantity (bags) *", <Input numeric inputMode="numeric" value={v.invoicedQty} onChange={(e) => set("invoicedQty", e.target.value)} />)}
        {field("Received quantity (bags) *", <Input numeric inputMode="numeric" value={v.receivedQty} onChange={(e) => set("receivedQty", e.target.value)} />)}
      </div>
      {field("Remarks", <Input value={v.remarks} onChange={(e) => set("remarks", e.target.value)} />)}
      {/* What the app fills in or works out comes after everything typed (Nov 2026). */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {field("Short quantity", <input readOnly tabIndex={-1} value={short} placeholder="Worked out from the two quantities" className={`${inputCls} bg-warmstone-100 cursor-default`} />)}
        {fixed && receivingWarehouseField({ id: "jute-vendor-to", value: warehouse, options: warehouses, fixed, onChange: onWarehouseChange })}
      </div>
      {error && <p role="alert" className="text-[13px] font-medium text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-[13px] text-success-700">{notice}</p>}
      <Button type="submit" icon="add" disabled={busy || problems.length > 0} title={problems.join(" ")}>{busy ? "Saving…" : "Save receipt"}</Button>
    </form>
  );
}
