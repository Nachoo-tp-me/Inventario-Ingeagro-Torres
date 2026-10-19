// UI04a: navegación del shell (sidebar, topbar, nav móvil, selector Torres/Estantes, Exportaciones).
// Usa los componentes reales AppShell/LocationNavigation con servicios simulados (sin Supabase,
// sin autenticación real ni inventario productivo). Aditivo e independiente de B4: invariantes
// semánticas y geométricas, sin snapshots ni baselines.
// Node >=22; esbuild 0.28.2 y playwright 1.64.0 externos (npm install --prefix <tools> ...).
// NAVIGATION_TEST_TOOLS=<tools>; NAVIGATION_ARTIFACTS=<ruta externa opcional para capturas>.
// NAVIGATION_BASE_REF = commit del shell anterior para la comparación del desborde (por defecto 9e5d8587…).
// node --test tests/app-navigation.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireTools = createRequire(path.join(process.env.NAVIGATION_TEST_TOOLS ?? process.env.SHELVES_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const BASE_REF = process.env.NAVIGATION_BASE_REF ?? "9e5d8587a78da6c0941fd6dd9df4946e8a33da0b";
const cssFiles = ["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/rapid.css", "app/exports.css", "app/shelves.css"];

const fixture = `
  import { useSyncExternalStore } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppShell } from './components/app-shell';
  import { LocationNavigation } from './components/location-navigation';
  const subscribe = cb => { addEventListener('popstate', cb); return () => removeEventListener('popstate', cb); };
  window.__signOutCalls = 0; window.__replaced = null;
  function Page() {
    const route = useSyncExternalStore(subscribe, () => location.pathname);
    const locations = route.startsWith('/torres') || route.startsWith('/estantes');
    return <AppShell><div className="page-stack">{locations && <LocationNavigation />}<h1>{route}</h1><button type="button">Primer control del contenido</button></div></AppShell>;
  }
  createRoot(document.getElementById('root')).render(<Page />);
`;

const fakes = {
  "next/link": `import {createElement} from 'react'; export default function Link({href,children,replace,prefetch,scroll,...props}){
    return createElement('a',{...props,href,onClick:event=>{event.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`,
  "next/navigation": `import {useSyncExternalStore} from 'react';
    const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
    export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};
    export function useRouter(){return {replace(path){window.__replaced=path},refresh(){}}}`,
  client: "export function createSupabaseClient(){return {auth:{async signOut(){window.__signOutCalls++;return {error:null}}}}}",
};

// before=true: shell/selector anteriores leídos de un commit fijo (sin tocar el árbol de trabajo).
async function bundleFor(before) {
  const old = file => execFileSync("git", ["show", `${BASE_REF}:${file}`], { cwd: root, encoding: "utf8" });
  const result = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: fixture }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "offline-and-rev", setup(b) {
      b.onResolve({ filter: /^(next\/navigation|next\/link|@\/lib\/supabase\/client)$/ }, args => ({ path: args.path, namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ resolveDir: root, contents: fakes[args.path] ?? fakes.client }));
      if (before) b.onLoad({ filter: /[\\/]components[\\/](app-shell|location-navigation)\.tsx$/ }, args => ({ resolveDir: root, loader: "tsx",
        contents: old(`components/${path.basename(args.path)}`) }));
    } }],
  });
  return result.outputFiles[0].text;
}

const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// pathname → [href activo en escritorio | null, href activo en móvil, etiqueta contextual]
const ROUTES = [
  ["/", "/", "/", "Inicio"],
  ["/torres", "/torres", "/ubicaciones", "Torres"],
  ["/torres/C1", "/torres", "/ubicaciones", "Torres"],
  ["/estantes", "/estantes", "/ubicaciones", "Estantes"],
  ["/estantes/1", "/estantes", "/ubicaciones", "Estantes"],
  ["/ubicaciones", null, "/ubicaciones", "Ubicaciones"],
  ["/productos", "/productos", "/productos", "Productos"],
  ["/productos/nuevo", "/productos", "/productos", "Productos"],
  ["/productos/00000000-0000-0000-0000-000000000501", "/productos", "/productos", "Productos"],
  ["/carga", "/carga", "/carga", "Carga rápida"],
  ["/carga/ubicacion/73", "/carga", "/carga", "Carga rápida"],
  ["/historial", "/historial", "/historial", "Historial"],
  ["/exportaciones", "/exportaciones", null, "Exportaciones"],
];

