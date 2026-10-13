// Offline visual/contrast regression using actual components and compiled CSS.
// External tools used: esbuild 0.28.2 and playwright 1.64.0, with Chromium installed.
// Install outside this repository: npm install --prefix <tools> esbuild@0.28.2 playwright@1.64.0
// Then run: node <tools>/node_modules/playwright/cli.js install chromium
// CONTRAST_TEST_TOOLS=<tools>; CONTRAST_ARTIFACTS=<output directory outside repo>.
// CONTRAST_PHASE=contrast (default): independent light-mode AA checks, no baseline.
// CONTRAST_PHASE=before: record baseline; after: require it and compare both themes.
// For before/after use the same artifacts directory and CONTRAST_BASE_REF=8286c39
// (default), or another valid Git commit reference. Run each phase with:
// node --test tests/light-contrast.browser.mjs
// PNG decoding uses Playwright's INTERNAL lib/utilsBundle.js API. Keep the tested
// tool versions above; a Playwright upgrade may require updating this import.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireRoot = createRequire(path.join(root, "package.json"));
const requireTools = createRequire(path.join(process.env.CONTRAST_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const { chromium } = requireTools("playwright");
const { PNG } = requireTools(path.join(path.dirname(requireTools.resolve("playwright-core/package.json")), "lib/utilsBundle.js"));
const phase = process.env.CONTRAST_PHASE ?? "contrast";
assert.ok(["contrast", "before", "after"].includes(phase), "CONTRAST_PHASE must be contrast, before or after.");
const baseRef = process.env.CONTRAST_BASE_REF ?? "8286c39";
const artifacts = process.env.CONTRAST_ARTIFACTS;
if (!artifacts) throw new Error("Set CONTRAST_ARTIFACTS to a directory outside the repository.");
async function loadBaseline() {
  if (phase === "contrast") return {};
  const baseRevision = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], {cwd: root, encoding: "utf8"}).trim();
  if (phase === "before") return {baseRevision};
  try {
    const baseline = JSON.parse(await readFile(path.join(artifacts, "before.json"), "utf8"));
    const metadata = JSON.parse(await readFile(path.join(artifacts, "before-revision.json"), "utf8"));
    assert.equal(metadata.baseRevision, baseRevision, "Baseline revision differs from CONTRAST_BASE_REF.");
    assert.ok(baseline && typeof baseline === "object" && !Array.isArray(baseline) && Object.keys(baseline).length, "Baseline must contain captures.");
    return {baseline, baseRevision};
  } catch (error) {
    throw new Error(`Before/after comparison requires a valid before.json and before-revision.json. Run CONTRAST_PHASE=before with the same CONTRAST_BASE_REF first: ${error.message}`, {cause: error});
  }
}
const cssFiles = ["app/globals.css", "components/tower-view.css", "app/theme.css", "app/catalog.css", "app/stock.css", "app/rapid.css", "app/exports.css"];
const fixture = `
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/app-shell";
import { PageHeading, Metrics, TowerGrid } from "./components/dashboard";
import { GlobalSearch } from "./components/global-search";
import { ProductCatalogList } from "./components/product-catalog-list";
import { ProductForm } from "./components/product-form";
import { TowerView } from "./components/tower-view";
import { LoginForm } from "./components/login-form";
import { ThemeToggle } from "./components/theme-toggle";
const product = {id:"fake-product", nombre:"Módulo térmico", categoria_id:"fake-category", categoria:"Electrónica", descripcion:"Descripción de prueba y notas del producto.", fotoUrl:null, foto_ruta:null, stock:23, ubicaciones:1};
const locations = [2,1].flatMap(piso => [1,2,3,4].map(posicion => ({id:piso*10+posicion,codigo:"C1"+piso+posicion,torre_id:1,piso,posicion,ocupado:posicion%2===1,productos:posicion%2===1?[{...product,cantidad:23}]:[]})));
const tower = {id:1,codigo:"C1",total:8,ocupados:4,disponibles:4,pisos:[2,1].map(numero=>({numero,compartimientos:locations.filter(p=>p.piso===numero)}))};
const heading = <PageHeading eyebrow="PANEL GENERAL" title="Inventario Ingeagro" description="Una vista clara de lo que hay y dónde se encuentra."/>;
function Home() { return <div className="page-stack">{heading}
  <div className="hero-panel"><div className="hero-copy"><span className="hero-badge">CONTROL DE INVENTARIO</span><h2>Todo el espacio,<br/>de un vistazo.</h2><p>Consulta el estado de tus torres y compartimientos en tiempo real.</p></div></div>
  <GlobalSearch/><Metrics data={{total:8,ocupados:4,disponibles:4,productos:1}}/>
  <section className="tower-section"><div className="section-heading"><div><p className="eyebrow">UBICACIONES</p><h2>Torres de almacenamiento</h2><p>Estado actual de los compartimientos físicos.</p></div><a className="text-link" href="/torres/C1">Ver torres</a></div><TowerGrid towers={[{...tower}]}/></section>
  <div className="empty-state"><h3>Sin movimientos recientes</h3><p>Las operaciones se mostrarán aquí.</p></div>
</div>; }
const route = location.pathname;
const content = route === "/productos/nuevo" ? <div className="page-stack"><PageHeading eyebrow="CATÁLOGO" title="Nuevo producto" description="Registra un producto para tu inventario."/><ProductForm initialCategories={[{id:"fake-category",nombre:"Electrónica"}]}/></div>
 : route === "/productos" ? <div className="page-stack"><PageHeading eyebrow="CATÁLOGO" title="Productos" description="Productos registrados y sus existencias actuales."/><ProductCatalogList products={[product]}/></div>
 : route === "/torres/C1" ? <TowerView tower={tower} compartments={locations} products={[product]}/>
 : <Home/>;
const login = <main className="login-page"><div className="login-side"><div className="login-side-inner"><div className="login-brand"><strong>INGEAGRO</strong><small>INVENTARIO</small></div><div className="login-side-copy"><h1>El inventario,<br/>bajo control.</h1><p>Localiza productos y gestiona las existencias de tus torres.</p></div><p className="login-side-footer">INVENTARIO INGEAGRO</p></div></div><div className="login-form-side"><div className="login-theme-control"><ThemeToggle/></div><div className="login-card"><p className="eyebrow">ACCESO AL INVENTARIO</p><h2>Bienvenido</h2><p className="login-intro">Accede con la cuenta compartida de Ingeagro.</p><LoginForm/><div className="login-card-foot">Acceso exclusivo al equipo de Ingeagro</div></div></div></main>;
document.addEventListener("submit", event=>{event.preventDefault();event.stopImmediatePropagation();window.__unexpectedSubmissions++;},true);
createRoot(document.getElementById("root")).render(route==="/login" ? login : <AppShell>{content}</AppShell>);
`;

