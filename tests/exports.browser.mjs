// Solo loopback, datos ficticios y acción real con Supabase simulado. No lee .env.
// Node >=22; SHELVES_TEST_TOOLS=<herramientas externas existentes>.
// Herramientas: esbuild@0.28.2, playwright@1.64.0 y Chromium instalado.
// node --test tests/exports.browser.mjs
// EXPORTS_ARTIFACTS=<carpeta externa opcional>. EXPORTS_BASE_REF=04602c9e por defecto:
// referencia histórica explícita para comparar las torres incluso tras el commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {unzipSync} from 'fflate'; // Ya forma parte de write-excel-file.
import {createShelfFixture,root,requireTools} from './helpers/shelves-fixture.mjs';
import {buildExportSnapshot,inventoryCsv,inventoryWorkbookData} from '../lib/export-model.ts';

const {build}=requireTools('esbuild'),{chromium}=requireTools('playwright');
test('descargas reales CSV/XLSX/PNG: 96 ubicaciones, mapa físico y regresión de torres',async t=>{
  const directory=process.env.EXPORTS_ARTIFACTS??await mkdtemp(path.join(tmpdir(),'ingeagro-exports-'));
  await mkdir(directory,{recursive:true});t.diagnostic(`Archivos sintéticos: ${directory}`);
  const baseRef=process.env.EXPORTS_BASE_REF??'04602c9e';
  const beforeSource=execFileSync('git',['show',`${baseRef}:lib/export-files.ts`],{cwd:root,encoding:'utf8',windowsHide:true});
  const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import {createRoot} from 'react-dom/client';
    import {AppShell} from './components/app-shell';
    import ExportsPage from './app/(workspace)/exportaciones/page';
    import {downloadTowerPng as before} from 'before-map';
    import {createInventoryMapCanvas} from './lib/export-files';
    window.__before=before;
    window.__draw=createInventoryMapCanvas;
    const text=CanvasRenderingContext2D.prototype.fillText,rect=CanvasRenderingContext2D.prototype.fillRect;
    window.__trace=[];
    CanvasRenderingContext2D.prototype.fillText=function(value,x,y,...rest){window.__trace.push({kind:'text',value,x,y,width:this.measureText(value).width,font:this.font,align:this.textAlign,color:this.fillStyle});return text.call(this,value,x,y,...rest)};
    CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){window.__trace.push({kind:'rect',x,y,w,h,color:this.fillStyle});return rect.call(this,x,y,w,h)};
    createRoot(document.getElementById('root')).render(<AppShell><ExportsPage/></AppShell>);
  `},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'offline-exports',setup(build){
    build.onResolve({filter:/^(before-map|next\/(link|navigation)|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/export-actions)$/},args=>({path:args.path,namespace:'fake'}));
    build.onLoad({filter:/.*/,namespace:'fake'},args=>({resolveDir:root,loader:'ts',contents:
      args.path==='before-map'?beforeSource
      :args.path==='next/link'?`import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`
      :args.path==='next/navigation'?`export function usePathname(){return '/exportaciones'}export function useRouter(){return {refresh(){},replace(){throw new Error('Unexpected navigation')}}}`
      :args.path.endsWith('/export-actions')?`export async function getExportSnapshot(){const response=await fetch('/snapshot');if(!response.ok)throw new Error('Offline query failure');return response.json()}`
      :`export function createSupabaseClient(){throw new Error('Real authentication disabled')}` }));
  }}]});
  const css=(await Promise.all(['app/globals.css','app/theme.css','app/catalog.css','app/stock.css','app/exports.css']
    .map(file=>readFile(path.join(root,file),'utf8')))).join('\n').replace('@import "tailwindcss";','');
  const f=createShelfFixture();f.state.maxRows=7;
  f.state.tables.productos.push({id:'empty',nombre:'Sin stock Ω',descripcion:'½',categoria_id:'cat01'},
    {id:'formula',nombre:'=SUM(1+1)',descripcion:'C++ C# ñ "sí"\nsegunda línea',categoria_id:'cat01'});
  await f.renameBoxCode({ubicacionId:73,codigoEsperado:'A1',codigoNuevo:'W'.repeat(24)});
  await f.renameBoxCode({ubicacionId:96,codigoEsperado:'B12',codigoNuevo:'MOTORES_1'});
  const expected=await f.getExportSnapshot(),unchanged=structuredClone(f.state.tables);
  const files=new Map();let requests=0;
  const server=createServer(async(request,response)=>{
    try{const url=new URL(request.url,'http://127.0.0.1');
      if(url.pathname==='/snapshot'){requests++;const data=await f.getExportSnapshot();response.setHeader('Content-Type','application/json');response.end(JSON.stringify(data))}
      else if(url.pathname==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle.outputFiles[0].text)}
      else if(files.has(url.pathname)){response.setHeader('Content-Type','image/png');response.end(await readFile(files.get(url.pathname)))}
      else{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`)}
    }catch{response.statusCode=503;response.end('Synthetic query failure')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:850}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(base)||route.request().url().startsWith('blob:')?route.continue():route.abort());
  await page.goto(base+'/exportaciones');await page.getByRole('button',{name:'Exportar CSV',exact:true}).waitFor();
  for(const [format,label]of [['csv','CSV'],['xlsx','Excel'],['png','Mapa PNG']]){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:`Exportar ${label}`,exact:true}).click();
    const download=await pending;assert.match(download.suggestedFilename(),new RegExp(`^inventario-ingeagro-\\d{4}-\\d{2}-\\d{2}\\.${format}$`));
    await download.saveAs(path.join(directory,`inventario.${format}`));await page.getByRole('button',{name:'Exportar CSV',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('.export-card button').disabled);
  }
  assert.equal(await readFile(path.join(directory,'inventario.csv'),'utf8'),inventoryCsv(expected));
  const zip=unzipSync(await readFile(path.join(directory,'inventario.xlsx')));
  const sheet=Buffer.from(zip['xl/worksheets/sheet1.xml']).toString('utf8'),strings=Buffer.from(zip['xl/sharedStrings.xml']).toString('utf8');
  assert.doesNotMatch(sheet,/<f[\s>]/);
  const actualRows=await page.evaluate(({sheet,strings})=>{
    const parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
    const texts=[...parse(strings).querySelectorAll('si')].map(si=>si.textContent);
    return [...parse(sheet).querySelectorAll('row')].map(row=>{
      const values=Array(11).fill('');for(const c of row.querySelectorAll('c')){
        const col=c.getAttribute('r').match(/^[A-Z]+/)[0];let index=0;for(const char of col)index=index*26+char.charCodeAt(0)-64;
        const raw=c.querySelector('v')?.textContent??'';values[index-1]=c.getAttribute('t')==='s'?texts[Number(raw)]:Number(raw);
      }return values;
    });
  },{sheet,strings});
  assert.deepEqual(actualRows,JSON.parse(JSON.stringify(inventoryWorkbookData(expected)[0].data)));
  const trace=await page.evaluate(()=>window.__trace);
  const towerTiles=trace.filter(r=>r.kind==='rect'&&r.w===117&&r.h===76),boxTiles=trace.filter(r=>r.kind==='rect'&&r.w===290&&r.h===155);
  assert.equal(towerTiles.length,72);assert.equal(boxTiles.length,24);
  const boxes=expected.estantes.flatMap(shelf=>shelf.cajas);
  for(const [index,tile]of boxTiles.entries()){
    const lines=trace.filter(r=>r.kind==='text'&&r.align==='center'&&r.x===tile.x+145&&r.y>=tile.y+34&&r.y<=tile.y+98);
    assert.equal(lines.map(line=>line.value).join(''),boxes[index].codigo);
    assert.ok(lines.every(line=>line.width<=262&&Number.parseFloat(line.font.match(/([\d.]+)px/)[1])>=16));
    assert.equal(tile.color,boxes[index].ocupado?'#c1434f':'#13795b');
  }
  for(let index=0;index<24;index+=4){const cells=boxTiles.slice(index,index+4);
    assert.equal(cells[0].y,cells[1].y);assert.equal(cells[2].y,cells[3].y);
    assert.ok(cells[0].x<cells[1].x&&cells[0].y<cells[2].y);
  }
  for(const label of ['Estantes · Grupo A','Estantes · Grupo B',...expected.estantes.map(s=>s.nombre)])assert.ok(trace.some(r=>r.value===label));
  files.set('/new.png',path.join(directory,'inventario.png'));
  const oldPending=page.waitForEvent('download');await page.evaluate(snapshot=>window.__before(snapshot),expected);
  await (await oldPending).saveAs(path.join(directory,'torres-base.png'));files.set('/old.png',path.join(directory,'torres-base.png'));
  const pixels=await page.evaluate(async()=>{
    const images=await Promise.all(['/old.png','/new.png'].map(async url=>createImageBitmap(await(await fetch(url)).blob())));
    const arrays=images.map(image=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,205,image.width,845).data});
    let differences=0;for(let i=0;i<arrays[0].length;i++)if(arrays[0][i]!==arrays[1][i])differences++;
    return {differences,width:images[1].width,height:images[1].height};
  });
  assert.equal(pixels.differences,0,'Sección de torres idéntica píxel a píxel a la revisión base');
  const empty=buildExportSnapshot([],[],[],[],expected.generadoEn);
  const edgeMaps=await page.evaluate(({empty,expected})=>{
    const emptyCanvas=window.__draw(empty);
    window.__trace=[];const onlyBoxes=window.__draw({...expected,torres:[]});
    const noTowers=window.__trace.find(r=>r.value==='No hay torres registradas');
    const groupA=window.__trace.find(r=>r.value==='Estantes · Grupo A');
    const boxCount=window.__trace.filter(r=>r.kind==='rect'&&r.w===290&&r.h===155).length;
    const onlyTowers=window.__draw({...expected,estantes:[]});
    return {emptyHeight:emptyCanvas.height,boxCount,boxesHeight:onlyBoxes.height,towersHeight:onlyTowers.height,noTowersY:noTowers.y,groupAY:groupA.y};
  },{empty,expected});
  assert.equal(edgeMaps.emptyHeight,1120);assert.equal(edgeMaps.towersHeight,1120);assert.equal(edgeMaps.boxCount,24);
  assert.ok(edgeMaps.noTowersY+40<edgeMaps.groupAY,'Estado sin torres no se superpone al grupo de estantes');
  await page.screenshot({path:path.join(directory,'exportaciones-1280-light.png'),fullPage:true});
  await page.setViewportSize({width:360,height:850});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(directory,'exportaciones-360-dark.png'),fullPage:true});
  let unexpectedDownloads=0;page.on('download',()=>unexpectedDownloads++);
  f.state.failTable='inventario';await page.getByRole('button',{name:'Exportar CSV',exact:true}).click();await page.getByRole('alert').waitFor();
  assert.equal(unexpectedDownloads,0);assert.equal(requests,4);
  f.state.failTable=null;
  await page.evaluate(()=>{HTMLCanvasElement.prototype.getContext=()=>null});
  await page.getByRole('button',{name:'Exportar Mapa PNG',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.export-card button').disabled);
  await page.getByRole('alert').waitFor();assert.equal(unexpectedDownloads,0);assert.equal(requests,5);
  assert.equal(f.state.writes.length,0);assert.deepEqual(f.state.tables,unchanged);assert.deepEqual(errors,[]);
  await writeFile(path.join(directory,'results.json'),JSON.stringify({baseRef,pixels,rows:actualRows.length-1,summary:expected.resumen,boxTiles:24,towerTiles:72,pass:true},null,2));
});
