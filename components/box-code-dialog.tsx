"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { BoxLocationOption } from "@/lib/stock-model";
import { normalizeBoxCode, validateBoxCode } from "@/lib/box-code-model";
import { renameBoxCode } from "@/app/(workspace)/box-code-actions";

export function BoxCodeDialog({ box, onClose, onSuccess }: {
  box: BoxLocationOption; onClose: () => void; onSuccess: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const router = useRouter();
  // Capturar el código esperado al abrir; una actualización externa no lo reemplaza.
  const [expectedCode] = useState(box.codigo);
  const [value, setValue] = useState(box.codigo);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog?.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const validation = validateBoxCode(value);
    if (validation) { setError(validation); return; }
    setError("");
    if (!confirming) { setConfirming(true); return; }
    busyRef.current = true;
    setPending(true);
    try {
      const result = await renameBoxCode({ ubicacionId: box.id, codigoEsperado: expectedCode, codigoNuevo: normalizeBoxCode(value) });
      if (!result.ok) {
        setConfirming(false);
        setError(result.message);
        if (result.stale || result.uncertain) router.refresh();
        return;
      }
      onSuccess(result.message);
      onClose();
      router.refresh();
    } catch {
      setConfirming(false);
      setError("No se pudo confirmar el cambio. Actualiza la caja antes de volver a intentarlo.");
    } finally { busyRef.current = false; setPending(false); }
  }

  return createPortal(<dialog ref={dialogRef} className="stock-dialog" aria-labelledby="box-code-dialog-title"
    onCancel={event => { if (pending) event.preventDefault(); else onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <div className="stock-dialog-inner">
      <header className="stock-dialog-header"><div><p className="eyebrow">CAJA / CÓDIGO VISIBLE</p><h2 id="box-code-dialog-title">Editar código de caja</h2></div>
        <button type="button" className="sheet-close" aria-label="Cerrar edición de código" disabled={pending} onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
      <form className={confirming ? "stock-confirmation" : "stock-form"} onSubmit={submit} noValidate>
        <div className="stock-fixed-choice"><div><small>Código actual</small><strong>{expectedCode}</strong></div></div>
        {confirming ? <><p>Confirma el nuevo código de esta caja:</p><strong>{normalizeBoxCode(value)}</strong></> :
          <label className="catalog-field" htmlFor="box-new-code"><span>Nuevo código</span>
            <input ref={inputRef} id="box-new-code" type="text" value={value} onChange={event => setValue(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={pending} aria-describedby="box-code-help" /></label>}
        <p id="box-code-help" className="stock-picker-hint">De 1 a 24 caracteres. Letras A–Z, números, guion o guion bajo. Los códigos anteriores permanecen reservados para su caja.</p>
        {error && <p role="alert" className="catalog-message error">{error}</p>}
        <div className="stock-dialog-actions">
          <button type="button" className="catalog-quiet-button" disabled={pending} onClick={() => confirming ? setConfirming(false) : onClose()}>{confirming ? "Volver" : "Cancelar"}</button>
          <button type="submit" className="catalog-button primary" disabled={pending}>{pending ? "Guardando…" : confirming ? "Guardar código" : "Continuar"}</button>
        </div>
      </form>
    </div>
  </dialog>, document.body);
}