// Browser-side collection: actual computed foregrounds, placeholder styles,
// direct text ranges, ancestor opacity/filters and occlusion by modal/nav layers.
function collectText() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = color => { ctx.clearRect(0,0,1,1); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
  const modal = [...document.querySelectorAll("dialog:modal")].at(-1);
  const samples = [];
  for (const element of document.querySelectorAll("body *")) {
    if (element.closest("svg,script,style,[aria-hidden='true']") || element.closest(":disabled") || (modal && !modal.contains(element))) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== "visible" || style.display === "none") continue;
    let opacity = 1, brightness = 1;
    for (let parent = element; parent; parent=parent.parentElement) {
      const parentStyle=getComputedStyle(parent); opacity *= Number(parentStyle.opacity);
      for (const match of parentStyle.filter.matchAll(/brightness\(([\d.]+)\)/g)) brightness *= Number(match[1]);
    }
    if (opacity < 0.99) continue;
    const entries = [...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE && node.textContent.trim()).map(node=>{
      const range=document.createRange();range.selectNodeContents(node);
      return { text:node.textContent.trim(), rects:[...range.getClientRects()], color:style.color, fontSize:style.fontSize, fontWeight:style.fontWeight };
    });
    if (element.matches("input[placeholder],textarea[placeholder]") && !element.value) {
      const placeholder=getComputedStyle(element,"::placeholder"), rect=element.getBoundingClientRect();
      entries.push({text:element.getAttribute("placeholder"), rects:[{x:rect.x+parseFloat(style.paddingLeft)+3,y:rect.y+rect.height/2-5,width:Math.max(5,rect.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-6),height:10}],color:placeholder.color,fontSize:placeholder.fontSize,fontWeight:placeholder.fontWeight,placeholder:true});
    }
    for (const entry of entries) for (const rect of entry.rects) {
      const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
      if (rect.width<=0 || rect.height<=0 || x<0 || x>=innerWidth || y<0 || y>=innerHeight) continue;
      const hit=document.elementFromPoint(x,y);
      if (hit && !element.contains(hit) && !hit.contains(element)) continue;
      const fg=rgba(entry.color); for(let i=0;i<3;i++)fg[i]=Math.min(255,fg[i]*brightness);
      const points=[];
      for(const fx of [0.15,0.5,0.85])for(const fy of [0.25,0.5,0.75]){
        const px=Math.floor(rect.x+rect.width*fx),py=Math.floor(rect.y+rect.height*fy);
        if(px<0||px>=innerWidth||py<0||py>=innerHeight)continue;
        const target=document.elementFromPoint(px,py);
        if(target&&(element.contains(target)||target.contains(element)))points.push([px,py]);
      }
      if(!points.length)continue;
      samples.push({selector:element.tagName.toLowerCase()+"."+[...element.classList].join("."),text:entry.text,placeholder:!!entry.placeholder,color:entry.color,fg,fontSize:parseFloat(entry.fontSize),fontWeight:Number(entry.fontWeight),points,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});
    }
  }
  return samples;
}

