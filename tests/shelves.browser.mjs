// UI real con endpoints locales que ejecutan páginas/DAL/acción reales contra
// servicios simulados. Nunca usa Supabase, JWT reales ni inventario productivo.
// Node >=22; esbuild 0.28.2 y playwright 1.64.0 externos; Chromium instalado.
// npm install --prefix <tools> esbuild@0.28.2 playwright@1.64.0
// node <tools>/node_modules/playwright/cli.js install chromium
// SHELVES_TEST_TOOLS=<tools>; SHELVES_ARTIFACTS=<ruta externa opcional>.
// node --test tests/shelves.browser.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createShelfFixture, productId, root, requireTools } from "./helpers/shelves-fixture.mjs";

const { build } = requireTools('esbuild');
const { chromium } = requireTools('playwright');
const fixture = `
  import { useEffect,useState,useSyncExternalStore } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AppShell } from './components/app-shell';
  import { ShelfOverview } from './components/shelf-overview';
  import { ShelfView } from './components/shelf-view';
  import { TowerGrid } from './components/dashboard';
  import { LocationNavigation } from './components/location-navigation';
  import LocationsPage from './app/(workspace)/ubicaciones/page';
  import ShelfError from './app/(workspace)/estantes/error';
  import LoadingShelves from './app/(workspace)/estantes/loading';
  const subscribe=cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)};
  function Current(){
    const url=useSyncExternalStore(subscribe,()=>location.pathname+location.search);
    const [data,setData]=useState(null);const [error,setError]=useState('');
    const [epoch,setEpoch]=useState(0);
    useEffect(()=>{window.__refresh=()=>setEpoch(value=>value+1);return()=>{delete window.__refresh}},[]);
    useEffect(()=>{
      let active=true;setError('');
      fetch('/data?path='+encodeURIComponent(url)).then(async response=>{
        if(!response.ok)throw new Error(await response.text());return response.json();
      }).then(result=>{if(active)setData(result)}).catch(e=>{if(active)setError(e.message)});
      return()=>{active=false};
    },[url,epoch]);
    if(error)return <ShelfError retry={()=>setEpoch(value=>value+1)}/>;
    if(url.startsWith('/ubicaciones'))return <LocationsPage/>;
    if(!data || data.path!==location.pathname)return <LoadingShelves/>;
    if(data.kind==='overview')return <ShelfOverview shelves={data.shelves}/>;
    if(data.kind==='tower')return <div className="page-stack"><LocationNavigation/><h1>Torres</h1><TowerGrid towers={data.towers}/></div>;
    const selected=new URLSearchParams(location.search).get('caja');
    return <ShelfView shelf={data.shelf} locations={data.locations} products={data.products} selectedId={selected?Number(selected):null}/>;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
`;

