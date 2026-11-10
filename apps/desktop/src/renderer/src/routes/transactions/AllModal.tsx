import { type ReactNode, useEffect, useRef } from "react";
import styles from "./AllModal.module.css";

export interface AllModalProps {
  /** The ID of the element inside that names the dialog. */
  readonly labelledBy: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Wider dialogs, such as the split editor. */
  readonly wide?: boolean;
}

/**
 * A modal dialog for the browse pieces. The browser's own modal dialog traps focus and closes on Esc; this adds
 * the rest of the bar: focus returns to what opened it, a click on the backdrop closes it, and a letter
 * pressed inside never reaches the navigation shortcuts (Layout listens on the window), so "T" in a field
 * is a "T", and "P" on a button does not leave the screen.
 */
export function AllModal({ labelledBy, onClose, children, wide = false }: AllModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    const opener = document.activeElement;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={wide ? `${styles.dialog} ${styles.wide}` : styles.dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
      }}
    >
      {children}
    </dialog>
  );
}
