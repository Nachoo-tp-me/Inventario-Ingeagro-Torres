// Servicios en memoria para código real del Bloque 3. No importa clientes reales
// de Supabase ni lee .env. El motor SQL se prueba por separado en PostgreSQL.
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const requireTools = createRequire(path.join(process.env.SHELVES_TEST_TOOLS ?? root, "package.json"));
const { build } = requireTools("esbuild");
const bundle = await build({
  stdin: { resolveDir: root, contents: `export * from './lib/shelf-data'; export * from './lib/inventory';
    export * from './app/(workspace)/stock-actions';
    export {default as shelfPage} from './app/(workspace)/estantes/[id]/page';
    export {default as shelvesPage} from './app/(workspace)/estantes/page';` },
  bundle: true, write: false, platform: "node", format: "iife", globalName: "shelves", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "offline-services-only", setup(build) {
    build.onResolve({ filter: /^(next\/(cache|navigation)|@\/lib\/(auth|product-catalog)|@\/components\/(shelf-overview|shelf-view))$/ }, args => ({ path: args.path, namespace: "fake" }));
    build.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents:
      args.path.endsWith('/auth') ? `export async function requireAuthorizedUser(){const state=globalThis.__fixture;
        state.authorizations++;if(state.denied)throw new Error('No autorizado');return state.client;}`
      : args.path.endsWith('/product-catalog') ? `export async function getSignedProductImages(paths){globalThis.__fixture.images.push(paths);
        return new Map(paths.filter(Boolean).map(path=>[path,'https://images.test/'+path]));}`
      : args.path === 'next/cache' ? 'export function revalidatePath(path){globalThis.__fixture.paths.push(path)}'
      : args.path === 'next/navigation' ? "export function notFound(){throw new Error('NOT_FOUND')}"
      : args.path.endsWith('/shelf-view') ? 'export function ShelfView(){return null}' : 'export function ShelfOverview(){return null}' }));
  } }],
});

export const productId = "00000000-0000-0000-0000-000000000501";
export const secondProductId = "00000000-0000-0000-0000-000000000502";

