import { NavLink, useLocation } from "react-router-dom";
import { NAV, isSection } from "../config/nav";

export function AppNav() {
  const location = useLocation();

  return (
    <nav className="sidebar">
      <div>
        <p className="brand">ANAGROCI &middot; TRACKING</p>
        <NavLink to="/" className="sidebar-home" end>
          RCN Tracking
        </NavLink>
      </div>

      <div className="sidebar-nav">
        {NAV.map((entry) => {
          if (!isSection(entry)) {
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end
                className={({ isActive }) => `sidebar-section-head${isActive ? " active" : ""}`}
              >
                {entry.label}
              </NavLink>
            );
          }
          const open = location.pathname.startsWith(entry.basePath);
          return (
            <div className={`sidebar-section${open ? " open" : ""}`} key={entry.basePath}>
              <NavLink
                to={entry.items[0].to}
                className={`sidebar-section-head${open ? " active" : ""}`}
              >
                {entry.label}
              </NavLink>
              {open && (
                <ul className="sidebar-sublist">
                  {entry.items.map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="sidebar-footnote">No accounts yet — single shared session, stored in this browser.</p>
    </nav>
  );
}
