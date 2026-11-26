import { dryingFieldProblem, dryingGramsTotalProblem, dryingKor } from "@anagroci/contract/domain/sunDrying";
import { GRAM_FIELDS, korCalculated, num } from "./dryingQuality";
import { Field, Input, ProblemText, inputClass } from "../ui/Input";

/** Moisture, nut count, the cut-test grams and KOR, for the drying sample before or after a round. KOR is calculated from the
 * grams when good kernel, immature and spotted are all there (the same formula as QFS); otherwise it can be typed. */
export function DryingQualityInputs({ prefix, values, onChange, optional = false }: {
  prefix: "input" | "output"; values: Record<string, string>; onChange: (k: string, v: string) => void;
  /** The Incharge may leave the reading for the QFS Officer (26 Nov 2026), who sends it from their Quality checks page. */
  optional?: boolean;
}) {
  const when = prefix === "input" ? "before" : "after";
  const k = (s: string) => `${prefix}${s}`;
  const kor = dryingKor({ goodKernelG: num(values[k("GoodKernelG")]), immatureG: num(values[k("ImmatureG")]), spottedG: num(values[k("SpottedG")]), kor: num(values[k("Kor")]) });
  const calculated = korCalculated(values, prefix);
  const problem = (s: string) => dryingFieldProblem(k(s), values[k(s)]);
  const total = dryingGramsTotalProblem(values, prefix);
  return (
    <fieldset className="space-y-3">
      <legend className="text-[13px] font-bold text-warmstone-900 mb-2">Quality {when} drying <span className="font-normal text-warmstone-500">(drying sample, measured now)</span></legend>
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label={`Moisture ${when} (%)${optional ? "" : " *"}`} hint={optional ? "Leave the readings blank for the QFS Officer to record." : undefined} problem={problem("Moisture")}>
          <Input numeric required={!optional} value={values[k("Moisture")] ?? ""} onChange={(e) => onChange(k("Moisture"), e.target.value)} />
        </Field>
        <Field label="Nut count" problem={problem("NutCount")}><Input numeric inputMode="numeric" value={values[k("NutCount")] ?? ""} onChange={(e) => onChange(k("NutCount"), e.target.value)} /></Field>
      </div>
      <div>
        <span className="block text-[12px] font-semibold text-warmstone-700 mb-1.5">Cut test (grams of a 1000 g sample)</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {GRAM_FIELDS.map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-[11px] text-warmstone-500 mb-1">{label}</span>
              <Input numeric value={values[k(key)] ?? ""} onChange={(e) => onChange(k(key), e.target.value)} />
              {problem(key) && <ProblemText problem={problem(key)!} />}
            </label>
          ))}
        </div>
        {total && <ProblemText problem={{ message: total, soft: false }} />}
      </div>
      {/* KOR comes out of the grams above, so it reads last, under them (Nov 2026). */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="KOR" hint={calculated ? "Calculated from the cut test" : "Calculated once good kernel, immature and spotted are entered"} problem={calculated ? undefined : problem("Kor")}>
          {calculated
            ? <input readOnly value={kor ?? ""} className={`${inputClass} bg-warmstone-100 cursor-default`} />
            : <Input numeric value={values[k("Kor")] ?? ""} onChange={(e) => onChange(k("Kor"), e.target.value)} />}
        </Field>
      </div>
    </fieldset>
  );
}

