// UI03a: legibilidad y estructura de estantes/cajas con componentes reales y el fixture en memoria.
// Nunca usa Supabase, JWT reales ni inventario productivo. Aditivo e independiente de B4:
// invariantes semánticas y geométricas, sin snapshots ni baselines.
// Node >=22; esbuild 0.28.2 y playwright 1.64.0 externos (npm install --prefix <tools> ...).
// SHELVES_TEST_TOOLS=<tools>; SHELVES_LAYOUT_ARTIFACTS=<ruta externa opcional para capturas>.
// node --test tests/shelves-layout.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createShelfFixture, root, requireTools } from "./helpers/shelves-fixture.mjs";

const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const fixture = `
  import { useEffect,useState,useSyncExternalStore } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppShell } from './components/app-shell';
  import { ShelfOverview } from './components/shelf-overview';
  import { ShelfView } from './components/shelf-view';
  const subscribe=cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)};
  function Current(){
    const url=useSyncExternalStore(subscribe,()=>location.pathname+location.search);
    const [data,setData]=useState(null);
    useEffect(()=>{let active=true;fetch('/data?path='+encodeURIComponent(url)).then(r=>r.json()).then(r=>{if(active)setData(r)});return()=>{active=false}},[url]);
    if(!data||data.path!==location.pathname)return null;
    if(data.kind==='overview')return <div data-ready><ShelfOverview shelves={data.shelves}/></div>;
    const selected=new URLSearchParams(location.search).get('caja');
    return <div data-ready><ShelfView shelf={data.shelf} locations={data.locations} products={data.products} selectedId={selected?Number(selected):null}/></div>;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
`;

