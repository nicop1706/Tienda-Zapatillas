// Ilustraciones SVG ORIGINALES de zapatillas (no son fotos ni logos de marcas reales).
// Cada producto recibe una variante de color estable según su SKU/categoría.
const VARIANTES = [
  { cuerpo: '#f4f4f2', detalle: '#1c1c1f', suela: '#ffffff', cordon: '#f9f9f8', sombra: '#d9d9d6' },   // blanca / negra
  { cuerpo: '#f6f6f4', detalle: '#1f9d63', suela: '#ffffff', cordon: '#ffffff', sombra: '#d6dcd8' },   // blanca / verde
  { cuerpo: '#e7d9c4', detalle: '#c9b497', suela: '#f3ece0', cordon: '#f6f0e6', sombra: '#d8cbb6' },   // arena
  { cuerpo: '#b9bcc4', detalle: '#52565e', suela: '#e5e6ea', cordon: '#dedfe3', sombra: '#a9acb4' },   // gris
  { cuerpo: '#f2ecde', detalle: '#2f5fa8', suela: '#f7f2e6', cordon: '#f5efe2', sombra: '#d9d1bf' },   // crema / azul
  { cuerpo: '#ece7ff', detalle: '#6b5bd6', suela: '#ffffff', cordon: '#f6f4ff', sombra: '#d4cff0' },   // lila
  { cuerpo: '#ffe6dc', detalle: '#e0613b', suela: '#fff7f2', cordon: '#fff3ec', sombra: '#efcdbf' },   // coral
  { cuerpo: '#dff0ea', detalle: '#2e7d6b', suela: '#f3faf7', cordon: '#f0f9f5', sombra: '#c4ddd4' },   // menta
];

export function variante(clave) {
  let h = 0;
  for (const c of String(clave)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % VARIANTES.length;
}

// Fotos reales de productos (id o SKU -> URL). Se cargan al iniciar la sesión desde
// /api/products/imagenes; se agregan dejando archivos en publico/imagenes/productos/.
let FOTOS = {};
export function usarFotos(mapa) { FOTOS = mapa && typeof mapa === 'object' ? mapa : {}; }

export const fotoDe = (clave) => FOTOS[String(clave)] || null;

let uid = 0;
/** Devuelve la foto del producto si existe; si no, un <svg> de zapatilla low-top.
 *  `clave` (id o SKU) decide la foto y, sin foto, la variante de color del dibujo. */
export function zapatilla(clave, sinFoto = false) {
  const foto = sinFoto ? null : FOTOS[String(clave)];
  if (foto) return `<img class="shoe foto" src="${foto}" alt="Foto del producto" loading="lazy" decoding="async">`;
  const v = VARIANTES[variante(clave)];
  const id = `z${++uid}`;
  return `<svg class="shoe" viewBox="0 0 240 150" role="img" aria-label="Ilustración de zapatilla" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity=".07"/></linearGradient></defs>
  <ellipse cx="124" cy="130" rx="96" ry="8" fill="${v.sombra}" opacity=".6"/>
  <!-- cuerpo (empeine, lengüeta, talón) -->
  <path d="M30 106C24 92 32 80 52 76C70 72 82 60 90 46L104 32C112 26 124 26 132 33L156 46C174 38 194 38 206 44C216 60 222 84 224 106Z" fill="${v.cuerpo}" stroke="${v.sombra}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M30 106C24 92 32 80 52 76C70 72 82 60 90 46L104 32C112 26 124 26 132 33L156 46C174 38 194 38 206 44C216 60 222 84 224 106Z" fill="url(#${id})"/>
  <!-- abertura del tobillo -->
  <path d="M132 33L156 46C174 38 194 38 206 44C196 48 176 52 160 58C150 52 140 44 132 33Z" fill="${v.sombra}" opacity=".55"/>
  <!-- banda lateral -->
  <path d="M84 106C112 102 142 82 158 56L172 58C158 90 128 112 90 116Z" fill="${v.detalle}"/>
  <!-- refuerzo del talón y puntera -->
  <path d="M206 44C216 60 222 84 224 106L206 106C206 86 202 62 192 48Z" fill="${v.detalle}" opacity=".9"/>
  <path d="M30 106C26 94 32 84 46 79L66 98L64 106Z" fill="#fff" opacity=".35"/>
  <!-- cordones -->
  <g stroke="${v.cordon}" stroke-width="4" stroke-linecap="round"><path d="M96 52l16 7M104 43l16 7M112 36l16 8"/></g>
  <g stroke="${v.sombra}" stroke-width="1" stroke-linecap="round"><path d="M96 53l16 7M104 44l16 7M112 37l16 8"/></g>
  <!-- suela -->
  <path d="M24 104H228V112C228 124 218 128 206 128H44C30 128 22 120 24 104Z" fill="${v.suela}" stroke="${v.sombra}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M30 114H222" stroke="${v.detalle}" stroke-width="3" stroke-linecap="round" opacity=".8"/>
</svg>`;
}
