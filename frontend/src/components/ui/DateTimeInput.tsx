import { useEffect, useState } from "react";
import { DateInput } from "./DateInput";
import { inputClass } from "./Input";

interface Props {
  id?: string;
  /** "YYYY-MM-DD HH:mm", or "". A date alone ("YYYY-MM-DD") shows with the time blank. */
  value: string;
  /** Always called with "YYYY-MM-DD HH:mm", "YYYY-MM-DD" while the time is still blank, or "". */
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** No later than this moment ("YYYY-MM-DD HH:mm"): a future time is flagged and not passed on. */
  max?: string;
}

const split = (v: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(v.trim());
  return { date: m?.[1] ?? "", time: m?.[2] ?? "" };
};

/**
 * A date and a time: the app's one date field (DateInput, DD/MM/YYYY with its calendar) beside a time box. Stored as
 * "YYYY-MM-DD HH:mm", which formatDateTime shows back in the app's format. A moment after `max` is flagged and not passed on,
 * as DateInput does with a date out of range.
 */
export function DateTimeInput({ id, value, onChange, onBlur, max }: Props) {
  const [parts, setParts] = useState(() => split(value));
  const [future, setFuture] = useState(false);
  useEffect(() => setParts(split(value)), [value]);

  function set(next: { date: string; time: string }) {
    setParts(next);
    const joined = next.date && next.time ? `${next.date} ${next.time}` : next.date;
    const tooLate = Boolean(max && joined && (next.time ? joined > max : next.date > max.slice(0, 10)));
    setFuture(tooLate);
    if (!tooLate) onChange(joined);
  }

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
        <DateInput id={id} value={parts.date} max={max?.slice(0, 10)} onChange={(date) => set({ ...parts, date })} onBlur={onBlur} className={inputClass} />
        <input
          type="time" aria-label="Time" value={parts.time} onBlur={onBlur}
          onChange={(e) => set({ ...parts, time: e.target.value })}
          className={`${inputClass} tabular-nums ${future ? "!border-danger-700 !ring-1 !ring-danger-700" : ""}`}
        />
      </div>
      {future && <span role="alert" className="block text-[12px] text-danger-700 mt-1">That's in the future. Enter when it happened.</span>}
    </div>
  );
}

/** Now, as DateTimeInput stores it: the local date and time to the minute. */
export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
