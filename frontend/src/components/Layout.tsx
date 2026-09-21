import type { ReactNode } from "react";
import { AppNav } from "./AppNav";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <AppNav />
      <main className="main">{children}</main>
    </div>
  );
}
