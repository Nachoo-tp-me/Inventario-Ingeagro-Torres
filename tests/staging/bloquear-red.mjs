// Precarga SOLO para verificación local: convierte cualquier intento de red en un error visible y deja la marca
// "RED_BLOQUEADA" en stderr. Sirve para demostrar que los scripts de staging abortan ANTES de cualquier petición.
//   node --import ./tests/staging/bloquear-red.mjs <script>      (o vía NODE_OPTIONS=--import=<url de este archivo>)
// No hace ninguna petición ni lee variables de entorno.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

function bloqueada(tipo) {
  process.stderr.write(`RED_BLOQUEADA: ${tipo}\n`);
  throw new Error(`RED_BLOQUEADA: ${tipo}`);
}

globalThis.fetch = () => bloqueada("fetch");
for (const modulo of [http, https]) {
  modulo.request = () => bloqueada(`${modulo === http ? "http" : "https"}.request`);
  modulo.get = () => bloqueada(`${modulo === http ? "http" : "https"}.get`);
}
net.connect = net.createConnection = () => bloqueada("net.connect");
net.Socket.prototype.connect = () => bloqueada("net.Socket.connect");
tls.connect = () => bloqueada("tls.connect");
