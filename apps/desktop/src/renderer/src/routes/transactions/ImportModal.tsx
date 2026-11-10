import { type ReactNode, type RefObject, useEffect } from "react";
import kit from "./ImportKit.module.css";

export interface ImportModalProps {
  /** The DOM ID of the heading that names the dialog. */
  readonly labelId: string;
  /**
   * The parent closes the dialog itself, before it tells its own parent, so whatever the parent then focuses (the Import button, which
   * Transactions focuses at once) is reachable: while the modal dialog is open everything outside it is inert and refuses focus.
   */
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  /** Esc, from the browser's own cancel. The parent decides what closing means, and unmounts the dialog to close it. */
  readonly onRequestClose: () => void;
  readonly size?: "wide" | "narrow";
  readonly children: ReactNode;
}

/**
 * A modal dialog for the import screens. The browser's modal `<dialog>` traps focus and sends Esc to `onRequestClose`;
 * this adds the two things it doesn't promise: focus goes back to what opened the dialog, and the single-key shortcuts
 * of the shell (T, P and the rest) never fire from inside it, because a keypress here must not leave the screen behind it.
 */
export function ImportModal({ labelId, dialogRef, onRequestClose, size = "wide", children }: ImportModalProps) {

  useEffect(() => {
    const element = dialogRef.current;
    if (element === null) return;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [dialogRef]);

  return (
    <dialog
      ref={dialogRef}
      className={size === "narrow" ? `${kit.dialog} ${kit.narrow}` : kit.dialog}
      aria-labelledby={labelId}
      onCancel={(event) => {
        // A dialog inside this one (the job picker, the undo preview) is a child in React's tree, so its Esc reaches here too. It is theirs alone.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onRequestClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </dialog>
  );
}
