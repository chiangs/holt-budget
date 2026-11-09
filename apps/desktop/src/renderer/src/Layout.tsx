import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { Cpu, Search } from "lucide-react";
import { AskOverlay } from "./AskOverlay.tsx";
import { askKey, screens, type Screen } from "./screens.ts";

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Single-key navigation. Typing always wins: no letter fires in a text field or while Ask or find is open. */
function useShortcuts(askOpen: boolean, openAsk: () => void): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openAsk();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
      if (askOpen || isTextField(event.target)) return;
      const letter = event.key.toUpperCase();
      if (letter === askKey) {
        event.preventDefault();
        openAsk();
        return;
      }
      const screen = screens.find((s) => s.key === letter);
      if (screen !== undefined) {
        event.preventDefault();
        void navigate(screen.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askOpen, navigate, openAsk]);
}

function KeyChip({ letter }: { letter: string }) {
  return (
    <span className="key" aria-hidden="true">
      {letter}
    </span>
  );
}

function NavRow({ screen }: { screen: Screen }) {
  const intl = useIntl();
  const { path, key, navId, Icon } = screen;
  if (navId === undefined || key === undefined || Icon === undefined) return null;
  return (
    <NavLink to={path} end={path === "/"} className="nav-row" aria-keyshortcuts={key}>
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      <span className="nav-label">{intl.formatMessage({ id: navId })}</span>
      <KeyChip letter={key} />
    </NavLink>
  );
}

export function Layout() {
  const intl = useIntl();
  const [askOpen, setAskOpen] = useState(false);
  const openAsk = useCallback(() => setAskOpen(true), []);
  const closeAsk = useCallback(() => setAskOpen(false), []);
  useShortcuts(askOpen, openAsk);

  const top = screens.filter((s) => s.navId !== undefined && s.placement !== "bottom");
  const bottom = screens.filter((s) => s.placement === "bottom");

  return (
    <div className="app">
      <div className="drag-strip" aria-hidden="true" />
      <aside className="sidebar" aria-label={intl.formatMessage({ id: "nav.sidebar" })}>
        <div className="brand">
          <img src="./holt-small.svg" width={28} height={28} alt="" />
          <span className="nav-label">{intl.formatMessage({ id: "app.name" })}</span>
        </div>
        <nav className="nav-list" aria-label={intl.formatMessage({ id: "nav.label" })}>
          <button type="button" className="nav-row" aria-keyshortcuts={`${askKey} Control+K`} aria-haspopup="dialog" onClick={openAsk}>
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="nav-label">{intl.formatMessage({ id: "nav.ask" })}</span>
            <KeyChip letter={askKey} />
          </button>
          <hr className="nav-divider" />
          {top.map((screen) => (
            <NavRow key={screen.path} screen={screen} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="assistant-status">
            <Cpu size={16} strokeWidth={1.75} aria-hidden="true" />
            <div className="nav-label">
              <div className="strong">{intl.formatMessage({ id: "assistant.title" })}</div>
              <div>{intl.formatMessage({ id: "assistant.detail" })}</div>
            </div>
          </div>
          {bottom.map((screen) => (
            <NavRow key={screen.path} screen={screen} />
          ))}
        </div>
      </aside>
      <main className="screen" id="main">
        <Outlet />
      </main>
      <AskOverlay open={askOpen} onClose={closeAsk} />
    </div>
  );
}
