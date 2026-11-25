import { soles, entero } from './interfaz.js';

const reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const inst = new Map();
export const COLORES = ['#17171c', '#c9a97d', '#8c8f9a', '#1c9a62', '#6b5bd6'];
const BEIGE = '#eadfce';

function montar(id, config) {
  const prev = inst.get(id); if (prev) prev.destroy();
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#6e7280';
  Chart.defaults.borderColor = '#ececf1'; 
  Chart.defaults.animation.duration = reducir ? 0 : 300;
  Chart.defaults.maintainAspectRatio = false;
  const c = new Chart(document.getElementById(id), config);
  inst.set(id, c);
  c.canvas.addEventListener('contextrestored', () => { if (inst.get(id) === c) c.update('none'); });
  const ajustar = () => { if (inst.get(id) === c) c.resize(); };
  requestAnimationFrame(ajustar);
  setTimeout(ajustar, 250);
  setTimeout(ajustar, 1000);
  return c;
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => inst.forEach((c) => c.resize()));
window.addEventListener('load', () => inst.forEach((c) => c.resize()));
function redibujar() {
  inst.forEach((c) => { try { if (c.canvas && c.canvas.isConnected) c.update('none'); } catch (_) { /* gráfico ya destruido */ } });
}
let tRedibujo;
const redibujarPronto = () => { clearTimeout(tRedibujo); tRedibujo = setTimeout(redibujar, 150); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) redibujarPronto(); });
window.addEventListener('focus', redibujarPronto);
window.addEventListener('pageshow', redibujarPronto);
window.addEventListener('resize', redibujarPronto);
export function destruirTodos() { inst.forEach((c) => c.destroy()); inst.clear(); }
const kfmt = (v) => (v >= 1000 ? `S/ ${Math.round(v / 1000 * 10) / 10}k` : `S/ ${v}`);
const escalaSoles = { beginAtZero: true, grid: { color: '#ececf1' }, border: { display: false }, ticks: { callback: kfmt } };

export function barrasMensuales(id, m, etiquetas) {
  return montar(id, {
    data: {
      labels: etiquetas,
      datasets: [
        { type: 'bar', label: 'Ventas (S/)', data: m.map((x) => x.importe), backgroundColor: BEIGE, borderRadius: 8, maxBarThickness: 64, yAxisID: 'y' },
        { type: 'line', label: 'Unidades', data: m.map((x) => x.unidades), borderColor: '#8c8f9a', backgroundColor: '#8c8f9a', pointRadius: 4, tension: .35, yAxisID: 'y1' },
      ],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.dataset.yAxisID === 'y' ? ` ${soles(c.parsed.y)}` : ` ${entero(c.parsed.y)} unidades`) } } },
      scales: { x: { grid: { display: false } }, y: escalaSoles, y1: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { precision: 0 } } },
    },
  });
}

export function barrasTop(id, top) {
  return montar(id, {
    type: 'bar',
    data: { labels: top.map((p) => p.nombre), datasets: [{ label: 'Unidades vendidas', data: top.map((p) => p.unidades_vendidas), backgroundColor: top.map((_, i) => COLORES[i % 5]), borderRadius: 8 }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => `Facturado: ${soles(top[c.dataIndex].importe_facturado)}` } } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#ececf1' } }, y: { grid: { display: false } } },
    },
  });
}

export function lineasTop(id, d) {
  const series = d.series || [];
  return montar(id, {
    type: 'line',
    data: {
      labels: d.meses.map((m) => m.etiqueta),
      datasets: series.map((s, i) => ({ label: s.nombre, data: s.datos, borderColor: COLORES[i % 5], backgroundColor: COLORES[i % 5], tension: .3, pointRadius: 3, borderWidth: 2 })),
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#ececf1' }, title: { display: true, text: 'Unidades' } } },
    },
  });
}

export function dona(id, cats) {
  const col = ['#c9a97d', '#8c8f9a', '#e8dccb', '#17171c', '#1c9a62', '#6b5bd6', '#d9b8b0', '#b6c4d6'];
  return montar(id, {
    type: 'doughnut',
    data: { labels: cats.map((c) => c.categoria), datasets: [{ data: cats.map((c) => c.importe), backgroundColor: cats.map((_, i) => col[i % col.length]), borderWidth: 2, borderColor: '#fff' }] },
    options: { cutout: '58%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${soles(c.parsed)}` } } } },
  });
}
export const COLORES_DONA = ['#c9a97d', '#8c8f9a', '#e8dccb', '#17171c', '#1c9a62', '#6b5bd6', '#d9b8b0', '#b6c4d6'];

export function spark(canvas, valores) {
  if (!canvas || valores.length < 4) return;   
  const c = new Chart(canvas, {
    type: 'line',
    data: { labels: valores.map((_, i) => i), datasets: [{ data: valores, borderColor: '#c9a97d', backgroundColor: 'rgba(233,220,203,.55)', fill: true, tension: .4, pointRadius: 0, borderWidth: 1.5 }] },
    options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, events: [] },
  });
  const clave = 'spark-' + (canvas.id || Math.random());
  const previo = inst.get(clave); if (previo && previo !== c) previo.destroy();
  inst.set(clave, c);
  canvas.addEventListener('contextrestored', () => { if (inst.get(clave) === c) c.update('none'); });
}

export function prediccion(id, { etiquetas, reales, estimadas, banda }) {
  const datasets = [
    { label: 'Ventas reales', data: reales, borderColor: '#8c8f9a', backgroundColor: '#8c8f9a', tension: .25, pointRadius: 3, spanGaps: false },
    { label: 'Ventas predichas', data: estimadas, borderColor: '#c9a97d', backgroundColor: '#c9a97d', borderDash: [6, 5], tension: .25, pointRadius: 4, spanGaps: false },
  ];
  if (banda) {
    datasets.push({ label: 'Banda inferior', data: banda.min, borderColor: 'transparent', backgroundColor: 'rgba(233,220,203,.5)', pointRadius: 0, fill: '+1', order: 5 });
    datasets.push({ label: 'Banda superior', data: banda.max, borderColor: 'transparent', pointRadius: 0, fill: false, order: 5 });
  }
  return montar(id, {
    type: 'line',
    data: { labels: etiquetas, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { filter: (c) => !c.dataset.label.startsWith('Banda'), callbacks: { label: (c) => ` ${c.dataset.label}: ${soles(c.parsed.y)}` } } },
      scales: { x: { grid: { color: '#f2f2f5' }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } }, y: { ...escalaSoles, title: { display: true, text: 'Ventas (S/)' } } },
    },
  });
}
