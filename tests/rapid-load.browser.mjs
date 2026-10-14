// Node >=22; esbuild 0.28.2 + Playwright 1.64.0 externos y Chromium instalado.
// SHELVES_TEST_TOOLS=<tools>; RAPID_LOAD_ARTIFACTS=<ruta externa opcional>.
// UI, rutas y acciones reales sobre servicios simulados. Sin .env ni Supabase real.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createShelfFixture, productId, root, requireTools } from './helpers/shelves-fixture.mjs';
const {build}=requireTools('esbuild');const {chromium}=requireTools('playwright');

test('carga común: selección, persistencia, entradas y recorridos en ambos temas',async t=>{
  const directory=process.env.RAPID_LOAD_ARTIFACTS??await mkdtemp(path.join(tmpdir(),'ingeagro-rapid-load-'));
  await mkdir(directory,{recursive:true});t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import {useEffect,useState,useSyncExternalStore} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AppShell} from './components/app-shell';
    import {RapidStart} from './components/rapid-start';
    import {RapidLocation} from './components/rapid-location';
    import {ShelfView} from './components/shelf-view';
    const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
    function Current(){
      const url=useSyncExternalStore(subscribe,()=>location.pathname+location.search);
      const [data,setData]=useState(null),[error,setError]=useState(''),[epoch,setEpoch]=useState(0);
      useEffect(()=>{window.__refresh=()=>setEpoch(v=>v+1);return()=>delete window.__refresh},[]);
      useEffect(()=>{let active=true;setError('');fetch('/data?path='+encodeURIComponent(url)).then(async r=>{if(!r.ok)throw new Error(await r.text());return r.json()}).then(value=>{if(!active)return;if(value.redirect){history.replaceState({},'',value.redirect);dispatchEvent(new PopStateEvent('popstate'));return}setData(value)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[url,epoch]);
      if(error)return <p role="alert">{error}</p>;if(!data||data.path!==url)return <p>Cargando…</p>;
      return data.kind==='start'?<RapidStart {...data.props}/>:data.kind==='shelf'?<ShelfView {...data.props}/>:<RapidLocation key={data.props.current.id} {...data.props}/>;
    }
    createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
  `},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'offline-only',setup(build){
    build.onResolve({filter:/^(next\/(link|navigation)|@\/lib\/supabase\/client|@\/components\/product-form|@\/app\/\(workspace\)\/(stock-actions|rapid-actions|box-code-actions))$/},args=>({path:args.path,namespace:'fake'}));
    build.onLoad({filter:/.*/,namespace:'fake'},args=>({resolveDir:root,contents:
      args.path==='next/link'?`import {createElement} from 'react';export default function Link({href,children,...props}){return createElement('a',{...props,href,onClick:e=>{e.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`
      :args.path==='next/navigation'?`import {useSyncExternalStore} from 'react';const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};export function useRouter(){return {push(path){history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},replace(path){history.replaceState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},refresh(){window.__refresh?.()}}}`
      :args.path.endsWith('/product-form')?`export function ProductForm(){return null}`
      :args.path.endsWith('/supabase/client')?`export function createSupabaseClient(){throw new Error('Production access disabled')}`
      :args.path.endsWith('/stock-actions')?`export async function submitStockOperation(input){const r=await fetch('/action',{method:'POST',body:JSON.stringify(input)});if(!r.ok)throw new Error('Synthetic action failure');return r.json()}`
      :args.path.endsWith('/box-code-actions')?`export async function renameBoxCode(){throw new Error('Use server fixture only for synthetic renames')}`
      :`export async function resolveRapidCode(code){const r=await fetch('/resolve',{method:'POST',body:JSON.stringify(code)});if(!r.ok)throw new Error('Synthetic lookup failure');return r.json()}`
    }));
  }}]});
  const css=(await Promise.all(['app/globals.css','app/theme.css','app/catalog.css','app/stock.css','app/rapid.css','app/shelves.css','components/tower-view.css'].map(file=>readFile(path.join(root,file),'utf8')))).join('\n').replace('@import "tailwindcss";','');
  let f=createShelfFixture();
  const server=createServer(async(req,res)=>{
    try{
      const target=new URL(req.url,'http://fixture.test');
      if(target.pathname==='/data'){
        const raw=target.searchParams.get('path'),url=new URL(raw,'http://fixture.test');let page,kind;
        if(url.pathname==='/carga'){page=await f.rapidStartPage();page=page.props.children[1];kind='start'}
        else if(url.pathname.startsWith('/estantes/')){page=await f.shelfPage({params:Promise.resolve({id:url.pathname.split('/')[2]}),searchParams:Promise.resolve({caja:url.searchParams.get('caja')??undefined})});kind='shelf'}
        else{page=url.pathname.startsWith('/carga/ubicacion/')?await f.rapidBoxPage({params:Promise.resolve({id:url.pathname.split('/')[3]})}):await f.rapidTowerPage({params:Promise.resolve({codigo:decodeURIComponent(url.pathname.split('/')[2])})});kind='location'}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:raw,kind,props:page.props}));
      }else if(target.pathname==='/action'||target.pathname==='/resolve'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString());
        const result=target.pathname==='/action'?await f.submitStockOperation(input):await f.resolveRapidCode(input);
        if(target.pathname==='/action'&&f.state.responseDelay)await new Promise(resolve=>setTimeout(resolve,f.state.responseDelay));
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
      }else if(target.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text)}
      else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`)}
    }catch(error){if(error.message.startsWith('REDIRECT:')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({redirect:error.message.slice(9)}))}else{res.statusCode=503;res.end(error.message)}}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();t.after(()=>browser.close());
  for(const width of [1280,360,390])for(const theme of ['light','dark'])await t.test(`${width}px ${theme}`,async()=>{
    f=createShelfFixture();const page=await browser.newPage({viewport:{width,height:850},hasTouch:width<400});page.setDefaultTimeout(7000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
    await page.addInitScript(()=>{localStorage.setItem('ingeagro-last-rapid-location','C264')});
    await page.goto(url+'/carga');await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.getByRole('link',{name:/Continuar desde C264/}).waitFor();
    await page.getByRole('group',{name:'Tipo de almacenamiento'}).getByRole('button',{name:'Estantes',exact:true}).click();
    await page.getByLabel('Estante',{exact:true}).selectOption('2');await page.getByLabel('Caja',{exact:true}).selectOption('2');
    assert.equal(await page.getByLabel('Caja',{exact:true}).locator('option').count(),4);
    await page.screenshot({path:path.join(directory,`inicio-${width}-${theme}.png`),fullPage:true});
    await page.getByRole('button',{name:'Ir a la caja'}).click();await page.getByRole('heading',{name:'A6',exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,'/carga/ubicacion/78');assert.match(await page.locator('.rapid-location-header').innerText(),/Estante 2 · Superior derecha/);
    assert.equal(await page.locator('.rapid-neighbors a').first().getAttribute('href'),'/carga/ubicacion/77');
    assert.equal(await page.locator('.rapid-neighbors a').last().getAttribute('href'),'/carga/ubicacion/79');
    assert.equal(f.state.writes.length,0);
    async function selectProduct(){await page.getByRole('button',{name:/Añadir (otro )?producto/,exact:true}).click();await page.getByRole('searchbox',{name:'Buscar producto existente'}).fill('Módulo');await page.locator('.rapid-select-list').getByRole('button',{name:/Módulo térmico/}).click()}
    await selectProduct();const quantity=page.getByLabel('Cantidad',{exact:true});
    await quantity.fill('0');await page.getByRole('button',{name:/Guardar entrada/}).click();await page.getByRole('alert').waitFor();assert.equal(f.state.writes.length,0);
    await quantity.fill('3');f.state.responseDelay=400;
    await page.locator('.rapid-step form').evaluate(form=>{form.requestSubmit();form.requestSubmit()});
    await page.getByRole('status').filter({hasText:'unidades registradas'}).waitFor();
    await page.locator('.rapid-product').filter({hasText:'Módulo térmico'}).waitFor();
    assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].destino_compartimiento_id,78);assert.equal(f.state.writes[0].producto_id,productId);assert.equal(f.state.writes[0].cantidad,3);
    f.state.responseDelay=0;
    await selectProduct();await quantity.fill('2');await page.getByRole('button',{name:/Guardar entrada/}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.rapid-product')].find(row=>row.textContent.includes('Módulo térmico'))?.querySelector(':scope > strong')?.textContent==='5');
    const adjust=page.locator('.rapid-product').filter({hasText:'Módulo térmico'}).getByRole('button',{name:'Ajustar',exact:true});await adjust.click();
    const dialog=page.locator('.stock-dialog[open]');await dialog.waitFor();assert.equal(await dialog.locator('#stock-quantity').inputValue(),'5');
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await adjust.evaluate(button=>document.activeElement===button),true);
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('ingeagro-last-rapid-location-v2')))).id,78);
    assert.equal(await page.evaluate(()=>localStorage.getItem('ingeagro-last-rapid-location')),'C264');
    assert.equal((await f.renameBoxCode({ubicacionId:78,codigoEsperado:'A6',codigoNuevo:'MOTORES'})).ok,true);
    await page.getByRole('link',{name:'Elegir otra ubicación'}).click();
    await page.getByRole('link',{name:/Continuar desde MOTORES/}).waitFor();
    await page.getByRole('link',{name:/Continuar desde MOTORES/}).click();await page.getByRole('heading',{name:'MOTORES',exact:true}).waitFor();
    await page.getByRole('link',{name:'Ver en estante'}).click();const detail=page.locator('.compartment-dialog[open]');await detail.waitFor();
    await detail.getByRole('link',{name:'Cargar aquí'}).click();await page.getByRole('heading',{name:'MOTORES',exact:true}).waitFor();
    await page.screenshot({path:path.join(directory,`caja-${width}-${theme}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('link',{name:'Elegir otra ubicación'}).click();await page.getByLabel('Código de ubicación').fill('a6');await page.getByRole('button',{name:'Ir al compartimiento'}).click();
    await page.getByRole('heading',{name:'MOTORES',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/carga/ubicacion/78');
    await page.getByRole('link',{name:'Elegir otra ubicación'}).click();await page.getByLabel('Código de ubicación').fill('A999');await page.getByRole('button',{name:'Ir al compartimiento'}).click();await page.getByRole('alert').filter({hasText:'No encontramos'}).waitFor();
    f.state.failTable='ubicacion_codigos';await page.getByLabel('Código de ubicación').fill('A6');await page.getByRole('button',{name:'Ir al compartimiento'}).click();await page.getByRole('alert').filter({hasText:'No pudimos consultar'}).waitFor();f.state.failTable=null;
    await page.evaluate(()=>localStorage.setItem('ingeagro-last-rapid-location-v2','broken'));await page.reload();await page.getByRole('link',{name:/Continuar desde C264/}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('ingeagro-last-rapid-location-v2')),'broken');
    await page.getByRole('link',{name:/Continuar desde C264/}).click();await page.getByRole('heading',{name:'C264',exact:true}).waitFor();
    assert.equal(await page.locator('.rapid-neighbors a').last().getAttribute('href'),'/carga/C251');
    assert.deepEqual(errors,[]);await page.close();
  });
  await t.test('recorrido de 24 cajas, errores de stock, datos vacíos y almacenamiento bloqueado',async()=>{
    f=createShelfFixture();const page=await browser.newPage({viewport:{width:390,height:850},hasTouch:true});page.setDefaultTimeout(7000);
    await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
    await page.goto(url+'/carga/ubicacion/73');
    for(let i=0;i<24;i++){
      await page.getByRole('heading',{name:i<12?`A${i+1}`:`B${i-11}`,exact:true}).waitFor();
      assert.equal(new URL(page.url()).pathname,`/carga/ubicacion/${73+i}`);
      if(i<23)await page.locator('.rapid-neighbors a').last().tap();
    }
    assert.equal(await page.locator('.rapid-neighbors a').count(),1);assert.equal(f.state.writes.length,0);
    await page.goto(url+'/carga/ubicacion/73');await page.getByRole('heading',{name:'A1',exact:true}).waitFor();
    f.state.entryError='23514';await page.getByRole('button',{name:'Añadir otro producto',exact:true}).click();await page.locator('.rapid-select-list').getByRole('button',{name:/Módulo térmico/}).click();await page.getByLabel('Cantidad',{exact:true}).fill('2');await page.getByRole('button',{name:/Guardar entrada/}).click();await page.getByRole('alert').filter({hasText:'stock suficiente'}).waitFor();
    assert.equal(f.state.tables.inventario.find(row=>row.compartimiento_id===73&&row.producto_id===productId).cantidad,7);
    await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('Disabled')};Storage.prototype.setItem=()=>{throw new Error('Disabled')}});
    await page.goto(url+'/carga');await page.getByRole('button',{name:'Ir al compartimiento'}).waitFor();assert.equal(await page.locator('.rapid-continue').count(),0);
    f.state.tables.compartimientos=[];await page.reload();await page.getByText('No hay compartimientos disponibles.').waitFor();assert.equal(await page.getByRole('button',{name:'Ir al compartimiento'}).isDisabled(),true);
    await page.getByRole('group',{name:'Tipo de almacenamiento'}).getByRole('button',{name:'Estantes',exact:true}).click();await page.getByText('No hay cajas disponibles.').waitFor();assert.equal(await page.getByRole('button',{name:'Ir a la caja'}).isDisabled(),true);
    await page.close();
  });
});
