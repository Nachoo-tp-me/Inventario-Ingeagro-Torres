// Prueba funcional focal del componente real; sin auditoría visual ni servicios reales.
// Node >=22; esbuild/Playwright externos y Chromium instalado.
// SHELVES_TEST_TOOLS=<tools>; node --test tests/rapid-product-search.browser.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const requireTools=createRequire(path.join(process.env.SHELVES_TEST_TOOLS??root,'package.json'));
const {build}=requireTools('esbuild'),{chromium}=requireTools('playwright');

test('carga rápida: filtro B3 real para cajas y torres, categorías, símbolos y límite de 50',async t=>{
  // Las coincidencias específicas quedan después de los primeros 50 productos.
  const products=[...Array.from({length:60},(_,i)=>({id:`sensor-${i}`,nombre:`Sensor ${String(i).padStart(2,'0')}`,categoria:'Prueba'})),
    {id:'modulo',nombre:'Módulo térmico',categoria:'Electrónica'},
    {id:'eje',nombre:'Eje',categoria:'Mecánica'},
    {id:'cpp',nombre:'C++',categoria:'Software'},
    {id:'csharp',nombre:'C#',categoria:'Software'}];
  const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import {createRoot} from 'react-dom/client';import {RapidLocation} from './components/rapid-location';
    const box={tipo:'caja',id:73,codigo:'A1',estante_id:1,posicion:1,ocupado:false,productos:[]};
    const tower={tipo:'compartimiento',id:48,codigo:'C264',torre_id:2,piso:6,posicion:4,ocupado:false,productos:[]};
    const current=location.search==='?torre'?tower:box;
    createRoot(document.getElementById('root')).render(<RapidLocation current={current} adjacent={{current,previous:null,next:null}} products={${JSON.stringify(products)}} categories={[]} compartments={[current]}/>);
  `},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'offline-only',setup(build){
    build.onResolve({filter:/^(next\/(link|navigation)|@\/components\/product-form|@\/app\/\(workspace\)\/stock-actions)$/},args=>({path:args.path,namespace:'fake'}));
    build.onLoad({filter:/.*/,namespace:'fake'},args=>({resolveDir:root,contents:
      args.path==='next/link'?'import {createElement} from "react";export default function Link(props){return createElement("a",props)}'
      :args.path==='next/navigation'?'export function useRouter(){return {refresh(){throw new Error("Unexpected refresh")}}}'
      :args.path.endsWith('/product-form')?'export function ProductForm(){throw new Error("Product creation disabled")}'
      :'export async function submitStockOperation(){throw new Error("Stock writes disabled")}'
    }));
  }}]});
  const server=createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text)}
    else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="es"><div id="root"></div><script src="/fixture.js"></script></html>')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();t.after(()=>browser.close());
  for(const kind of ['caja','torre'])await t.test(kind,async()=>{
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
    await page.goto(url+(kind==='torre'?'?torre':''));await page.getByRole('button',{name:'Añadir producto',exact:true}).click();
    const input=page.getByRole('searchbox',{name:'Buscar producto existente'});
    const names=page.locator('.rapid-select-list button strong');
    assert.equal(await names.count(),50);
    for(const [query,expected] of [['modulo termico','Módulo térmico'],['MÓDULO_TERMICO','Módulo térmico'],['MECANICA','Eje'],['electronica','Módulo térmico'],['C++','C++'],['C#','C#']]){
      await input.fill(query);await page.waitForFunction(expected=>{
        const names=[...document.querySelectorAll('.rapid-select-list button strong')];return names.length===1&&names[0].textContent===expected;
      },expected);
      assert.deepEqual(await names.allTextContents(),[expected]);
    }
    await input.fill('sensor');await page.waitForFunction(()=>document.querySelectorAll('.rapid-select-list button').length===50);
    assert.equal(await names.first().innerText(),'Sensor 00');assert.equal(await names.last().innerText(),'Sensor 49');
    assert.deepEqual(errors,[]);await page.close();
  });
});
