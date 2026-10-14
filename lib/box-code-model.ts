// Equivalente a upper(btrim(text) COLLATE "C") para los códigos ASCII admitidos.
// No convertir Unicode a ASCII: por ejemplo, ß nunca debe transformarse en SS.
export function normalizeBoxCode(value: string): string {
  return value.replace(/^ +| +$/g, "").replace(/[a-z]/g, letter => letter.toUpperCase());
}

export function validateBoxCode(value: unknown): string | null {
  if (typeof value !== "string") return "Ingresa un código para la caja.";
  const code = normalizeBoxCode(value);
  if (code.length < 1 || code.length > 24 || !/^[A-Z0-9]/.test(code) || /[^A-Z0-9_-]/.test(code)) {
    return "Usa de 1 a 24 caracteres: letras A–Z, números, guion o guion bajo. Comienza con una letra o número.";
  }
  if (/^C[0-9]+$/.test(code)) return "Los códigos C seguidos solo de números están reservados para las torres.";
  return null;
}
