// Solo HTTP loopback y servicios simulados. Renderiza la página y componentes
// reales; la DAL real corre en el servidor del fixture, sin importar Supabase/.env.
// Node >=22; dependencias externas ya usadas por las pruebas de Estantes:
// npm install --prefix <tools> esbuild@0.28.2 playwright@1.64.0
// node <tools>/node_modules/playwright/cli.js install chromium
// SHELVES_TEST_TOOLS=<tools> node --test tests/history.browser.mjs
// Capturas y resumen en Temp, o HISTORY_ARTIFACTS=<carpeta externa>.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, requireTools } from './helpers/shelves-fixture.mjs';
import { createHistoryFixture } from './helpers/history-fixture.mjs';

const { build } = requireTools('esbuild');
const { chromium } = requireTools('playwright');
const fixture = `
  import {useEffect,useState,useSyncExternalStore} from 'react';
  import {createRoot} from 'react-dom/client';
  import {AppShell} from './components/app-shell';
  import HistoryPage from './app/(workspace)/historial/page';
  import HistoryError from './app/(workspace)/historial/error';
  const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
  function Current(){
    const url=useSyncExternalStore(subscribe,()=>location.pathname+location.search);
    const [data,setData]=useState(null),[failed,setFailed]=useState(false),[epoch,setEpoch]=useState(0);
    useEffect(()=>{let active=true;setFailed(false);
      HistoryPage({searchParams:Promise.resolve(Object.fromEntries(new URLSearchParams(location.search)))})
        .then(element=>{if(active)setData({url,element})}).catch(()=>{if(active)setFailed(true)});
      return()=>{active=false};
    },[url,epoch]);
    if(failed)return <HistoryError retry={()=>setEpoch(value=>value+1)}/>;
    return data?.url===url?data.element:<p>Cargando historial…</p>;
  }
  createRoot(document.getElementById('root')).render(<AppShell><Current/></AppShell>);
`;