const luminance = rgb => rgb.slice(0,3).map(c=>{const s=c/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);

test("B4: contraste computado, fondos efectivos y comparación visual de ambos temas", async (t) => {
  const {baseline, baseRevision} = await loadBaseline();
  await mkdir(path.join(artifacts,phase),{recursive:true});
  const postcss = requireRoot("postcss");
  const tailwind = requireRoot("@tailwindcss/postcss");
  // Obtain the approved baseline without reverting or editing working files.
  const readStyle = file=>phase==="before"?Promise.resolve(execFileSync("git",["show",`${baseRevision}:${file}`],{cwd:root,encoding:"utf8"})):readFile(path.join(root,file),"utf8");
  const globals = await postcss([tailwind({base:root})]).process(await readStyle(cssFiles[0]),{from:path.join(root,cssFiles[0])});
  const css = [globals.css,...await Promise.all(cssFiles.slice(1).map(readStyle))].join("\n");
  const bundle = await build({stdin:{contents:fixture,resolveDir:root,loader:"tsx"},bundle:true,write:false,jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},plugins:[{name:"offline-only",setup(build){
    build.onResolve({filter:/^(next\/link|next\/navigation|@\/lib\/supabase\/client|@\/app\/\(workspace\)\/(stock-actions|search-actions))$/},args=>({path:args.path,namespace:"stub"}));
    build.onLoad({filter:/.*/,namespace:"stub"},args=>({resolveDir:root,contents:args.path==="next/link"?'import {createElement} from "react";export default function Link(props){return createElement("a",props);}'
      :args.path==="next/navigation"?'export function usePathname(){return location.pathname;}export function useRouter(){return {refresh(){throw new Error("Unexpected refresh");},push(url){location.href=url;},replace(url){location.href=url;}};}'
      :args.path.includes("search-actions")?'export async function searchInventory(){return {products:[],location:null,locationAttempt:false};}'
      :'export function createSupabaseClient(){throw new Error("Production access disabled");}export async function submitStockOperation(){throw new Error("Stock submission disabled");}' }));
  }}]});
  const server=createServer((req,res)=>{
    if(req.url==="/fixture.js"){res.setHeader("Content-Type","application/javascript");res.end(bundle.outputFiles[0].text);}
    else if(req.url==="/styles.css"){res.setHeader("Content-Type","text/css");res.end(css);}
    else{res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><div id="root"></div><script>window.__unexpectedSubmissions=0;</script><script src="/fixture.js"></script></body></html>');}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch();t.after(()=>browser.close());
  const report={};
  async function capture(page,key,theme,keepPointer=false) {
    if(!keepPointer)await page.mouse.move(0,0);
    // Finish transitions before reading foregrounds; do not sample intermediate colors.
    const screenshot=await page.screenshot({animations:"disabled"});
    const geometry=await page.evaluate(()=>[...document.querySelectorAll("body *")].filter(e=>e.getClientRects().length && !e.closest("svg,script,style")).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,cls:e.className,x:r.x,y:r.y,w:r.width,h:r.height,font:s.font,fontSize:s.fontSize,animation:s.animation,transition:s.transition};}));
    const visible=await page.evaluate(collectText);
    await writeFile(path.join(artifacts,phase,key+".png"),screenshot);
    // Rasterize the real backgrounds with only text hidden: resolves transparent
    // ancestors, gradients, shadows and filters without guessing CSS background colors.
    const hidden=await page.addStyleTag({content:'body * {transition:none!important;animation:none!important;color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important;}input::placeholder,textarea::placeholder {color:transparent!important;}svg{visibility:hidden!important;}'});
    const background=PNG.sync.read(await page.screenshot({animations:"disabled"}));
    await hidden.evaluate(async e=>{
      e.textContent='body * {transition:none!important;animation:none!important;}';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      e.remove();
    });
    const measurements=visible.map(sample=>{
      let minimum=Infinity,backgroundRgb;
      // Each point was hit-tested before hiding text; do not sample backgrounds
      // belonging to a fixed nav/other overlay covering part of a text range.
      for(const [x,y] of sample.points){
        const bg=[...background.data.subarray((y*background.width+x)*4,(y*background.width+x)*4+3)];
        const alpha=sample.fg[3]/255;
        const fg=sample.fg.slice(0,3).map((c,i)=>c*alpha+bg[i]*(1-alpha));
        const ratio=contrast(fg,bg);
        if(ratio<minimum){minimum=ratio;backgroundRgb=bg;}
      }
      return {...sample,background:backgroundRgb,ratio:minimum,required:sample.fontSize>=24||(sample.fontSize>=18.6667&&sample.fontWeight>=700)?3:4.5};
    });
    const operational=await page.locator(".compartment-button,.top-view-sector,.occupancy-track span,.availability-dot,.account-dot,.metric-card.red .metric-icon,.metric-card.green .metric-icon,.sheet-status").evaluateAll(elements=>elements.map(e=>{const s=getComputedStyle(e);return {cls:e.className,color:s.color,background:s.background,border:s.border};}));
    report[key]={theme,measurements,geometry,operational,sha256:createHash("sha256").update(screenshot).digest("hex")};
    if(phase!=="before") {
      if(theme==="light")assert.deepEqual(measurements.filter(m=>m.ratio<m.required).map(m=>({text:m.text,selector:m.selector,ratio:m.ratio})),[],key);
      if(phase==="after"){
        assert.ok(baseline[key], `${key}: baseline capture missing`);
        assert.deepEqual(geometry,baseline[key].geometry,`${key}: layout/fonts/animations changed`);
        // Empty status dots paint background only; inherited color and a zero-width
        // border are not rendered. Controls and icons also paint their foreground.
        const painted=items=>items.map(item=>({cls:item.cls,background:item.background,
          ...(item.cls.includes("compartment-button")||item.cls.includes("top-view-sector")||item.cls.includes("metric-icon")||item.cls.includes("sheet-status")?{color:item.color,border:item.border}:{})}));
        assert.deepEqual(painted(operational),painted(baseline[key].operational),`${key}: operational states changed`);
        if(theme==="dark") {
          assert.deepEqual(measurements.map(m=>[m.selector,m.text,m.color]),baseline[key].measurements.map(m=>[m.selector,m.text,m.color]),`${key}: dark foregrounds changed`);
          const before=PNG.sync.read(await readFile(path.join(artifacts,"before",key+".png")));
          const after=PNG.sync.read(screenshot);
          let changedPixels=0,maxChannelDelta=0;
          for(let i=0;i<before.data.length;i+=4){
            let changed=false;
            for(let c=0;c<3;c++){const difference=Math.abs(before.data[i+c]-after.data[i+c]);maxChannelDelta=Math.max(maxChannelDelta,difference);changed ||= difference>0;}
            if(changed)changedPixels++;
          }
          report[key].pixelComparison={changedPixels,maxChannelDelta};
          // Chromium can vary a few glyph edge pixels by one RGB unit. All
          // computed foregrounds, geometry and operational paints must be exact.
          assert.ok(maxChannelDelta<=1,`${key}: dark pixels changed (${changedPixels} pixels, delta ${maxChannelDelta})`);
        }
      }
    }
  }
  // Keep collecting on failure so the report identifies every affected surface.
  const failures=[];
  for(const theme of ["light","dark"])for(const width of [1280,360,390]) {
    const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(5000);
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(theme=>{document.addEventListener("DOMContentLoaded",()=>document.documentElement.dataset.theme=theme);},theme);
    await page.route("**/*",route=>route.request().url().startsWith(url)?route.continue():route.abort());
    const shot=async (name,keepPointer=false)=>{try{await capture(page,`${theme}-${width}-${name}`,theme,keepPointer);}catch(error){failures.push(error.message);}};
    for(const [route,name] of [["/","home"],["/productos","catalog"],["/productos/nuevo","form"],["/login","login"],["/torres/C1","tower"]]) {
      await page.goto(url+route);await page.locator("#root > *").waitFor();
      await shot(name);
      if(route==="/"&&width<400){
        await page.locator(".mobile-navigation").getByRole("link",{name:"Torres",exact:true}).hover();await shot("navigation-hover",true);
        await page.mouse.move(0,0);await page.locator(".mobile-navigation").getByRole("link",{name:"Torres",exact:true}).focus();await shot("navigation-focus");
      }
      if(route==="/productos"){
        await page.locator(".catalog-card").hover();await shot("catalog-hover",true);
      }
      await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await shot(name+"-bottom");
      if(route==="/productos/nuevo"){
        await page.locator("#product-name").fill("Producto ficticio");
        await page.locator("#product-category").selectOption("fake-category");
        assert.equal(await page.locator("#product-name").inputValue(),"Producto ficticio");
        await page.locator("#product-category").selectOption("__new__");
        await page.getByRole("button",{name:"Cancelar",exact:true}).hover();await shot("category-hover",true);
      }
      if(route==="/torres/C1"){
        await page.locator(".compartment-button").filter({hasText:"C121"}).click();
        await page.locator(".compartment-dialog[open]").waitFor();await shot("compartment");
        await page.locator(".compartment-dialog[open]").getByRole("button",{name:"Acciones",exact:true}).click();
        await page.locator(".stock-action-options:popover-open").waitFor();await shot("menu");
        await page.getByRole("button",{name:"Ajustar",exact:true}).click();
        await page.locator(".stock-dialog[open]").waitFor();await shot("stock");
        assert.equal(await page.locator("#stock-quantity").inputValue(),"23");
        await page.keyboard.press("Escape");await page.locator(".stock-dialog[open]").waitFor({state:"hidden"});
        await page.keyboard.press("Escape");await page.locator(".compartment-dialog[open]").waitFor({state:"hidden"});
        await page.locator(".compartment-button").filter({hasText:"C122"}).click();await shot("empty-compartment");
        await page.keyboard.press("Escape");
      }
      if(route==="/" && width<400){await page.locator(".mobile-navigation").getByRole("link",{name:"Productos",exact:true}).click();await page.waitForURL(url+"/productos");}
    }
    assert.equal(await page.evaluate(()=>window.__unexpectedSubmissions),0);assert.deepEqual(errors,[]);
    await page.getByRole("button",{name:"Cambiar entre modo claro y modo oscuro"}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme==="dark"?"light":"dark");
    await page.close();
  }
  await writeFile(path.join(artifacts,phase+".json"),JSON.stringify(report,null,2));
  const bad=Object.entries(report).flatMap(([key,r])=>r.theme==="light"?r.measurements.filter(m=>m.ratio<m.required).map(m=>({key,selector:m.selector,text:m.text,foreground:m.color,background:m.background,ratio:+m.ratio.toFixed(3)})):[]);
  await writeFile(path.join(artifacts,phase+"-failures.json"),JSON.stringify(bad,null,2));
  t.diagnostic(`${Object.keys(report).length} screenshots; ${bad.length} light contrast failures; artifacts: ${artifacts}`);
  assert.deepEqual(failures,[]);
  if(phase==="before")await writeFile(path.join(artifacts,"before-revision.json"),JSON.stringify({baseRevision},null,2));
});