test('Estantes: seis mapas físicos, navegación y stock compartido en ambos temas', async t => {
  const directory = process.env.SHELVES_ARTIFACTS ?? await mkdtemp(path.join(tmpdir(), 'ingeagro-block3-'));
  await mkdir(directory, { recursive: true });
  t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: fixture },
    bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'offline-browser-services', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|next\/link|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/stock-actions)$/ }, args => ({ path: args.path, namespace: 'fake' }));
      build.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ resolveDir: root, contents:
        args.path === 'next/link' ? `import {createElement} from 'react'; export default function Link({href,children,...props}){
          return createElement('a',{...props,href,onClick:event=>{event.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`
        : args.path === 'next/navigation' ? `import {useSyncExternalStore} from 'react';
          const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
          export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};
          export function useRouter(){return {replace(path){setTimeout(()=>{history.replaceState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},window.__navigationDelay??0)},refresh(){window.__refresh?.()}}}`
        : args.path.endsWith('/supabase/client') ? "export function createSupabaseClient(){throw new Error('Real authentication disabled')}"
        : "export async function submitStockOperation(input){const response=await fetch('/action',{method:'POST',body:JSON.stringify(input)});return response.json()}" }));
    } }],
  });
  const css = (await Promise.all(['app/globals.css','components/tower-view.css','app/theme.css','app/catalog.css','app/stock.css','app/shelves.css']
    .map(file => readFile(path.join(root,file),'utf8')))).join('\n').replace('@import "tailwindcss";','');
  let activeFixture = createShelfFixture();
  const server = createServer(async (request,response) => {
    try {
      const url = new URL(request.url,'http://fixture.test');
      if(url.pathname==='/data') {
        const target = new URL(url.searchParams.get('path'),'http://fixture.test');
        let data;
        if(target.pathname==='/estantes') data={kind:'overview',shelves:(await activeFixture.shelvesPage()).props.shelves};
        else if(target.pathname==='/torres') data={kind:'tower',towers:(await activeFixture.getDashboardSummary()).torres};
        else if(target.pathname==='/ubicaciones') data={kind:'locations'};
        else {
          const element=await activeFixture.shelfPage({params:Promise.resolve({id:target.pathname.split('/')[2]}),searchParams:Promise.resolve({caja:target.searchParams.get('caja')??undefined})});
          data={kind:'detail',...element.props};
        }
        response.setHeader('Content-Type','application/json');response.end(JSON.stringify({path:target.pathname,...data}));
      } else if(url.pathname==='/action') {
        const chunks=[];for await(const chunk of request)chunks.push(chunk);
        const result=await activeFixture.submitStockOperation(JSON.parse(Buffer.concat(chunks).toString()));
        response.setHeader('Content-Type','application/json');response.end(JSON.stringify(result));
      } else if(url.pathname==='/fixture.js') {
        response.setHeader('Content-Type','application/javascript');response.end(bundle.outputFiles[0].text);
      } else {
        response.setHeader('Content-Type','text/html; charset=utf-8');
        response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`);
      }
    } catch(error) {response.statusCode=error.message==='NOT_FOUND'?404:503;response.end(error.message)}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch();t.after(()=>browser.close());
  const results=[];
  for(const width of [1280,360,390]) for(const theme of ['light','dark']) {
    await t.test(`${width}px ${theme}`,async()=>{
      activeFixture=createShelfFixture();
      const page=await browser.newPage({viewport:{width,height:850},hasTouch:width<400});
      page.setDefaultTimeout(7000);
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
      await page.goto(url+'/estantes');
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      const cards=page.locator('.shelf-card');await cards.nth(5).waitFor();
      assert.equal(await cards.count(),6);
      assert.equal(await page.locator('.shelf-box').count(),24);
      for(let i=0;i<6;i++) {
        const cells=cards.nth(i).locator('.shelf-box');
        assert.deepEqual(await cells.locator('.shelf-box-code').allTextContents(),Array.from({length:4},(_,p)=>(i<3?'A':'B')+((i%3)*4+p+1)));
        assert.deepEqual(await cells.evaluateAll(cells=>cells.map(cell=>cell.dataset.position)),['1','2','3','4']);
        const boxes=await cells.evaluateAll(cells=>cells.map(cell=>{const r=cell.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right}}));
        assert.equal(boxes[0].y,boxes[1].y);assert.equal(boxes[2].y,boxes[3].y);
        assert.ok(boxes[0].x<boxes[1].x&&boxes[0].y<boxes[2].y);
      }
      assert.match(await cards.first().innerText(),/2 referencias · 10 unidades/);
      assert.match(await cards.first().locator('.shelf-box').nth(1).innerText(),/Disponible/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const contrasts=await page.evaluate(()=>{
        const channels=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=rgb=>rgb.map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        return ['.shelf-box-code','.shelf-box small','.shelf-box-counts','.shelf-box .available','.shelf-box .occupied','.location-navigation [aria-current]'].map(selector=>{
          const element=document.querySelector(selector);let ancestor=element,background;
          while(ancestor){background=getComputedStyle(ancestor).backgroundColor;if(background!=='rgba(0, 0, 0, 0)')break;ancestor=ancestor.parentElement}
          const color=getComputedStyle(element).color,a=luminance(channels(color)),b=luminance(channels(background));
          return {selector,color,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
        });
      });
      assert.ok(contrasts.every(item=>item.ratio>=4.5),JSON.stringify(contrasts));
      const navigation=page.locator(width<400?'.mobile-navigation':'.side-navigation');
      const labels=await navigation.locator('.nav-link span').allTextContents();
      assert.deepEqual(labels,width<400?['Inicio','Productos','Ubicaciones','Carga','Historial']:['Inicio','Torres','Estantes','Productos','Carga rápida','Historial']);
      await page.screenshot({path:path.join(directory,`estantes-${width}-${theme}.png`),fullPage:true});
      if(width<400) {
        await navigation.getByRole('link',{name:'Ubicaciones',exact:true}).tap();
        await page.getByRole('heading',{name:'Ubicaciones',exact:true}).waitFor();
        await page.screenshot({path:path.join(directory,`ubicaciones-${width}-${theme}.png`),fullPage:true});
        await page.locator('.locations-grid').getByRole('link',{name:/Estantes/}).click();await cards.nth(5).waitFor();
      }
      if(width<400) await page.locator('[data-location-id="73"]').tap();
      else await page.locator('[data-location-id="73"]').click();
      const detail=page.locator('.compartment-dialog[open]');await detail.waitFor();
      assert.equal(new URL(page.url()).pathname,'/estantes/1');
      assert.equal(new URL(page.url()).searchParams.get('caja'),'73');
      assert.match(await detail.locator('.sheet-location').innerText(),/Estante 1 · Superior izquierda/);
      assert.match(await detail.innerText(),/ESP32-S3/);
      assert.equal(await detail.locator('a[href^="/carga/"]').count(),0);
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
      await page.screenshot({path:path.join(directory,`caja-${width}-${theme}.png`),fullPage:true});
      const productRow=()=>detail.locator('.sheet-product').filter({hasText:'Módulo térmico'});
      const stockDialog=page.locator('.stock-dialog[open]');
      async function openOperation(label) {
        await productRow().getByRole('button',{name:'Acciones',exact:true}).click();
        const menu=page.locator('.stock-action-options:popover-open');await menu.waitFor();
        assert.equal(await menu.getByRole('button',{name:label,exact:true}).evaluate(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button}),true);
        await menu.getByRole('button',{name:label,exact:true}).click();await stockDialog.waitFor();
      }
      async function commitQuantity(quantity) {
        await stockDialog.locator('#stock-quantity').fill(String(quantity));await stockDialog.locator('button[type="submit"]').click();
        if(await stockDialog.locator('.stock-confirmation').count()) await stockDialog.getByRole('button',{name:'Confirmar movimiento'}).click();
        await stockDialog.waitFor({state:'hidden'});
      }
      await openOperation('Agregar');await commitQuantity(2);
      await page.waitForFunction(()=>[...document.querySelectorAll('.sheet-product')].find(row=>row.textContent.includes('Módulo térmico'))?.querySelector('.product-quantity strong')?.textContent.trim()==='9');
      await openOperation('Retirar');await commitQuantity(1);
      await page.waitForFunction(()=>[...document.querySelectorAll('.sheet-product')].find(row=>row.textContent.includes('Módulo térmico'))?.querySelector('.product-quantity strong')?.textContent.trim()==='8');
      await openOperation('Ajustar');assert.equal(await stockDialog.locator('#stock-quantity').inputValue(),'8');await commitQuantity(6);
      await page.waitForFunction(()=>[...document.querySelectorAll('.sheet-product')].find(row=>row.textContent.includes('Módulo térmico'))?.querySelector('.product-quantity strong')?.textContent.trim()==='6');
      await openOperation('Mover');
      await stockDialog.locator('#stock-location-search').fill('B12');
      await stockDialog.getByRole('group',{name:'Ubicaciones disponibles'}).getByRole('button',{name:/B12/}).click();
      await commitQuantity(2);
      await page.waitForFunction(()=>[...document.querySelectorAll('.sheet-product')].find(row=>row.textContent.includes('Módulo térmico'))?.querySelector('.product-quantity strong')?.textContent.trim()==='4');
      assert.deepEqual(activeFixture.state.writes.map(row=>[row.producto_id,row.tipo,row.origen_compartimiento_id,row.destino_compartimiento_id,row.cantidad]),[
        [productId,'entrada',null,73,2],[productId,'retiro',73,null,1],[productId,'ajuste',73,null,2],[productId,'traslado',73,96,2],
      ]);
      assert.ok(activeFixture.state.paths.includes('/estantes/1')&&activeFixture.state.paths.includes('/estantes/6'));
      await openOperation('Retirar');await page.keyboard.press('Escape');await stockDialog.waitFor({state:'hidden'});
      assert.equal(await detail.count(),1,'Escape en operación conserva el detalle');
      assert.equal(await productRow().getByRole('button',{name:'Acciones',exact:true}).evaluate(button=>document.activeElement===button),true);
      await page.evaluate(()=>window.__navigationDelay=50);
      await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
      await page.waitForFunction(()=>location.search==='');
      await page.waitForFunction(()=>document.activeElement?.matches('[data-location-id="73"]'));
      assert.equal(await page.locator('[data-location-id="73"]').evaluate(link=>document.activeElement===link),true);
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
      await page.locator('[data-location-id="74"]').click();await detail.waitFor();
      assert.match(await detail.innerText(),/Caja disponible/);
      await detail.getByRole('button',{name:'Agregar producto',exact:true}).click();
      await stockDialog.locator('#stock-product-search').fill('modulo termico');
      await stockDialog.getByRole('group',{name:'Productos disponibles'}).getByRole('button',{name:/Módulo térmico/}).click();
      await commitQuantity(1);
      await detail.locator('.sheet-status.occupied').waitFor();
      assert.equal(activeFixture.state.writes.at(-1).destino_compartimiento_id,74);
      await detail.getByRole('button',{name:'Cerrar detalle de caja'}).click();await detail.waitFor({state:'hidden'});
      // Vista de torres: tres tarjetas originales con 24 compartimientos cada una.
      await page.getByRole('navigation',{name:'Tipos de ubicación'}).getByRole('link',{name:'Torres',exact:true}).click();
      await page.locator('.tower-card').nth(2).waitFor();
      assert.equal(await page.locator('.tower-card').count(),3);
      assert.ok((await page.locator('.tower-ratio').allTextContents()).every(text=>text.includes('24')));
      assert.deepEqual(errors,[]);
      results.push({width,theme,status:'PASS',contrasts});await page.close();
    });
  }
  await t.test('vacío, error recuperable y código cambiado conservan navegación por ID',async()=>{
    activeFixture=createShelfFixture();activeFixture.state.tables.estantes=[];
    const page=await browser.newPage({viewport:{width:390,height:850}});
    await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
    await page.goto(url+'/estantes');await page.getByRole('heading',{name:'No hay estantes para mostrar'}).waitFor();
    activeFixture=createShelfFixture();activeFixture.state.failTable='estantes';
    await page.reload();await page.getByRole('alert').waitFor();
    activeFixture.state.failTable=null;await page.getByRole('button',{name:'Reintentar'}).click();await page.locator('.shelf-card').nth(5).waitFor();
    activeFixture.state.tables.compartimientos.find(row=>row.id===73).codigo='MOTORES_1234567890123456';
    await page.goto(url+'/estantes/1?caja=73');
    await page.locator('.compartment-dialog[open]').getByRole('heading',{name:'MOTORES_1234567890123456'}).waitFor();
    assert.equal(await page.locator('.box-dialog[open]').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth),true);
    await page.screenshot({path:path.join(directory,'caja-390-codigo-largo.png')});
    await page.locator('.compartment-dialog[open]').evaluate(dialog=>dialog.close());
    await page.waitForFunction(()=>location.search==='');
    await page.locator('.compartment-dialog[open]').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.matches('[data-location-id="73"]'));
    assert.equal(await page.locator('[data-location-id="73"]').getAttribute('href'),'/estantes/1?caja=73');
    assert.equal(await page.locator('[data-location-id="73"]').getAttribute('data-position'),'1');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.close();
  });
  await t.test('detalle largo: desplazamiento, menú táctil y Escape a 390px',async()=>{
    activeFixture=createShelfFixture();
    for(let i=0;i<24;i++){
      const id='00000000-0000-0000-0000-'+String(600+i).padStart(12,'0');
      activeFixture.state.tables.productos.push({id,nombre:`Producto sintético ${String(i).padStart(2,'0')}`,categoria_id:'cat01',foto_ruta:null});
      activeFixture.state.tables.inventario.push({producto_id:id,compartimiento_id:96,cantidad:i+1});
    }
    const page=await browser.newPage({viewport:{width:390,height:700},hasTouch:true});
    await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
    await page.goto(url+'/estantes/6?caja=96');
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    const detail=page.locator('.compartment-dialog[open]');await detail.waitFor();
    assert.equal(await detail.evaluate(dialog=>dialog.scrollHeight>dialog.clientHeight),true);
    await detail.evaluate(async dialog=>{dialog.scrollTop=dialog.scrollHeight;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});
    const trigger=detail.locator('.sheet-product').last().getByRole('button',{name:'Acciones',exact:true});
    await trigger.tap();const menu=page.locator('.stock-action-options:popover-open');await menu.waitFor();
    assert.equal(await menu.getByRole('button',{name:'Ajustar',exact:true}).evaluate(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button}),true);
    await page.screenshot({path:path.join(directory,'caja-390-dark-scroll.png')});
    await menu.getByRole('button',{name:'Ajustar',exact:true}).tap();
    const operation=page.locator('.stock-dialog[open]');await operation.waitFor();
    assert.equal(await operation.locator('#stock-quantity').inputValue(),'24');
    assert.equal(await operation.locator('.stock-fixed-choice strong').last().innerText(),'B12');
    await page.keyboard.press('Escape');await operation.waitFor({state:'hidden'});
    assert.equal(await trigger.evaluate(button=>document.activeElement===button),true);
    await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.matches('[data-location-id="96"]'));
    assert.equal(await page.locator('[data-location-id="96"]').evaluate(link=>document.activeElement===link),true);
    await page.close();
  });
  await writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2));
});
