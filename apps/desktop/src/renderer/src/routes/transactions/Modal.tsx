import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./Modal.module.css";

export interface ModalProps {
  /** The dialog's name, already in the family's language. */
  readonly title: string;
  /** A line under the name that says what this is about, such as the transaction. */
  readonly subject?: string | undefined;
  readonly hint?: string | undefined;
  readonly wide?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * A modal dialog over the screen. The browser traps focus, and Esc or a click on the backdrop closes it. Focus
 * goes back to where it was. Typing inside never reaches the single-key shortcuts behind it: a letter that
 * isn't a shortcut in the dialog must not go and navigate away from it.
 */
export function Modal({ title, subject, hint, wide = false, onClose, children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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

  const keepKeysInside = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
  };
  const closeOnBackdrop = (event: MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialog}
      className={wide ? `${styles["modal"]} ${styles["wide"]}` : styles["modal"]}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={keepKeysInside}
      onClick={closeOnBackdrop}
    >
      <div className={styles["inner"]}>
        <h2 id={titleId} className={styles["title"]}>
          {title}
        </h2>
        {subject !== undefined && <p className={styles["subject"]}>{subject}</p>}
        {hint !== undefined && <p className={styles["hint"]}>{hint}</p>}
        {children}
      </div>
    </dialog>
  );
}
