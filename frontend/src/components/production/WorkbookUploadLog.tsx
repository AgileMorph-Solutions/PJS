import { useEffect, useState } from "react";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { ROLE_LABEL, isRole } from "@anagroci/contract/data/roles";
import { api, type ProductionWorkbookUpload } from "../../repository/api";
import { Modal } from "../ui/Modal";
import { DataTable, type Column } from "../ui/DataTable";
import { PRODUCTION_PAGE_SIZE, numCol, textCol } from "./columns";

/** What one upload added and changed, tab by tab: "1. RCN Receipts +61 · 3. Input RCN Quality +2". */
const tabsSummary = (u: ProductionWorkbookUpload) =>
  u.tabs.map((t) => [t.name, t.created ? `+${t.created}` : "", t.updated ? `${t.updated} changed` : ""].filter(Boolean).join(" ")).join(" · ");

const columns: Column<ProductionWorkbookUpload>[] = [
  textCol("Uploaded", (u) => formatDateTime(u.uploadedAt)),
  textCol("By", (u) => `${u.uploadedBy} · ${isRole(u.uploadedByRole) ? ROLE_LABEL[u.uploadedByRole] : u.uploadedByRole}`),
  textCol("File", (u) => u.filename, { wrap: true }),
  numCol("Rows added", (u) => u.created),
  numCol("Rows changed", (u) => u.updated),
  textCol("Tabs", tabsSummary, { wrap: true }),
];

/** The production workbook's upload log: who uploaded which file, when, and what it wrote. Read-only. */
export function WorkbookUploadLog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ProductionWorkbookUpload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.listProductionWorkbookUploads()
      .then((r) => { if (alive) setRows(r); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  return (
    <Modal title="Upload log" onClose={onClose} wide>
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      {rows && (
        <DataTable
          pageSize={PRODUCTION_PAGE_SIZE}
          columns={columns}
          rows={rows}
          keyFn={(u) => String(u.id)}
          emptyTitle="No upload yet"
          emptyHint="Each workbook applied with Upload is listed here: who uploaded it, when, and what it added."
        />
      )}
    </Modal>
  );
}