export function createShelfFixture() {
  const state = { authorizations: 0, denied: false, failTable: null, queries: [], writes: [], rpcs: [], paths: [], images: [],
    tables: {
      estantes: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, nombre: `Estante ${i + 1}`, grupo: i < 3 ? "A" : "B" })),
      torres: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, codigo: `C${i + 1}` })),
      compartimientos: [
        ...Array.from({ length: 72 }, (_, i) => ({ id: i + 1, tipo: "compartimiento", codigo: `C${Math.floor(i / 24) + 1}${Math.floor(i % 24 / 4) + 1}${i % 4 + 1}`,
          torre_id: Math.floor(i / 24) + 1, piso: Math.floor(i % 24 / 4) + 1, posicion: i % 4 + 1, estante_id: null })),
        ...Array.from({ length: 24 }, (_, i) => ({ id: i + 73, tipo: "caja", codigo: `${i < 12 ? 'A' : 'B'}${i % 12 + 1}`,
          torre_id: null, piso: null, posicion: i % 4 + 1, estante_id: Math.floor(i / 4) + 1 })),
      ],
      categorias: [{ id: "cat01", nombre: "Electrónica" }],
      productos: [
        { id: productId, nombre: "Módulo térmico", categoria_id: "cat01", foto_ruta: null },
        { id: secondProductId, nombre: "ESP32-S3", categoria_id: "cat01", foto_ruta: null },
      ],
      inventario: [
        { compartimiento_id: 1, producto_id: productId, cantidad: 11 },
        { compartimiento_id: 73, producto_id: productId, cantidad: 7 },
        { compartimiento_id: 73, producto_id: secondProductId, cantidad: 3 },
        { compartimiento_id: 96, producto_id: productId, cantidad: 12 },
      ],
    },
  };
  const quantity = (product, location) => state.tables.inventario.find(row => row.producto_id === product && row.compartimiento_id === location)?.cantidad ?? 0;
  const update = (product, location, value) => {
    state.tables.inventario = state.tables.inventario.filter(row => row.producto_id !== product || row.compartimiento_id !== location);
    if (value > 0) state.tables.inventario.push({ producto_id: product, compartimiento_id: location, cantidad: value });
  };
  const insert = input => {
    state.writes.push(structuredClone(input));
    if ([input.origen_compartimiento_id, input.destino_compartimiento_id].filter(Boolean).some(id => !state.tables.compartimientos.some(row => row.id === id))) return { error: { code: '23503' } };
    const source = quantity(input.producto_id, input.origen_compartimiento_id);
    if (input.origen_compartimiento_id && source < input.cantidad) return { error: { code: '23514' } };
    if (input.origen_compartimiento_id) update(input.producto_id, input.origen_compartimiento_id, source - input.cantidad);
    if (input.destino_compartimiento_id) update(input.producto_id, input.destino_compartimiento_id, quantity(input.producto_id, input.destino_compartimiento_id) + input.cantidad);
    return { error: null };
  };
  state.client = {
    from(table) {
      const query = { table, columns: '', filters: [], orders: [], start: 0, end: Infinity, single: false, count: false };
      return {
        select(columns, options) { query.columns = columns; query.count = options?.count === 'exact'; return this; },
        eq(column, value) { query.filters.push([column, 'eq', value]); return this; },
        in(column, values) { query.filters.push([column, 'in', values]); return this; },
        gt(column, value) { query.filters.push([column, 'gt', value]); return this; },
        order(column, options) { query.orders.push([column, options?.ascending !== false]); return this; },
        range(start, end) { query.start = start; query.end = end; return this; },
        maybeSingle() { query.single = true; return this; },
        async insert(input) { return insert(input); },
        then(resolve, reject) {
          state.queries.push(structuredClone(query));
          if (state.failTable === table) return Promise.resolve({ data: null, error: new Error(`Fallo simulado ${table}`) }).then(resolve, reject);
          let rows = [...state.tables[table]];
          for (const [column, operator, value] of query.filters) rows = rows.filter(row => operator === 'in' ? value.includes(row[column]) : operator === 'eq' ? row[column] === value : row[column] > value);
          rows.sort((a, b) => {
            for (const [column, ascending] of query.orders) {
              const difference = typeof a[column] === 'number' ? a[column] - b[column] : String(a[column]).localeCompare(String(b[column]));
              if (difference) return ascending ? difference : -difference;
            }
            return 0;
          });
          const count = rows.length;
          rows = rows.slice(query.start, query.end + 1);
          if (table === 'productos' && query.columns.includes('categorias')) rows = rows.map(row => ({ ...row, categorias: { nombre: state.tables.categorias.find(category => category.id === row.categoria_id)?.nombre } }));
          return Promise.resolve({ data: query.single ? rows[0] ?? null : rows, count: query.count ? count : null, error: null }).then(resolve, reject);
        },
      };
    },
    async rpc(name, input) {
      state.rpcs.push({ name, input: structuredClone(input) });
      const current = quantity(input.p_producto_id, input.p_compartimiento_id);
      if (current !== input.p_cantidad_esperada) return { data: null, error: { code: '40001' } };
      if (current === input.p_cantidad_fisica) return { data: null, error: null };
      const delta = input.p_cantidad_fisica - current;
      const result = insert({ producto_id: input.p_producto_id, tipo: 'ajuste', cantidad: Math.abs(delta),
        origen_compartimiento_id: delta < 0 ? input.p_compartimiento_id : null,
        destino_compartimiento_id: delta > 0 ? input.p_compartimiento_id : null });
      return { data: 123, error: result.error };
    },
  };
  const context = vm.createContext({ __fixture: state, console: { error() {} } });
  new vm.Script(bundle.outputFiles[0].text).runInContext(context);
  return { state, ...context.shelves };
}
