"use client";

import { useEffect, useId, useRef } from "react";
import { getStockMenuPosition } from "@/lib/stock-menu-position";
import type { StockOperationType } from "@/lib/stock-model";

export function StockActionMenu({
  onSelect,
  showEntry = true,
}: {
  onSelect: (tipo: StockOperationType) => void;
  showEntry?: boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;

    function close() {
      if (!menu?.matches(":popover-open")) return;
      const restoreFocus = menu.contains(document.activeElement);
      menu.hidePopover();
      if (restoreFocus) trigger?.focus({ preventScroll: true });
    }

    function onScroll(event: Event) {
      // The options can scroll in a short viewport; only ancestor/page scroll closes them.
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      close();
    }

    function onFocus(event: FocusEvent) {
      if (event.target instanceof Node && event.target !== trigger && !menu?.contains(event.target)) close();
    }

    function removeListeners() {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", close);
      window.visualViewport?.removeEventListener("resize", close);
      window.visualViewport?.removeEventListener("scroll", close);
    }

    function onBeforeToggle(event: ToggleEvent) {
      removeListeners();
      if (!menu || !trigger || event.newState !== "open") return;
      menu.style.visibility = "hidden";
    }

    function onToggle() {
      if (!menu || !trigger || !menu.matches(":popover-open")) return;
      // Measure only once the browser has put the open popover in the top layer.
      menu.style.maxHeight = "";
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        right: (visual?.offsetLeft ?? 0) + (visual?.width ?? document.documentElement.clientWidth),
        top: visual?.offsetTop ?? 0,
        bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
      };
      // The navigation is inert behind a modal, so it only limits page menus.
      const navigation = document.querySelector(".mobile-navigation");
      if (!trigger.closest("dialog[open]") && navigation?.getClientRects().length) {
        viewport.bottom = Math.min(viewport.bottom, navigation.getBoundingClientRect().top);
      }
      menu.style.maxWidth = `${Math.max(0, viewport.right - viewport.left - 16)}px`;
      const position = getStockMenuPosition(trigger.getBoundingClientRect(), menu.getBoundingClientRect(), viewport);
      menu.style.left = `${position.left}px`;
      menu.style.top = `${position.top}px`;
      menu.style.maxHeight = `${position.maxHeight}px`;
      menu.style.visibility = "visible";
      document.addEventListener("scroll", onScroll, true);
      document.addEventListener("focusin", onFocus);
      window.addEventListener("resize", close);
      visual?.addEventListener("resize", close);
      visual?.addEventListener("scroll", close);
    }

    menu.addEventListener("beforetoggle", onBeforeToggle);
    menu.addEventListener("toggle", onToggle);
    return () => {
      removeListeners();
      menu.removeEventListener("beforetoggle", onBeforeToggle);
      menu.removeEventListener("toggle", onToggle);
    };
  }, []);

  return (
    <div className="stock-action-menu">
      <button ref={triggerRef} type="button" className="stock-action-trigger" popoverTarget={id}>Acciones</button>
      {/* Keep the popover inside its modal ancestor; a body portal would be inert. */}
      <div ref={menuRef} id={id} popover="auto" className="stock-action-options" role="group" aria-label="Acciones de stock">
        {(["entrada", "retiro", "traslado", "ajuste"] as const)
          .filter((tipo) => showEntry || tipo !== "entrada")
          .map((tipo) => (
            <button key={tipo} type="button" onClick={() => {
              menuRef.current?.hidePopover();
              // The operation dialog records this row's trigger for focus restoration.
              triggerRef.current?.focus({ preventScroll: true });
              onSelect(tipo);
            }}>{tipo === "entrada" ? "Agregar" : tipo === "retiro" ? "Retirar" : tipo === "traslado" ? "Mover" : "Ajustar"}</button>
          ))}
      </div>
    </div>
  );
}
