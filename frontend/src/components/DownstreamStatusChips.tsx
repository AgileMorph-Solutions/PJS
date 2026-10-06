import { Pill } from "./ui/Pill";
import type { DownstreamStatus } from "../repository/api";

/**
 * Everything that used to be its own sidebar page (Dispatch to Central, Receiving from Unit, Issue
 * to Production) shown as status chips on the Reception list instead — see
 * backend/src/services/receiptsDownstream.ts. `status` is undefined while the downstream fetch is
 * still loading, not "known to have none" — rendered the same as "no flags yet" rather than a
 * loading placeholder, since the Reception table itself doesn't block on this fetch.
 */
export function DownstreamStatusChips({ status }: { status: DownstreamStatus | undefined }) {
  if (!status || (!status.dispatched && !status.received && !status.dried && !status.issued)) {
    return <span className="text-[11px] text-warmstone-400">-</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {status.dispatched && <Pill tone="entry" label="Dispatched" />}
      {status.received && <Pill tone="entry" label="Received" />}
      {status.dried && <Pill tone="entry" label="Dried" />}
      {status.issued && <Pill tone="entry" label="Issued" />}
    </div>
  );
}
