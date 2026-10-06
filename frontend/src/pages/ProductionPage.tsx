import { PageHeader } from "../components/ui/PageHeader";

const PHASES = [
  "1. Intake", "2. Calibration & sizing", "3. Cooking", "4. Shelling & shell sales",
  "5. Colour sorting", "6. Borma ovens", "7. Peeling & grading", "8. Packing & dispatch",
];

export function ProductionPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Production"
        title="Production"
        lede="Not built yet - planned as the next module after Procurement."
      />
      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Planned phases</h3>
        <div className="flex flex-wrap gap-2">
          {PHASES.map((p) => (
            <span key={p} className="px-3 py-1.5 rounded-full bg-warmstone-100 text-warmstone-600 text-[12.5px] font-medium">
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