const CODES = { 78: "MOTORES_1", 94: "CONTROL_MOTORES_24V_ZONA", 95: "W".repeat(24) };
// Opción A aprobada: la pintura de Ocupado/Disponible no cambia (rojo/verde existentes).
const STATUS_PAINT = {
  light: { occupied: ["rgb(168, 63, 71)", "rgb(252, 238, 238)"], available: ["rgb(25, 107, 79)", "rgb(234, 247, 238)"] },
  dark: { occupied: ["rgb(255, 208, 208)", "rgb(87, 52, 59)"], available: ["rgb(178, 240, 205)", "rgb(26, 75, 62)"] },
};
const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test("UI03a: códigos completos, 2×2, estados, selección, contraste y movimiento reducido", async t => {
  const directory = process.env.SHELVES_LAYOUT_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), "ingeagro-ui03-"));
  await mkdir(directory, { recursive: true });
  t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: fixture },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline-browser-services", setup(build) {
      build.onResolve({ filter: /^(next\/navigation|next\/link|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/(stock-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root, contents:
        args.path === "next/link" ? `import {createElement} from 'react'; export default function Link({href,children,...props}){
          return createElement('a',{...props,href,onClick:event=>{event.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`
        : args.path === "next/navigation" ? `import {useSyncExternalStore} from 'react';
          const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
          export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};
          export function useRouter(){return {replace(path){history.replaceState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},refresh(){}}}`
        : args.path.endsWith("/supabase/client") ? "export function createSupabaseClient(){throw new Error('Real authentication disabled')}"
        : args.path.endsWith("/box-code-actions") ? "export async function renameBoxCode(){throw new Error('Writes disabled in UI03 layout test')}"
        : "export async function submitStockOperation(){throw new Error('Writes disabled in UI03 layout test')}" }));
    } }],
  });
  const css = (await Promise.all(["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/shelves.css"]
    .map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', "");
  const active = createShelfFixture();
  for (const [id, code] of Object.entries(CODES)) active.state.tables.compartimientos.find(row => row.id === Number(id)).codigo = code;
  const tablesBefore = JSON.stringify(active.state.tables);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.test");
      if (url.pathname === "/data") {
        const target = new URL(url.searchParams.get("path"), "http://fixture.test");
        const data = target.pathname === "/estantes"
          ? { kind: "overview", shelves: (await active.shelvesPage()).props.shelves }
          : { kind: "detail", ...(await active.shelfPage({ params: Promise.resolve({ id: target.pathname.split("/")[2] }), searchParams: Promise.resolve({ caja: target.searchParams.get("caja") ?? undefined }) })).props };
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ path: target.pathname, ...data }));
      } else if (url.pathname === "/fixture.js") {
        response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].text);
      } else {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`);
      }
    } catch (error) { response.statusCode = 503; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); t.after(() => browser.close());
  const expectedCodes = active.state.tables.compartimientos.filter(row => row.tipo === "caja").sort((a, b) => a.id - b.id).map(row => [row.id, row.codigo, row.estante_id, row.posicion]);

  async function open(page, route, theme) {
    // Tema antes del primer render: no medir colores durante la transición de fondo de las cajas.
    await page.addInitScript(theme => { addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; }, { once: true }); }, theme);
    await page.goto(url + route);
    await page.locator("[data-ready] .shelf-box").first().waitFor();
  }
  const readPaint = (page, selector) => page.locator(selector).evaluateAll(elements => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    return elements.map(element => { let node = element, bg; while (node) { bg = rgba(getComputedStyle(node).backgroundColor); if (bg[3] === 255) break; node = node.parentElement; }
      return { text: element.textContent.trim(), fg: rgba(getComputedStyle(element).color), bg }; });
  });

  const widths = [320, 360, 390, 640, 759, 760, 761, 767, 768, 769, 839, 899, 900, 901, 1024, 1119, 1120, 1121, 1280];
  for (const theme of ["light", "dark"]) for (const width of widths) {
    await t.test(`vista general ${width}px ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(7000);
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await open(page, "/estantes", theme);
      const boxes = await page.locator(".shelf-box").evaluateAll(elements => elements.map(box => {
        const code = box.querySelector(".shelf-box-code"); const card = box.closest(".shelf-card");
        const r = box.getBoundingClientRect(), c = card.getBoundingClientRect();
        return { id: Number(box.dataset.locationId), position: Number(box.dataset.position), href: box.getAttribute("href"), code: code.textContent,
          wbr: code.querySelectorAll("wbr").length, codeFits: code.scrollWidth <= code.clientWidth + 1 && box.scrollWidth <= box.clientWidth + 1,
          ellipsis: getComputedStyle(code).textOverflow === "ellipsis", font: getComputedStyle(code).fontFamily, inCard: r.left >= c.left - 0.5 && r.right <= c.right + 0.5,
          x: Math.round(r.x), y: Math.round(r.y), status: box.querySelector(".sheet-status")?.textContent.trim(), statusIcons: box.querySelectorAll(".sheet-status svg").length,
          counts: box.querySelector(".shelf-box-counts")?.textContent.trim(), occupied: box.classList.contains("occupied"), current: box.getAttribute("aria-current") };
      }));
      // Identidad: 24 cajas, IDs únicos, códigos íntegros, rutas por ID y posiciones permanentes.
      assert.equal(boxes.length, 24);
      assert.equal(new Set(boxes.map(box => box.id)).size, 24);
      assert.deepEqual(boxes.map(box => [box.id, box.code]).sort((a, b) => a[0] - b[0]), expectedCodes.map(([id, code]) => [id, code]));
      for (const [id, code, shelf] of expectedCodes) {
        const box = boxes.find(item => item.id === id);
        assert.equal(box.href, `/estantes/${shelf}?caja=${id}`);
        assert.equal(box.wbr, (code.slice(0, -1).match(/[_-]/g) ?? []).length, `wbr ${code}`);
        assert.ok(box.codeFits && box.inCard && !box.ellipsis, `${code} completo y contenido a ${width}px`);
        assert.match(box.font, /Consolas|Cascadia Mono|Liberation Mono|Courier New|monospace/);
        assert.equal(box.current, null);
      }
      // 2×2 físico: 1-2 arriba (izquierda→derecha), 3-4 debajo, columnas alineadas.
      for (let index = 0; index < 24; index += 4) {
        const [a, b, c, d] = boxes.slice(index, index + 4);
        assert.deepEqual([a.position, b.position, c.position, d.position], [1, 2, 3, 4]);
        assert.ok(a.y === b.y && c.y === d.y && a.y < c.y && a.x === c.x && b.x === d.x && a.x < b.x, `2×2 en ${width}px`);
      }
      // Estados con texto + icono y cantidades con singular/plural; «0 unidades» en vacías.
      for (const box of boxes) {
        assert.equal(box.status, box.occupied ? "Ocupado" : "Disponible");
        assert.equal(box.statusIcons, 1);
        if (box.occupied) assert.match(box.counts, /^(1 referencia|\d+ referencias) · (1 unidad|\d+ unidades)$/);
        else assert.equal(box.counts, "0 unidades");
      }
      assert.ok(boxes.some(box => box.counts === "1 referencia · 12 unidades"), "singular de referencia");
      // Opción A: colores rojo/verde existentes sin cambios en ambos temas.
      for (const kind of ["occupied", "available"]) {
        const paints = await page.locator(`.shelf-box .sheet-status.${kind}`).evaluateAll(els => els.map(el => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]));
        assert.ok(paints.length && paints.every(paint => paint[0] === STATUS_PAINT[theme][kind][0] && paint[1] === STATUS_PAINT[theme][kind][1]), `${kind} ${theme} ${JSON.stringify(paints[0])}`);
      }
      // Estantes por fila según el ancho útil del grupo (R2: dos desde 840 px).
      const layout = await page.locator(".shelf-group").first().evaluate(group => ({ width: group.clientWidth,
        perRow: [...group.querySelectorAll(".shelf-card")].filter((card, _, all) => Math.round(card.getBoundingClientRect().y) === Math.round(all[0].getBoundingClientRect().y)).length }));
      assert.equal(layout.perRow, layout.width >= 840 ? 2 : 1, `estantes por fila con ${layout.width}px útiles`);
      // Contadores y ayuda única.
      assert.deepEqual(await page.locator(".shelf-group-header span").allTextContents(), ["3 estantes", "3 estantes"]);
      assert.ok((await page.locator(".shelf-card-header span").allTextContents()).every(text => text === "4 cajas"));
      assert.equal(await page.locator(".shelf-status-help").count(), 1);
      assert.equal(await page.getByText("Disponible: sin stock positivo", { exact: false }).count(), 1);
      // El contenido de estantes no excede el viewport. El shell se registra aparte: su topbar
      // desborda 2 px en claro entre 821 y 840 px desde bb261821 (fuera de UI03, ámbito UI04).
      assert.equal(await page.locator("[data-ready]").evaluate(root => [...root.querySelectorAll("*")].every(el => el.getBoundingClientRect().right <= innerWidth + 0.5)), true, "contenido de estantes dentro del viewport");
      const shell = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
        outside: [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 0.5).every(el => el.closest(".topbar-right")) }));
      if (shell.overflow > 0) t.diagnostic(`shell ${width}px ${theme}: desborde heredado de ${shell.overflow}px en .topbar-right`);
      assert.ok(shell.overflow <= 0 || (shell.outside && shell.overflow <= 2), `scroll horizontal de página ${JSON.stringify(shell)}`);
      // Contraste del texto de las cajas, estados y ayuda sobre su fondo efectivo.
      for (const selector of [".shelf-box-code", ".shelf-box small", ".shelf-box-counts", ".shelf-box .sheet-status", ".shelf-status-help", ".shelf-card-header span", ".shelf-group-header span"]) {
        for (const sample of await readPaint(page, selector)) assert.ok(ratio(sample.fg, sample.bg) >= 4.5, `${selector} «${sample.text}» ${ratio(sample.fg, sample.bg).toFixed(2)}`);
      }
      if ([320, 390, 768, 1280].includes(width)) await page.screenshot({ path: path.join(directory, `estantes-${width}-${theme}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    });
  }

  for (const theme of ["light", "dark"]) for (const width of [320, 390, 768, 1280]) {
    await t.test(`detalle, selección, foco y movimiento ${width}px ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: width < 800 });
      page.setDefaultTimeout(7000);
      await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await open(page, "/estantes/6", theme);
      // Foco visible con teclado sobre una caja.
      const first = page.locator('[data-location-id="93"]');
      await first.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      const focus = await first.evaluate(element => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
        let node = element.parentElement, bg; while (node) { bg = rgba(getComputedStyle(node).backgroundColor); if (bg[3] === 255) break; node = node.parentElement; }
        const style = getComputedStyle(element);
        return { visible: element.matches(":focus-visible"), style: style.outlineStyle, width: parseFloat(style.outlineWidth), ring: rgba(style.outlineColor), bg };
      });
      assert.ok(focus.visible && focus.style === "solid" && focus.width >= 3 && ratio(focus.ring, focus.bg) >= 3, JSON.stringify(focus));
      // Movimiento: transición discreta normal y anulada con prefers-reduced-motion.
      assert.ok(await first.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) > 0.1));
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.ok(await page.locator(".shelf-box").evaluateAll(elements => elements.every(element => getComputedStyle(element).transitionDuration.split(",").every(value => parseFloat(value) <= 0.001))));
      await page.emulateMedia({ reducedMotion: "no-preference" });
      // Selección: la caja abierta queda marcada con aria-current y contorno, sin cambiar su estado ni posición.
      const long = page.locator('[data-location-id="94"]');
      const before = await long.evaluate(element => ({ className: element.className, position: element.dataset.position }));
      await long.click();
      const detail = page.locator(".compartment-dialog[open]"); await detail.waitFor();
      assert.equal(new URL(page.url()).searchParams.get("caja"), "94");
      const selected = await page.locator('[aria-current="location"]').evaluateAll(elements => elements.map(element => ({ id: element.dataset.locationId, position: element.dataset.position,
        className: element.className, shadow: getComputedStyle(element).boxShadow })));
      assert.equal(selected.length, 1);
      assert.equal(selected[0].id, "94"); assert.equal(selected[0].position, before.position);
      assert.ok(selected[0].className.includes("selected") && selected[0].className.includes(before.className.split(" ")[1]));
      assert.match(selected[0].shadow, /inset/);
      // Título del detalle: código completo, nombre accesible íntegro y fuente monoespaciada sin desborde.
      const heading = detail.getByRole("heading", { name: CODES[94], exact: true });
      assert.equal(await heading.count(), 1);
      assert.ok(await heading.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && /Consolas|monospace|Courier|Cascadia|Liberation/.test(getComputedStyle(element).fontFamily)));
      await page.screenshot({ path: path.join(directory, `seleccion-${width}-${theme}.png`) });
      await page.keyboard.press("Escape"); await detail.waitFor({ state: "hidden" });
      await page.waitForFunction(() => location.search === "");
      assert.equal(await page.locator('[aria-current="location"]').count(), 0);
      await page.waitForFunction(() => document.activeElement?.matches('[data-location-id="94"]'));
      await page.close();
    });
  }
  assert.equal(JSON.stringify(active.state.tables), tablesBefore, "sin escrituras");
  assert.equal(active.state.writes.length + active.state.rpcs.length, 0);
});