test('Historial real: ubicaciones, instantáneas, enlaces, paginación y errores sin servicios productivos', async t => {
  const directory=process.env.HISTORY_ARTIFACTS??await mkdtemp(path.join(tmpdir(),'ingeagro-history-'));
  await mkdir(directory,{recursive:true});t.diagnostic(`Capturas sintéticas: ${directory}`);
  const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:fixture},bundle:true,write:false,jsx:'automatic',
    define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'offline-history-only',setup(build){
      build.onResolve({filter:/^(next\/(navigation|link)|@\/lib\/(supabase\/client|stock-data))$/},args=>({path:args.path,namespace:'fake'}));
      build.onLoad({filter:/.*/,namespace:'fake'},args=>({resolveDir:root,contents:
        args.path==='next/link'?`import {createElement} from 'react';export default function Link({href,children,...props}){
          return createElement('a',{...props,href,onClick:event=>{event.preventDefault();history.pushState({},'',href);dispatchEvent(new PopStateEvent('popstate'))}},children)}`
        :args.path==='next/navigation'?`import {useSyncExternalStore} from 'react';const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb)};
          export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};export function useRouter(){return {refresh(){},replace(){throw new Error('Unexpected navigation')}}}`
        :args.path.endsWith('/stock-data')?`export async function getHistory(page){const response=await fetch('/data?pagina='+page);if(!response.ok)throw new Error('Offline query failure');return response.json()}`
        :`export function createSupabaseClient(){throw new Error('Real authentication disabled')}` }));
    }}]});
  const css=(await Promise.all(['app/globals.css','components/tower-view.css','app/theme.css','app/catalog.css','app/stock.css','app/shelves.css']
    .map(file=>readFile(path.join(root,file),'utf8')))).join('\n').replace('@import "tailwindcss";','');
  let f=createHistoryFixture();const payloadSizes=[];
  const server=createServer(async(request,response)=>{
    try{const url=new URL(request.url,'http://127.0.0.1');
      if(url.pathname==='/data'){
        const data=await f.getHistory(Number(url.searchParams.get('pagina')));payloadSizes.push(data.entries.length);
        response.setHeader('Content-Type','application/json');response.end(JSON.stringify(data));
      }else if(url.pathname==='/fixture.js'){
        response.setHeader('Content-Type','application/javascript');response.end(bundle.outputFiles[0].text);
      }else{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`)}
    }catch{response.statusCode=503;response.end('Simulated query failure')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch();t.after(()=>browser.close());const results=[];
  for(const width of [1280,360,390])for(const theme of ['light','dark'])await t.test(`${width}px ${theme}`,async()=>{
    f=createHistoryFixture();const before=structuredClone(f.state.tables.movimientos);
    await f.renameBoxCode({ubicacionId:73,codigoEsperado:'A1',codigoNuevo:'MOTORES'});
    await f.renameBoxCode({ubicacionId:73,codigoEsperado:'MOTORES',codigoNuevo:'Z20'});
    const page=await browser.newPage({viewport:{width,height:850},hasTouch:width<400});page.setDefaultTimeout(7000);
    await page.addInitScript(theme=>{
      if(document.documentElement)document.documentElement.dataset.theme=theme;
      else addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.theme=theme,{once:true});
    },theme);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    await page.goto(base+'/historial');await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const cards=page.locator('.history-card');await cards.nth(12).waitFor();assert.equal(await cards.count(),13);
    const card=id=>page.locator('[data-movement-id="'+id+'"]');
    assert.match(await card(2).innerText(),/C111 → A1 \(actualmente Z20\)/);
    assert.equal(await card(2).getByRole('link',{name:'A1 (actualmente Z20)',exact:true}).getAttribute('href'),'/estantes/1?caja=73');
    assert.equal(await card(1).getByRole('link',{name:'C211',exact:true}).getAttribute('href'),'/torres/C2?compartimiento=C211');
    assert.match(await card(3).innerText(),/A1 \(actualmente Z20\) → C211/);
    assert.match(await card(4).innerText(),/A1 \(actualmente Z20\) → B12/);
    for(const [id,type,sign]of [[5,'Entrada','+5'],[6,'Retiro','−6'],[7,'Ajuste','+7'],[8,'Ajuste','−8'],[10,'Entrada','+10'],[11,'Retiro','−11'],[12,'Ajuste','+12'],[13,'Ajuste','−13']]){
      assert.equal(await card(id).locator('.history-type').textContent(),type);assert.ok((await card(id).innerText()).includes(sign));
    }
    assert.match(await card(9).innerText(),/C111 \(código actual; sin instantánea histórica\)/);
    assert.equal(await card(8).locator('time').getAttribute('datetime'),'2026-01-02T12:30:00.000Z');
    const contrast=await card(2).locator('.history-location-link').first().evaluate(element=>{
      const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
      const lum=color=>color.map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
        .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      let parent=element,background;
      do{background=getComputedStyle(parent).backgroundColor;parent=parent.parentElement}while(background==='rgba(0, 0, 0, 0)'&&parent);
      const color=getComputedStyle(element).color,a=lum(rgb(color)),b=lum(rgb(background));
      return {color,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
    assert.ok(contrast.ratio>=4.5,JSON.stringify(contrast));
    const link=card(2).getByRole('link',{name:'A1 (actualmente Z20)',exact:true});await link.focus();
    assert.equal(await link.evaluate(el=>document.activeElement===el),true);await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).pathname,'/estantes/1');assert.equal(new URL(page.url()).searchParams.get('caja'),'73');
    await page.goto(base+'/historial');await cards.nth(12).waitFor();await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.screenshot({path:path.join(directory,`historial-${width}-${theme}.png`),fullPage:true});
    // Etiquetas máximas, falta de metadata y signo negativo: sin rutas inventadas.
    await f.renameBoxCode({ubicacionId:73,codigoEsperado:'Z20',codigoNuevo:'W'.repeat(24)});
    await page.reload();await cards.nth(12).waitFor();
    assert.match(await card(2).innerText(),/actualmente W{24}/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Sin overflow con código de 24 caracteres');
    f.state.tables.compartimientos=[];await page.reload();await cards.nth(12).waitFor();
    assert.match(await card(8).innerText(),/−8.*A1 \(ubicación actual no disponible\)/);
    assert.equal(await card(8).getByRole('link').count(),0);
    assert.deepEqual(f.state.tables.movimientos,before);assert.equal(f.state.writes.length,0);
    // Paginación de la página real: nunca entrega más de 50 filas al navegador.
    f=createHistoryFixture();const template=f.state.tables.movimientos[0];
    f.state.tables.movimientos=Array.from({length:105},(_,i)=>({...template,id:i+1}));
    await page.goto(base+'/historial');await page.locator('[data-movement-id="105"]').waitFor();assert.equal(await cards.count(),50);
    await page.getByRole('link',{name:'Siguiente',exact:true}).click();await page.locator('[data-movement-id="55"]').waitFor();
    assert.equal(await cards.count(),50);assert.equal(new URL(page.url()).searchParams.get('pagina'),'2');
    await page.getByRole('link',{name:'Siguiente',exact:true}).click();await page.locator('[data-movement-id="5"]').waitFor();assert.equal(await cards.count(),5);
    assert.equal(await page.getByRole('link',{name:'Siguiente',exact:true}).count(),0);
    await page.getByRole('link',{name:'Anterior',exact:true}).click();await page.locator('[data-movement-id="55"]').waitFor();
    f.state.tables.movimientos=[];await page.goto(base+'/historial');await page.getByRole('heading',{name:'Aún no hay movimientos',exact:true}).waitFor();
    f.state.failTable='movimientos';await page.reload();await page.getByRole('alert').waitFor();assert.equal(await cards.count(),0);
    assert.match(await page.getByRole('alert').innerText(),/No se pudo cargar el historial/);
    f.state.failTable=null;const retried=page.waitForResponse(response=>response.url().includes('/data?')&&response.status()===200);
    await page.getByRole('button',{name:'Reintentar',exact:true}).click();await retried;await page.getByRole('heading',{name:'Aún no hay movimientos',exact:true}).waitFor();
    assert.deepEqual(errors,[]);results.push({width,theme,contrast,pass:true});await page.close();
  });
  assert.ok(payloadSizes.every(size=>size<=50));
  await writeFile(path.join(directory,'results.json'),JSON.stringify({results,maxPayload:Math.max(...payloadSizes)},null,2));
});
