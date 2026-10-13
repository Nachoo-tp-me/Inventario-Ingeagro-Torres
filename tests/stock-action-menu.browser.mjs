// Isolated UI regression: no Supabase, auth, or real stock submission.
// Install playwright + esbuild outside the repo, set STOCK_MENU_TEST_TOOLS to
// that directory (containing node_modules), then run node --test this file.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireTools = createRequire(path.join(process.env.STOCK_MENU_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const browsers = requireTools("playwright");

const fixture = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductStockControls } from "./components/product-stock-controls";
import { CompartmentDetail } from "./components/compartment-detail";
const products = [
  {id: "00000000-0000-0000-0000-000000000001", nombre: "Producto Alfa", categoria: "Prueba"},
  {id: "00000000-0000-0000-0000-000000000002", nombre: "Producto Beta", categoria: "Prueba"},
  ...Array.from({length: 6}, (_, index) => ({id: "00000000-0000-0000-0000-" + String(index + 3).padStart(12, "0"), nombre: "Producto " + (index + 3), categoria: "Prueba"})),
];
const locations = Array.from({length: 8}, (_, index) => ({id: index + 1, codigo: "C" + (index + 1), cantidad: 11 + index}));
const compartments = locations.map(location => ({...location, torre_id: 1, piso: 1, posicion: location.id}));
const compartment = {...compartments[2], ocupado: true, productos: products.map((product, index) => ({...product, cantidad: 23 + index, fotoUrl: null}))};
function Fixture() {
  const [open, setOpen] = useState(false);
  return <>
    <button id="open-compartment" onClick={() => setOpen(true)}>Abrir compartimiento</button>
    <main style={{padding: "100px 16px 500px", maxWidth: 900, margin: "auto"}}>
      <ProductStockControls product={products[0]} locations={locations} compartments={compartments} />
    </main>
    <nav className="mobile-navigation">{["Inicio", "Productos", "Torres", "Historial", "Más"].map(label => <button key={label} className="nav-link">{label}</button>)}</nav>
    <CompartmentDetail compartment={open ? compartment : null} towerCode="C1" compartments={compartments} products={products} onClose={() => setOpen(false)} />
  </>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`;

test("B1/B2: menús y formularios reales con datos ficticios", async (t) => {
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "isolate-backend", setup(build) {
      build.onResolve({ filter: /^(next\/navigation|next\/link|@\/app\/\(workspace\)\/stock-actions)$/ }, args => ({ path: args.path, namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, args => ({
        contents: args.path === "next/link"
          ? 'import {createElement} from "react"; export default function Link(props) { return createElement("a", props); }'
          : args.path === "next/navigation"
            ? 'export function useRouter() { return { refresh() { throw new Error("Unexpected refresh"); } }; }'
            : 'export async function submitStockOperation() { window.__submissions++; throw new Error("Stock submissions disabled in UI regression"); }',
        resolveDir: root,
      }));
    } }],
  });
  const cssFiles = ["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/rapid.css"];
  const css = (await Promise.all(cssFiles.map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', "");
  const html = `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script>window.__submissions=0;</script><script src="/fixture.js"></script></body></html>`;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/fixture.js" ? "application/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/fixture.js" ? bundle.outputFiles[0].text : html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;

  for (const name of ["chromium", "firefox", "webkit"]) {
    for (const width of [1280, 360, 390]) {
      await t.test(`${name}, ${width}px`, async () => {
        const browser = await browsers[name].launch();
        try {
          const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: width < 400 });
          page.setDefaultTimeout(5000);
          const errors = [];
          page.on("pageerror", error => errors.push(error.message));
          await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
          await page.goto(url);
          const rows = page.locator(".catalog-location-list li");
          const visibleMenu = page.locator(".stock-action-options:popover-open");
          const stockDialog = page.locator(".stock-dialog[open]");

          async function verifyHitTargets() {
            await visibleMenu.waitFor({ state: "visible" });
            assert.equal(await visibleMenu.count(), 1);
            const result = await visibleMenu.evaluate(menu => {
              const rect = menu.getBoundingClientRect();
              const nav = document.querySelector(".mobile-navigation");
              const bottom = !menu.closest("dialog[open]") && nav.getClientRects().length ? nav.getBoundingClientRect().top : innerHeight;
              return {
                inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= bottom,
                clickable: [...menu.querySelectorAll("button")].every(button => {
                  const box = button.getBoundingClientRect();
                  return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button;
                }),
              };
            });
            assert.deepEqual(result, { inside: true, clickable: true });
          }

          for (const index of [0, 3, 7]) {
            const trigger = rows.nth(index).getByRole("button", { name: "Acciones", exact: true });
            for (const action of ["Retirar", "Mover", "Ajustar"]) {
              if (width < 400 && index === 7 && action === "Ajustar") {
                await trigger.evaluate(button => window.scrollBy(0, button.getBoundingClientRect().bottom - (document.querySelector(".mobile-navigation").getBoundingClientRect().top - 12)));
              }
              await trigger.click();
              await verifyHitTargets();
              if (width < 400 && index === 7 && action === "Ajustar") {
                const triggerBox = await trigger.boundingBox();
                const menuBox = await visibleMenu.boundingBox();
                assert.ok(menuBox.y < triggerBox.y, "last mobile row opens upwards");
              }
              if (process.env.STOCK_MENU_SCREENSHOTS && ((index === 0 && action === "Mover") || (index === 7 && action === "Ajustar"))) {
                await mkdir(process.env.STOCK_MENU_SCREENSHOTS, { recursive: true });
                await page.screenshot({ path: path.join(process.env.STOCK_MENU_SCREENSHOTS, `${name}-${width}-locations-${index}.png`) });
              }
              await visibleMenu.getByRole("button", { name: action, exact: true }).click();
              await stockDialog.waitFor();
              assert.match(await stockDialog.innerText(), /Producto Alfa/);
              assert.equal(await stockDialog.locator(".stock-fixed-choice strong").last().innerText(), `C${index + 1}`);
              if (action === "Ajustar") assert.equal(await stockDialog.locator("#stock-quantity").inputValue(), String(11 + index));
              else assert.match(await stockDialog.locator(".stock-available").innerText(), new RegExp(`${11 + index} unidades`));
              assert.equal(await visibleMenu.count(), 0);
              await page.keyboard.press("Escape");
              await stockDialog.waitFor({ state: "hidden" });
              assert.equal(await trigger.evaluate(button => document.activeElement === button), true);
            }
          }

          const first = rows.first().getByRole("button", { name: "Acciones", exact: true });
          await first.click();
          await first.click();
          assert.equal(await visibleMenu.count(), 0, "trigger toggles closed");
          await first.focus();
          await page.keyboard.press("Enter");
          await verifyHitTargets();
          await page.keyboard.press("Tab");
          assert.equal(await visibleMenu.getByRole("button", { name: "Retirar", exact: true }).evaluate(button => document.activeElement === button), true);
          await page.keyboard.press("Escape");
          assert.equal(await visibleMenu.count(), 0);
          assert.equal(await first.evaluate(button => document.activeElement === button), true);
          await page.keyboard.press("Space");
          await verifyHitTargets();
          for (let index = 0; index < 4; index++) await page.keyboard.press("Tab");
          assert.equal(await visibleMenu.count(), 0, "Tab out closes without trapping focus");
          assert.equal(await rows.nth(1).getByRole("button", { name: "Acciones", exact: true }).evaluate(button => document.activeElement === button), true);
          await first.click();
          await rows.nth(1).getByRole("button", { name: "Acciones", exact: true }).click();
          assert.equal(await visibleMenu.count(), 1, "only one row menu opens");
          await page.locator("h2#catalog-locations-title").click();
          assert.equal(await visibleMenu.count(), 0, "outside click closes");
          await first.click();
          await verifyHitTargets();
          await page.evaluate(() => window.scrollBy(0, 40));
          await visibleMenu.waitFor({ state: "hidden" });
          await first.click();
          await verifyHitTargets();
          await page.setViewportSize({ width, height: 740 });
          await visibleMenu.waitFor({ state: "hidden" });
          await page.setViewportSize({ width, height: 800 });

          // Constrained height: scroll the options themselves without closing the menu.
          await page.setViewportSize({ width, height: 260 });
          await first.evaluate(async button => {
            window.scrollBy(0, button.getBoundingClientRect().top - 100);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          await first.click();
          await visibleMenu.waitFor({ state: "visible" });
          assert.equal(await visibleMenu.evaluate(menu => menu.scrollHeight > menu.clientHeight), true);
          await visibleMenu.evaluate(async menu => {
            menu.scrollTop = menu.scrollHeight;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          assert.equal(await visibleMenu.count(), 1, "scrolling options keeps popover open");
          await visibleMenu.getByRole("button", { name: "Ajustar", exact: true }).click();
          await stockDialog.waitFor();
          assert.equal(await stockDialog.locator("#stock-quantity").inputValue(), "11");
          await stockDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
          await stockDialog.waitFor({ state: "hidden" });
          await page.setViewportSize({ width, height: 800 });

          await page.locator("#open-compartment").click();
          const compartmentDialog = page.locator(".compartment-dialog[open]");
          await compartmentDialog.waitFor();
          const products = compartmentDialog.locator(".sheet-product");
          for (const index of [0, 1]) {
            const trigger = products.nth(index).getByRole("button", { name: "Acciones", exact: true });
            for (const action of ["Agregar", "Retirar", "Mover", "Ajustar"]) {
              await trigger.click();
              await verifyHitTargets();
              await visibleMenu.getByRole("button", { name: action, exact: true }).click();
              await stockDialog.waitFor();
              assert.match(await stockDialog.innerText(), new RegExp(index === 0 ? "Producto Alfa" : "Producto Beta"));
              assert.equal(await stockDialog.locator(".stock-fixed-choice strong").last().innerText(), "C3");
              if (action === "Ajustar") assert.equal(await stockDialog.locator("#stock-quantity").inputValue(), String(23 + index));
              else if (action !== "Agregar") assert.match(await stockDialog.locator(".stock-available").innerText(), new RegExp(`${23 + index} unidades`));
              await page.keyboard.press("Escape");
              await stockDialog.waitFor({ state: "hidden" });
              assert.equal(await compartmentDialog.count(), 1, "parent modal stays open");
              assert.equal(await trigger.evaluate(button => document.activeElement === button), true);
            }
          }
          const modalTrigger = products.last().getByRole("button", { name: "Acciones", exact: true });
          await modalTrigger.click();
          await verifyHitTargets();
          await modalTrigger.focus();
          await page.keyboard.press("Tab");
          await page.keyboard.press("Escape");
          assert.equal(await visibleMenu.count(), 0);
          assert.equal(await compartmentDialog.count(), 1, "Escape closes menu before modal");
          await modalTrigger.click();
          await verifyHitTargets();
          await compartmentDialog.evaluate(dialog => { dialog.scrollTop -= 40; });
          await visibleMenu.waitFor({ state: "hidden" });
          await modalTrigger.click();
          await verifyHitTargets();
          if (process.env.STOCK_MENU_SCREENSHOTS) {
            await mkdir(process.env.STOCK_MENU_SCREENSHOTS, { recursive: true });
            await page.screenshot({ path: path.join(process.env.STOCK_MENU_SCREENSHOTS, `${name}-${width}.png`) });
          }
          assert.equal(await page.evaluate(() => window.__submissions), 0);
          assert.deepEqual(errors, []);
        } finally {
          await browser.close();
        }
      });
    }
  }
});
