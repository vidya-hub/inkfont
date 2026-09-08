import { useEffect, useRef, type ReactNode } from "react";
import { useDocument } from "../core/store";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const d = ref.current!;
    d.showModal();
    useDocument.setState({ modal: true });
    return () => {
      d.close();
      useDocument.setState({ modal: false });
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"studio-dialog " + (wide ? "wide" : "")}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
