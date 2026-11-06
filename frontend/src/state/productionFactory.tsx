/**
 * Which factory Production's Batch & Intake pages are about. Production runs only at a FACTORY site,
 * and there can be more than one (Masters → Warehouses), so an admin, who isn't tied to a site,
 * picks one; everyone else is pinned to their own by the API and never sends a choice.
 *
 * The choice is handed to repository/api.ts during render, not in an effect: a page's own fetch runs
 * in its effect, and children's effects run before their parent's, so an effect here would be too late
 * for the first read.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { setProductionFactory } from "../repository/api";
import { SITES } from "../config/sites";
import { useMe } from "./AuthContext";
import { useTracking } from "./TrackingContext";

const STORAGE_KEY = "anagroci.productionFactory";

interface ProductionFactory {
  /** The factory every Batch & Intake call is for; undefined for a non-admin (the API uses theirs). */
  factory: string | undefined;
  /** The factories an admin can choose between; empty for everyone else. */
  factories: string[];
  choose: (name: string) => void;
}

const Ctx = createContext<ProductionFactory>({ factory: undefined, factories: [], choose: () => {} });

export function ProductionFactoryLayout({ children }: { children?: ReactNode }) {
  const isAdmin = useMe().role === "admin";
  const { masters, loading } = useTracking();
  const [chosen, setChosen] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  // Sites, not stores: a store under a factory (ANAGROCI-01) is the same factory.
  const factories = isAdmin
    ? masters.warehouses.filter((w) => w.kind === "FACTORY" && !w.site).map((w) => w.name).sort()
    : [];
  // A remembered choice that's been removed since falls back to the central warehouse, then the first.
  const factory = !isAdmin
    ? undefined
    : chosen && factories.includes(chosen)
      ? chosen
      : factories.includes(SITES.central.warehouseName) ? SITES.central.warehouseName : factories[0];
  setProductionFactory(factory);

  const choose = (name: string) => {
    localStorage.setItem(STORAGE_KEY, name);
    setChosen(name);
  };

  // Until the masters arrive an admin has no factory to send, and the pages' first read would be refused.
  if (isAdmin && !factory && loading) return null;
  return <Ctx.Provider value={{ factory, factories, choose }}>{children ?? <Outlet />}</Ctx.Provider>;
}

export const useProductionFactory = (): ProductionFactory => useContext(Ctx);

/** The admin's factory dropdown; nothing for anyone else, or when there's only one factory to be at. */
export function ProductionFactorySwitcher() {
  const { factory, factories, choose } = useProductionFactory();
  if (factories.length < 2) return null;
  return (
    <select
      value={factory}
      onChange={(e) => choose(e.target.value)}
      title="Which factory's batches to show"
      className="px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] font-semibold text-warmstone-800 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
    >
      {factories.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  );
}
