import { useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import { Search, X } from "lucide-react";

/**
 * Ask or find. A modal dialog over the current screen, not a route, so the URL hash never changes.
 * The browser's modal dialog traps focus, closes on Esc and returns focus to the opener.
 */
export function AskOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const intl = useIntl();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const handleClose = () => {
    const previous = opener.current;
    if (previous instanceof HTMLElement && previous.isConnected && !dialog.current?.contains(document.activeElement) && document.activeElement !== previous) {
      previous.focus();
    }
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="ask"
      aria-labelledby="ask-title"
      onClose={handleClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ask-head">
        <p id="ask-title" className="muted">
          {intl.formatMessage({ id: "ask.title" })} <span aria-hidden="true">·</span> {intl.formatMessage({ id: "ask.hint" })}
        </p>
        <button type="button" className="icon-button" onClick={onClose} aria-label={intl.formatMessage({ id: "ask.close" })}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <label className="ask-field">
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <input ref={input} type="text" aria-label={intl.formatMessage({ id: "ask.inputLabel" })} autoComplete="off" />
      </label>
      <p className="muted ask-empty">{intl.formatMessage({ id: "ask.empty" })}</p>
      <div className="ask-foot muted">
        <p>{intl.formatMessage({ id: "ask.privacy" })}</p>
        <p>{intl.formatMessage({ id: "ask.escHint" })}</p>
      </div>
    </dialog>
  );
}
