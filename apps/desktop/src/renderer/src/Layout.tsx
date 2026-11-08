import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import {
  ArrowLeftRight,
  CalendarCheck,
  Cpu,
  LayoutDashboard,
  ListChecks,
  Repeat,
  Search,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  key: string;
  Icon: LucideIcon;
}

// Keys from the IA document: the first letter of each sidebar item.
const items: NavItem[] = [
  { to: "/ask", label: "Ask or find", key: "A", Icon: Search },
  { to: "/", label: "Overview", key: "O", Icon: LayoutDashboard },
  { to: "/transactions", label: "Transactions", key: "T", Icon: ArrowLeftRight },
  { to: "/plan", label: "Plan", key: "P", Icon: ListChecks },
  { to: "/recurring", label: "Recurring costs", key: "R", Icon: Repeat },
  { to: "/review", label: "Monthly review", key: "M", Icon: CalendarCheck },
  { to: "/insurance", label: "Insurance", key: "I", Icon: Shield },
];
const settings: NavItem = { to: "/settings", label: "Settings", key: "S", Icon: Settings };

/** Single-key navigation. Typing always wins: never fires in a text field. */
function useNavigationKeys(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.ctrlKey && e.key.toLowerCase() === "k") {
          e.preventDefault();
          void navigate("/ask");
        }
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      const item = [...items, settings].find((i) => i.key === e.key.toUpperCase());
      if (item) {
        e.preventDefault();
        void navigate(item.to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

function NavRow({ item }: { item: NavItem }) {
  const { to, label, key, Icon } = item;
  return (
    <NavLink to={to} end={to === "/"} className="nav-row" aria-keyshortcuts={key}>
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      <span className="nav-label">{label}</span>
      <span className="key" aria-hidden="true">
        {key}
      </span>
    </NavLink>
  );
}

export function Layout() {
  useNavigationKeys();
  const [backend, setBackend] = useState<string>("…");
  useEffect(() => {
    void window.holt?.appInfo().then((info) => setBackend(info.storageBackend));
  }, []);

  return (
    <div className="app" data-theme="hearth-light">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <img src="./holt-small.svg" width={28} height={28} alt="" />
          <span>Holt</span>
        </div>
        <div className="nav-list">
          {items.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </div>
        <div className="sidebar-foot">
          <div className="assistant-status">
            <Cpu size={16} strokeWidth={1.75} aria-hidden="true" />
            <div>
              <div className="strong">Assistant: local model</div>
              <div>Runs on this computer, with no network.</div>
              <div className="muted">Key store: {backend}</div>
            </div>
          </div>
          <NavRow item={settings} />
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
