// Vista superior de cada piso. Se cambia aquí para rotar o reflejar el dibujo.
// Los códigos físicos y la numeración de la base no cambian.
export const COMPARTMENT_SLOTS: Record<
  number,
  { row: number; column: number }
> = {
  1: { row: 1, column: 1 }, // arriba izquierda
  2: { row: 1, column: 2 }, // arriba derecha
  3: { row: 2, column: 2 }, // abajo derecha
  4: { row: 2, column: 1 }, // abajo izquierda
};