test("UI04a: navegación accesible, estados activos, Exportaciones, cierre de sesión y desborde del shell", async t => {
  const directory = process.env.NAVIGATION_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), "ingeagro-ui04a-"));
  await mkdir(directory, { recursive: true });
  t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundles = { after: await bundleFor(false), before: await bundleFor(true) };
  const css = {
    after: (await Promise.all(cssFiles.map(f => readFile(path.join(root, f), "utf8")))).join("\n").replace('@import "tailwindcss";', ""),
    before: cssFiles.map(f => execFileSync("git", ["show", `${BASE_REF}:${f}`], { cwd: root, encoding: "utf8" })).join("\n").replace('@import "tailwindcss";', ""),
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.test");
    const rev = url.searchParams.get("rev") === "before" ? "before" : "after";
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundles[rev]); }
    else if (url.pathname === "/styles.css") { response.setHeader("Content-Type", "text/css"); response.end(css[rev]); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css?rev=${rev}"><div id="root"></div><script src="/fixture.js?rev=${rev}"></script></html>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); t.after(() => browser.close());

  async function newPage(width, theme, { rev = "after", height = 800, reducedMotion } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 800, reducedMotion });
    page.setDefaultTimeout(7000);
    page.errors = []; page.on("pageerror", error => page.errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.addInitScript(theme => { addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.theme = theme; }, { once: true }); }, theme);
    page.rev = rev; page.openRoute = async route => { await page.goto(`${url}${route}?rev=${rev}`); await page.locator("h1").waitFor(); };
    return page;
  }
  const paint = (page, selector, fromParent = false) => page.locator(selector).evaluateAll((elements, fromParent) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    return elements.filter(e => e.getClientRects().length).map(element => { let node = fromParent ? element.parentElement : element, bg; while (node) { bg = rgba(getComputedStyle(node).backgroundColor); if (bg[3] === 255) break; node = node.parentElement; }
      const style = getComputedStyle(element); return { text: element.textContent.trim(), fg: rgba(style.color), bg, ring: rgba(style.outlineColor), outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle }; });
  }, fromParent);
  const visibleNav = (page, width) => page.locator(width <= 760 ? ".mobile-navigation" : ".side-navigation");

  // ── Estados activos por segmento real, etiqueta contextual y selector Torres/Estantes ──
  for (const theme of ["light", "dark"]) for (const width of [390, 768, 1280]) {
    await t.test(`rutas y estados activos ${width}px ${theme}`, async () => {
      const page = await newPage(width, theme);
      for (const [route, desktopActive, mobileActive, label] of ROUTES) {
        await page.openRoute(route);
        const expected = width <= 760 ? mobileActive : desktopActive;
        const actives = await visibleNav(page, width).locator('a[aria-current="page"]').evaluateAll(links => links.map(link => link.getAttribute("href")));
        assert.deepEqual(actives, expected ? [expected] : [], `${route} a ${width}px: activos ${JSON.stringify(actives)}`);
        // El enlace activo también se distingue sin color: peso/indicador (escritorio) y aria-current (ambos).
        assert.equal(await visibleNav(page, width).locator("a.nav-link.active").count(), expected ? 1 : 0);
        // Etiqueta contextual (solo visible desde 761 px).
        if (width > 760) assert.equal((await page.locator(".topbar-section").innerText()).trim(), label, route);
        else assert.equal(await page.locator(".topbar-label").evaluate(element => getComputedStyle(element).display), "none");
        // Selector Torres/Estantes: solo en esas secciones y solo el correspondiente activo, con iconos.
        const selector = await page.locator(".location-navigation a").evaluateAll(links => links.map(link => ({ href: link.getAttribute("href"), current: link.getAttribute("aria-current"), icon: link.querySelectorAll("svg").length, height: Math.round(link.getBoundingClientRect().height) })));
        if (route.startsWith("/torres") || route.startsWith("/estantes")) {
          assert.deepEqual(selector.map(link => [link.href, link.current]), [["/torres", route.startsWith("/torres") ? "page" : null], ["/estantes", route.startsWith("/estantes") ? "page" : null]], route);
          assert.ok(selector.every(link => link.icon === 1 && link.height >= 44));
        } else assert.equal(selector.length, 0);
        // Exportaciones: entrada de sidebar (escritorio) o icono de topbar (móvil) activos solo en su ruta.
        if (width > 760) assert.equal(await page.locator('.side-navigation a[href="/exportaciones"]').getAttribute("aria-current"), route === "/exportaciones" ? "page" : null);
        else assert.equal(await page.locator(".topbar-export").getAttribute("aria-current"), route === "/exportaciones" ? "page" : null);
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  // ── Integridad de enlaces: todo href del shell resuelve a una página existente ──
  await t.test("enlaces del shell y del selector apuntan a rutas existentes", async () => {
    const hrefs = new Set();
    for (const width of [390, 1280]) {
      const page = await newPage(width, "light"); await page.openRoute("/torres");
      for (const href of await page.locator("a[href]").evaluateAll(links => links.map(link => link.getAttribute("href")))) hrefs.add(href);
      await page.close();
    }
    hrefs.delete("#contenido");
    for (const href of hrefs) assert.ok(existsSync(path.join(root, "app", "(workspace)", ...href.split("/").filter(Boolean), "page.tsx")), `ruta inexistente: ${href}`);
    assert.deepEqual([...hrefs].sort(), ["/", "/carga", "/estantes", "/exportaciones", "/historial", "/productos", "/torres", "/ubicaciones"]);
  });

  // ── Desbordamiento: comparación antes/después y barrido 761–1100 px ──
  const widths = [320, 360, 390, 640, 759, 760, 761, 768, 800, 820, 821, 830, 839, 840, 860, 900, 901, 1024, 1080, 1081, 1100, 1280];
  for (const theme of ["light", "dark"]) {
    await t.test(`desborde del shell ${theme}: antes (commit base) vs después`, async () => {
      const measure = async rev => {
        const page = await newPage(1280, theme, { rev }); await page.openRoute("/");
        const rows = {};
        for (const width of [...new Set([...widths, ...Array.from({ length: 35 }, (_, i) => 761 + i * 10)])]) {
          await page.setViewportSize({ width, height: 800 });
          rows[width] = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth,
            outside: [...document.querySelectorAll("body *")].filter(el => el.getClientRects().length && el.getBoundingClientRect().right > innerWidth + 0.5).map(el => el.className || el.tagName).slice(0, 3) }));
        }
        await page.close(); return rows;
      };
      const before = await measure("before"), after = await measure("after");
      const brokenBefore = Object.entries(before).filter(([, r]) => r.over > 0).map(([w, r]) => `${w}:${r.over}px`);
      const brokenAfter = Object.entries(after).filter(([, r]) => r.over > 0).map(([w, r]) => `${w}:${r.over}px ${r.outside}`);
      t.diagnostic(`${theme} antes: ${brokenBefore.join(" ") || "sin desborde"} | después: ${brokenAfter.join(" ") || "sin desborde"}`);
      assert.deepEqual(brokenAfter, [], "el shell no desborda en ningún ancho 320–1280");
      if (theme === "light") assert.ok(brokenBefore.some(entry => { const w = Number(entry.split(":")[0]); return w >= 821 && w <= 840; }), `el commit base debía reproducir el desborde 821–840 (${brokenBefore})`);
    });
  }

  // ── Topbar: controles visibles, no superpuestos y táctiles, también a 320 px; cierre de sesión único ──
  for (const theme of ["light", "dark"]) for (const width of [320, 360, 390, 640, 760, 761, 768, 821, 840, 1024, 1080, 1081, 1280]) {
    await t.test(`topbar y cierre de sesión ${width}px ${theme}`, async () => {
      const page = await newPage(width, theme); await page.openRoute("/exportaciones");
      const info = await page.evaluate(() => {
        const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible";
        const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: Math.round(r.width), h: Math.round(r.height) }; };
        const controls = Object.fromEntries([["brand", ".mobile-brand"], ["export", ".topbar-export"], ["theme", ".topbar .theme-toggle"], ["signout", ".topbar .signout"]]
          .map(([name, selector]) => { const el = document.querySelector(selector); return [name, visible(el) ? rectOf(el) : null]; }));
        const sidebarSignout = document.querySelector(".sidebar .signout"); const sidebar = document.querySelector(".sidebar");
        return { controls, sidebarSignout: !!sidebarSignout && getComputedStyle(sidebar).display !== "none" && visible(sidebarSignout), vw: innerWidth };
      });
      const names = Object.entries(info.controls).filter(([, rect]) => rect);
      const mobile = width <= 760;
      assert.deepEqual(names.map(([name]) => name), mobile ? ["brand", "export", "theme", "signout"] : ["theme"], JSON.stringify(info));
      assert.equal(info.sidebarSignout, !mobile, "cierre de sesión: sidebar en ≥761 px, topbar en móvil");
      for (const [name, rect] of names) { assert.ok(rect.left >= -0.5 && rect.right <= info.vw + 0.5, `${name} fuera de pantalla a ${width}px`); if (name !== "brand") assert.ok(rect.w >= 44 && rect.h >= 44, `${name} ${rect.w}×${rect.h}`); }
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const a = names[i][1], b = names[j][1];
        assert.ok(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top || b.bottom <= a.top, `${names[i][0]} se superpone con ${names[j][0]} a ${width}px`); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.waitForTimeout(300); // fin de la transición de color tras aplicar el tema
      if (mobile) { // icono de Exportaciones activo: contraste no textual ≥3:1 frente a su fondo efectivo
        const sample = (await paint(page, ".topbar-export"))[0];
        assert.ok(ratio(sample.fg, sample.bg) >= 3, `icono de Exportaciones ${ratio(sample.fg, sample.bg).toFixed(2)}:1`);
      }
      if ([320, 768, 1280].includes(width)) await page.screenshot({ path: path.join(directory, `shell-${width}-${theme}.png`) });
      await page.close();
    });
  }

  // ── Cierre de sesión (simulado), Exportaciones y navegación por clic ──
  for (const width of [390, 1280]) await t.test(`cierre de sesión, Exportaciones y navegación ${width}px`, async () => {
    const page = await newPage(width, "light"); await page.openRoute("/");
    const exportLink = width <= 760 ? page.locator(".topbar-export") : page.locator('.side-navigation a[href="/exportaciones"]');
    assert.equal(await exportLink.getAttribute("href"), "/exportaciones");
    assert.equal(await exportLink.evaluate(link => (link.getAttribute("aria-label") ?? link.textContent).trim()), width <= 760 ? "Exportar inventario" : "Exportaciones");
    await exportLink.click(); await page.waitForFunction(() => location.pathname === "/exportaciones");
    assert.equal(await exportLink.getAttribute("aria-current"), "page");
    // «Torres» → clic real en el selector del escritorio, y subruta mantiene su entrada activa.
    await page.evaluate(() => { history.pushState({}, "", "/torres/C1"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.locator(".location-navigation").waitFor();
    await page.locator('.location-navigation a[href="/estantes"]').click(); await page.waitForFunction(() => location.pathname === "/estantes");
    assert.equal(await page.locator('.location-navigation a[aria-current="page"]').count(), 1);
    // Cierre de sesión: exactamente un botón visible y operativo (cliente simulado) → /login.
    const signOut = page.locator(".signout").filter({ visible: true });
    assert.equal(await signOut.count(), 1);
    assert.equal(await signOut.getAttribute("aria-label"), "Cerrar sesión");
    await signOut.click(); await page.waitForFunction(() => window.__replaced === "/login");
    assert.equal(await page.evaluate(() => window.__signOutCalls), 1);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  // ── Teclado: «Saltar al contenido», orden de Tab y foco visible real ──
  for (const theme of ["light", "dark"]) for (const width of [390, 1280]) {
    await t.test(`teclado, saltar al contenido y foco visible ${width}px ${theme}`, async () => {
      const page = await newPage(width, theme); await page.openRoute("/historial");
      const name = () => page.evaluate(() => { const a = document.activeElement; return (a.getAttribute("aria-label") ?? a.textContent ?? "").trim().replace(/\s+/g, " "); });
      const stops = [];
      for (let i = 0; i < (width <= 760 ? 6 : 12); i++) {
        await page.keyboard.press("Tab"); stops.push(await name());
        const ring = (await paint(page, ":focus-visible", true))[0];
        assert.ok(ring && ring.outlineStyle === "solid" && ring.outlineWidth >= 3, `sin foco visible en «${stops.at(-1)}»`);
        assert.ok(ratio(ring.ring, ring.bg) >= 3 || stops.at(-1) === "Saltar al contenido", `contraste de foco en «${stops.at(-1)}»: ${ratio(ring.ring, ring.bg).toFixed(2)}`);
      }
      const expected = width <= 760
        ? ["Saltar al contenido", "Inventario Ingeagro, ir a Inicio", "Exportar inventario", "Cambiar entre modo claro y modo oscuro", "Cerrar sesión", "Primer control del contenido"]
        : ["Saltar al contenido", "Inventario Ingeagro, ir a Inicio", "Inicio", "Torres", "Estantes", "Productos", "Carga rápida", "Historial", "Exportaciones", "Cerrar sesión", "Cambiar entre modo claro y modo oscuro", "Primer control del contenido"];
      assert.deepEqual(stops, expected, "orden de Tab");
      // El enlace es visible solo al enfocarlo y mueve el foco al <main>.
      await page.reload(); await page.locator("h1").waitFor();
      const hidden = await page.locator(".skip-link").evaluate(el => el.getBoundingClientRect().bottom <= 0);
      assert.equal(hidden, true, "oculto sin foco");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".skip-link").evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom > 0 && r.right <= innerWidth && document.activeElement === el; }), true);
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "contenido");
      await page.keyboard.press("Tab");
      assert.equal(await name(), "Primer control del contenido");
      await page.waitForTimeout(300); // fin de la transición de color tras aplicar el tema (evita medir un color intermedio)
      // Los enlaces activos y el texto de navegación mantienen contraste ≥4,5:1 en el tema actual.
      for (const selector of [".side-navigation .nav-link", ".mobile-navigation .nav-link", ".topbar-label span", ".location-navigation a"])
        for (const sample of await paint(page, selector)) assert.ok(ratio(sample.fg, sample.bg) >= 4.5, `${selector} «${sample.text}» ${ratio(sample.fg, sample.bg).toFixed(2)}`);
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  // ── Movimiento reducido y transición discreta ──
  await t.test("prefers-reduced-motion sin transiciones en navegación", async () => {
    const page = await newPage(1280, "light"); await page.openRoute("/");
    assert.ok(await page.locator(".nav-link").first().evaluate(link => parseFloat(getComputedStyle(link).transitionDuration) > 0.1), "transición discreta normal");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.ok(await page.locator(".nav-link, .topbar-export, .skip-link").evaluateAll(els => els.every(el => getComputedStyle(el).transitionDuration.split(",").every(value => parseFloat(value) <= 0.001))));
    await page.close();
  });
});
