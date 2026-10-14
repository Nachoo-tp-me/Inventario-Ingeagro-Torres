// UI real aislada: 96 ubicaciones sintéticas, acciones capturadas en memoria.
// Nunca importa autenticación/Supabase ni ejecuta movimientos SQL.
// Node >=22; esbuild 0.28.2 + playwright 1.64.0 externos y Chromium instalado.
// npm install --prefix <tools> esbuild@0.28.2 playwright@1.64.0
// node <tools>/node_modules/playwright/cli.js install chromium
// STOCK_LOCATION_TEST_TOOLS=<tools>; node --test tests/stock-locations.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireTools = createRequire(path.join(process.env.STOCK_LOCATION_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const product = "00000000-0000-0000-0000-000000000501";

test("stock común: formularios reales y asociaciones de cajas/torres, ambos temas", async t => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ProductStockControls } from './components/product-stock-controls';
      import { StockOperationDialog } from './components/stock-operation';
      import { CompartmentDetail } from './components/compartment-detail';
      const products = [
        {id:'${product}',nombre:'Módulo térmico',categoria:'Electrónica'},
        {id:'00000000-0000-0000-0000-000000000502',nombre:'ESP32-S3 C++',categoria:'Sensores técnicos'},
      ];
      const locations = [
        ...Array.from({length:72},(_,i)=>({tipo:'compartimiento',id:i+1,
          codigo:'C'+(Math.floor(i/24)+1)+(Math.floor(i%24/4)+1)+(i%4+1),
          torre_id:Math.floor(i/24)+1,piso:Math.floor(i%24/4)+1,posicion:i%4+1})),
        ...Array.from({length:24},(_,i)=>({tipo:'caja',id:i+73,codigo:(i<12?'A':'B')+(i%12+1),
          estante_id:Math.floor(i/4)+1,posicion:i%4+1})),
      ];
      function Fixture() {
        const [operation,setOperation] = useState(null);
        const [open,setOpen] = useState(false);
        return <>
          <button id="entry" onClick={()=>setOperation({tipo:'entrada'})}>Entrada de prueba</button>
          <button id="compartment" onClick={()=>setOpen(true)}>Compartimiento de prueba</button>
          <button id="missing-origin" onClick={()=>setOperation({tipo:'retiro',productoId:'${product}',origenId:999999,currentStock:10})}>Origen inexistente</button>
          <button id="missing-destination" onClick={()=>setOperation({tipo:'entrada',productoId:'${product}',destinoId:999999})}>Destino inexistente</button>
          <main style={{padding:'40px 16px 200px',maxWidth:900,margin:'auto'}}>
            <ProductStockControls product={products[0]} physicalLocations={locations}
              locations={[locations[0],locations[72],locations[95]].map(row=>({...row,cantidad:10}))}/>
          </main>
          <nav className="mobile-navigation">{['Inicio','Productos','Torres','Historial','Más'].map(label=><button key={label} className="nav-link">{label}</button>)}</nav>
          {operation && <StockOperationDialog operation={operation} products={products} locations={locations}
            onClose={()=>setOperation(null)} onSuccess={()=>{}}/>}
          <CompartmentDetail compartment={open ? {...locations[0],ocupado:true,
            productos:[{...products[0],cantidad:10,fotoUrl:null}]} : null}
            towerCode="C1" compartments={locations} products={products} onClose={()=>setOpen(false)}/>
        </>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "no-real-services", setup(build) {
      build.onResolve({ filter: /^(next\/navigation|next\/link|@\/app\/\(workspace\)\/(stock-actions|box-code-actions))$/ }, args => ({ path: args.path, namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents: args.path.endsWith('/box-code-actions') ? 'export async function renameBoxCode(){throw new Error("Renames disabled in stock regression")}' : args.path === 'next/navigation'
        ? 'export function useRouter(){return {refresh(){window.__refreshes++}}}'
        : args.path === 'next/link'
          ? 'import {createElement} from "react"; export default function Link(props){return createElement("a",props)}'
          : 'export async function submitStockOperation(input){window.__submissions.push(input);return {ok:true,message:"Movimiento simulado"}}', resolveDir: root }));
    } }],
  });
  const css = (await Promise.all(["app/globals.css", "app/theme.css", "app/catalog.css", "app/stock.css", "components/tower-view.css"]
    .map(file => readFile(path.join(root, file), "utf8")))).join("\n").replace('@import "tailwindcss";', '');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'application/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text
      : `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>window.__submissions=[];window.__refreshes=0;</script><script src="/fixture.js"></script></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const width of [1280, 360, 390]) for (const theme of ['light', 'dark']) {
    await t.test(`${width}px, ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await page.goto(url);
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const dialog = page.locator('.stock-dialog[open]');
      const rows = page.locator('.catalog-location-list li');
      const expected = [];
      async function finish(input, quantity) {
        await dialog.locator('#stock-quantity').fill(String(quantity));
        await dialog.locator('button[type="submit"]').click();
        if (input.tipo !== 'entrada') {
          await dialog.locator('.stock-confirmation').waitFor();
          await dialog.getByRole('button', { name: 'Confirmar movimiento' }).click();
        }
        await dialog.waitFor({ state: 'hidden' });
        expected.push({ origenId: undefined, destinoId: undefined, ...input, productoId: product });
        assert.deepEqual(await page.evaluate(() => window.__submissions), expected);
      }
      async function openRow(index, name) {
        await rows.nth(index).getByRole('button', { name: 'Acciones', exact: true }).click();
        await page.locator('.stock-action-options:popover-open').getByRole('button', { name, exact: true }).click();
        await dialog.waitFor();
        assert.equal(await dialog.locator('.stock-fixed-choice strong').last().innerText(), index === 0 ? 'C111' : index === 1 ? 'A1' : 'B12');
      }
      async function pickDestination(query, code) {
        await dialog.locator('#stock-location-search').fill(query);
        const option = dialog.getByRole('group', { name: 'Ubicaciones disponibles' }).getByRole('button').filter({ has: page.getByText(code, { exact: true }) });
        if (code === 'B12') assert.match(await option.innerText(), /Estante 6 · Inferior derecha/);
        await option.click();
      }
      // Entrada sin producto preseleccionado, usa normalización B3 real.
      await page.locator('#entry').click();
      await dialog.locator('#stock-product-search').fill('sensores tecnicos');
      assert.match(await dialog.getByRole('group', { name: 'Productos disponibles' }).innerText(), /ESP32-S3 C\+\+/);
      await dialog.locator('#stock-product-search').fill('modulo termico');
      await dialog.getByRole('group', { name: 'Productos disponibles' }).getByRole('button', { name: /Módulo térmico/ }).click();
      assert.equal(await dialog.getByRole('group', { name: 'Ubicaciones disponibles' }).getByRole('button').count(), 50);
      // Caja 96 fuera de la primera página visible sigue accesible por búsqueda.
      await pickDestination('estante 6', 'B12');
      await finish({ tipo: 'entrada', destinoId: 96, cantidad: 3 }, 3);
      await openRow(1, 'Retirar');
      await finish({ tipo: 'retiro', origenId: 73, cantidad: 2 }, 2);
      await openRow(1, 'Ajustar');
      assert.equal(await dialog.locator('#stock-quantity').inputValue(), '10');
      await finish({ tipo: 'ajuste', origenId: 73, cantidadFisica: 8, cantidadEsperada: 10 }, 8);
      for (const [row, source, target, code] of [[0, 1, 96, 'B12'], [1, 73, 25, 'C211'], [1, 73, 96, 'B12'], [0, 1, 25, 'C211']]) {
        await openRow(row, 'Mover');
        if (source === 73) {
          await dialog.locator('#stock-location-search').fill('A1');
          assert.equal(await dialog.getByRole('group', { name: 'Ubicaciones disponibles' }).getByText('A1', { exact: true }).count(), 0);
        }
        await pickDestination(code.toLowerCase(), code);
        await finish({ tipo: 'traslado', origenId: source, destinoId: target, cantidad: 1 }, 1);
      }
      // Rechazos en el formulario: nunca llegan al servicio simulado.
      await openRow(1, 'Retirar');
      await dialog.locator('#stock-quantity').fill('11');
      await dialog.getByRole('button', { name: 'Continuar', exact: true }).click();
      assert.match(await dialog.getByRole('alert').innerText(), /suficiente/);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await rows.nth(1).getByRole('button', { name: 'Acciones', exact: true }).evaluate(button => document.activeElement === button), true);
      for (const selector of ['#missing-origin', '#missing-destination']) {
        await page.locator(selector).click();
        await dialog.locator('#stock-quantity').fill('1');
        await dialog.locator('button[type="submit"]').click();
        assert.match(await dialog.getByRole('alert').innerText(), /no está disponible/);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
      }
      assert.deepEqual(await page.evaluate(() => window.__submissions), expected);
      assert.equal(await page.evaluate(() => window.__refreshes), 7);
      // Destino caja desde el diálogo modal de un compartimiento real.
      await page.locator('#compartment').click();
      const sheet = page.locator('.compartment-dialog[open]');
      await sheet.getByRole('button', { name: 'Acciones', exact: true }).click();
      await page.locator('.stock-action-options:popover-open').getByRole('button', { name: 'Mover', exact: true }).click();
      await dialog.waitFor();
      assert.equal(await dialog.locator('.stock-fixed-choice strong').last().innerText(), 'C111');
      await pickDestination('B12', 'B12');
      await finish({ tipo: 'traslado', origenId: 1, destinoId: 96, cantidad: 2 }, 2);
      await sheet.getByRole('button', { name: 'Cerrar detalle de compartimiento' }).click();
      await sheet.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.__refreshes), 8);
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
});
