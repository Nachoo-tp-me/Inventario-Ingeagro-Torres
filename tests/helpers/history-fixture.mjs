import { createShelfFixture, productId } from './shelves-fixture.mjs';

export function createHistoryFixture() {
  const f = createShelfFixture();
  const row = (id, tipo, origen, destino, oldFrom, oldTo) => ({ id, fecha: '2026-01-02T12:30:00.000Z', tipo, cantidad: id,
    producto_id: productId, origen_compartimiento_id: origen, destino_compartimiento_id: destino, codigo_origen: oldFrom, codigo_destino: oldTo });
  f.state.tables.movimientos = [row(1,'traslado',1,25,'C111','C211'),row(2,'traslado',1,73,'C111','A1'),row(3,'traslado',73,25,'A1','C211'),row(4,'traslado',73,96,'A1','B12'),
    row(5,'entrada',null,73,null,'A1'),row(6,'retiro',73,null,'A1',null),row(7,'ajuste',null,73,null,'A1'),row(8,'ajuste',73,null,'A1',null),
    row(9,'entrada',null,1,null,null),row(10,'entrada',null,1,null,'C111'),row(11,'retiro',1,null,'C111',null),row(12,'ajuste',null,1,null,'C111'),row(13,'ajuste',1,null,'C111',null)];
  return f;
}
