# Backend — not started yet

This directory is a placeholder. The frontend (`../frontend`) currently runs entirely on mock data
with no API calls, so there is nothing here to run yet.

When this gets picked up, it needs to cover at minimum what the frontend already assumes exists:

- Persisting the 17 Truck Arrival / Reception stages (`../frontend/src/data/stages.ts`) as real
  records instead of `localStorage`.
- The four jute bag ledgers (`../frontend/src/data/juteBags.ts`) and their reconciliation rule
  (opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing stock).
- Whatever store backs `Rcn_Offloading_Details_2026.xlsx` / `OFFLOADINGS` today, since several stage
  fields are meant to read/write that same data, not a parallel copy of it.

Stack/framework: to be decided when this is initiated.
