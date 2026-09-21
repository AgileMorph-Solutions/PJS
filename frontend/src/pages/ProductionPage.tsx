import { PageHeader } from "../components/ui/PageHeader";

const PHASES = [
  "1. Intake", "2. Calibration & sizing", "3. Cooking", "4. Shelling & shell sales",
  "5. Colour sorting", "6. Borma ovens", "7. Peeling & grading", "8. Packing & dispatch",
];

export function ProductionPage() {
  return (
    <>
      <PageHeader
        kicker="Production"
        title="Production"
        lede="Not built yet — planned as the next module after Procurement. Left here as a placeholder so the module list is honest about what's coming, not hidden."
      />
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Known shape, from Production.html</h3>
        <p className="stage-note" style={{ marginBottom: 16 }}>
          The client's production flow chart maps onto these 8 phases and 21 source workbooks
          (see <span className="mono">flow-xl-map/Production.html</span> for the full process map
          this will be built from, same way Procurement was).
        </p>
        <div className="chips">
          {PHASES.map((p) => (
            <span className="chip" key={p}>
              {p}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
