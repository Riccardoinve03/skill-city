/* Skill City — la città delle skill di Claude.
   Legge mondo.json (pianta e sprite, da mondo.py) e dati.json (usi veri, da dati.py).
   Il mondo si disegna a risoluzione nativa e si ingrandisce di un numero intero di pixel. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const VUOTO = "#12131f";
const CALDO = "#ff9e6b";

const INFRA = {
  dati:      { nome: "Rete dati", colore: "#3fc8e4", edificio: "torre", titolo: "Torre della rete dati", segno: "antennina in testa",
               desc: "I prezzi di trader-data (feed.py) arrivano a tutte le skill con l'antennina." },
  broker:    { nome: "Conto broker", colore: "#a3aabd", edificio: "banca", titolo: "Banca del conto broker", segno: "cuffia con microfono",
               desc: "Ordini, portafoglio e stato del broker, condivisi tra quattro skill." },
  edgar:     { nome: "SEC EDGAR", colore: "#f2c14e", edificio: "archivio", titolo: "Archivio SEC EDGAR", segno: "spilla d'oro",
               desc: "I documenti ufficiali delle società quotate: 10-K, 10-Q e 8-K." },
  pacchetto: { nome: "Pacchetto trader", colore: "#3aa35f", edificio: null, titolo: "Pacchetto trader", segno: "cravatta verde",
               desc: "La configurazione comune in trader/config.json." },
};
const EDIFICIO_INFRA = { torre: "dati", banca: "broker", archivio: "edgar" };
const MODI = { "Comando /": "#ff9e6b", "Caricata da Claude": "#b49cff", "Script": "#3fc8e4" };
const LIVELLI = [0.5, 1, 1.5, 2, 2.5, 3, 4];
const SOTTO = new Set(["finanza", "municipio"]);       // cartellini da mettere sotto il quartiere

let M, D, SF, AT, ATS;              // mondo, dati, sfondo, atlante, atlante "addormentato"
let OGGI, DURATA_ANIM;
const abitanti = [], turisti = [], entita = {}, oggetti = [];
const mondo = document.createElement("canvas");
const grande = document.createElement("canvas");    // passaggio intermedio per gli zoom non interi
let w;                               // contesto del mondo (pixel nativi)
const schermo = $("#schermo"), sc = schermo.getContext("2d");
const scena = $("#scena");

const S = {
  cam: { x: 0, y: 0, zoom: 1 }, anim: null, vista: { ox: 0, oy: 0, s: 1, dpr: 1, cw: 0, ch: 0 },
  hover: null, scelto: null,
  mostra: { strade: true, infra: true, nomi: false },
  replay: { attivo: false, pausa: true, giorno: null, lotti: [], i: 0, prossimo: 0, conta: {}, ultimo: {}, vel: 1, ora: null },
  effetti: [],
};

// ------------------------------------------------------------ utilità
const giornoDi = iso => iso.slice(0, 10);
const oraDi = iso => iso.slice(11, 16);
const fmtGiorno = g => `${g.slice(8, 10)}/${g.slice(5, 7)}`;
const utc = g => Date.UTC(+g.slice(0, 4), +g.slice(5, 7) - 1, +g.slice(8, 10));
const giorniTra = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const piuGiorni = (g, n) => new Date(utc(g) + n * 864e5).toISOString().slice(0, 10);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(t) { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

function quando(g) {
  if (!g) return "mai";
  const d = giorniTra(giornoDi(g), OGGI);
  return d === 0 ? "oggi" : d === 1 ? "ieri" : fmtGiorno(g);
}

function statoSkill(s) {
  if (!s.chiamate) return "dorme";
  const d = giorniTra(giornoDi(s.ultimo), OGGI);
  return d === 0 ? "oggi" : d <= 7 ? "settimana" : "dorme";
}

// ------------------------------------------------------------ caricamento
function immagine(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
}

async function carica() {
  [M, D, SF, AT] = await Promise.all([
    fetch("mondo.json").then(r => r.json()), fetch("dati.json", { cache: "no-store" }).then(r => r.json()),
    immagine("sfondo.png"), immagine("sprite.png"),
  ]);
  OGGI = giornoDi(D.aggiornato);
  DURATA_ANIM = M.durate.reduce((a, b) => a + b, 0);
  mondo.width = M.w; mondo.height = M.h;
  w = mondo.getContext("2d");
  ATS = addormenta(AT);
  prepara();
  costruisciEtichette();
  preparaReplay();
  intestazione();
  dimensiona();
  new ResizeObserver(dimensiona).observe(scena);
  daIndirizzo();
  window.addEventListener("hashchange", daIndirizzo);
  requestAnimationFrame(ciclo);
}

function addormenta(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11;
    p[i] = (p[i] * .35 + g * .65) * .62; p[i + 1] = (p[i + 1] * .35 + g * .65) * .62; p[i + 2] = (p[i + 2] * .35 + g * .65) * .7;
  }
  x.putImageData(d, 0, 0);
  return c;
}

function prepara() {
  for (const [nome, s] of Object.entries(D.skill)) {
    const pos = s.sprite && M.posti[s.sprite];
    if (s.distretto && pos) {
      const a = { nome, s, sprite: s.sprite, x: pos[0], y: pos[1], fase: hash(nome) % DURATA_ANIM };
      abitanti.push(a); entita[nome] = a;
    } else if (!s.distretto && s.chiamate) {
      const t = { nome, s, sprite: "turista", x: 0, y: 0, fase: hash(nome) % DURATA_ANIM, turista: true };
      turisti.push(t); entita[nome] = t;
    }
  }
  turisti.sort((a, b) => b.s.chiamate - a.s.chiamate);
  turisti.forEach((t, i) => { t.ang0 = (i / turisti.length) * Math.PI * 2; t.verso = i % 2 ? -1 : 1; });
  for (const o of M.oggetti) oggetti.push(o);
}

// ------------------------------------------------------------ fotocamera
function livelli() { return LIVELLI; }

function dimensiona() {
  const dpr = window.devicePixelRatio || 1;
  const cw = scena.clientWidth, ch = scena.clientHeight;
  schermo.width = Math.round(cw * dpr); schermo.height = Math.round(ch * dpr);
  Object.assign(S.vista, { dpr, cw, ch });
  const mm = $("#minimappa");
  mm.width = Math.round(150 * dpr); mm.height = Math.round(150 * M.h / M.w * dpr);
  mm.style.height = (150 * M.h / M.w) + "px";
}

function zoomPer(larg, alt) {
  const { cw, ch } = S.vista, lv = livelli();
  let z = lv[0];
  for (const l of lv) if (larg * l <= cw - 12 && alt * l <= ch - 16) z = l;
  return z;
}

function inquadra(x0, y0, x1, y1, subito) {
  const zoom = zoomPer(x1 - x0, y1 - y0);
  vaiA((x0 + x1) / 2, (y0 + y1) / 2, zoom, subito);
}

function vaiA(x, y, zoom, subito) {
  const a = { x: clamp(x, 0, M.w), y: clamp(y, 0, M.h), zoom };
  if (subito) { S.cam = a; S.anim = null; return; }
  S.anim = { da: { ...S.cam }, a, t0: performance.now(), dur: 450 };
}

function tuttaLaCitta(subito) {
  // su uno schermo stretto (Notion sul telefono) la città intera sarebbe minuscola: meglio il quartiere aperto
  if (zoomPer(M.w - 40, M.h - 30) < 1) {
    const aperto = Object.keys(M.distretti).find(k => M.distretti[k].aperto);
    if (aperto) return inquadraDistretto(aperto, subito);
  }
  inquadra(20, 10, M.w - 20, M.h - 20, subito);
}

function inquadraDistretto(k, subito) {
  const p = M.distretti[k].poligono;
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  inquadra(Math.min(...xs), Math.min(...ys) - (M.distretti[k].aperto ? 96 : 50), Math.max(...xs), Math.max(...ys) + 26, subito);
}

function passoZoom(dir, fx, fy) {
  const lv = livelli(), z = S.cam.zoom;
  let i = lv.findIndex(l => l >= z - 1e-6);
  if (i < 0) i = lv.length - 1;
  const n = lv[clamp(dir > 0 ? (lv[i] > z + 1e-6 ? i : i + 1) : i - 1, 0, lv.length - 1)];
  if (n === z) return;
  const { cw, ch } = S.vista;
  fx = fx ?? cw / 2; fy = fy ?? ch / 2;
  const [mx, my] = aMondo(fx, fy);
  vaiA(mx - (fx - cw / 2) / n, my - (fy - ch / 2) / n, n);
}

function aggiornaCam(t) {
  if (!S.anim) return;
  const p = clamp((t - S.anim.t0) / S.anim.dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
  const { da, a } = S.anim;
  S.cam = { x: da.x + (a.x - da.x) * e, y: da.y + (a.y - da.y) * e, zoom: da.zoom + (a.zoom - da.zoom) * e };
  if (p >= 1) { S.cam = { ...a }; S.anim = null; }
}

function aSchermo(x, y) {
  const v = S.vista;
  return [(v.ox + x * v.s) / v.dpr, (v.oy + y * v.s) / v.dpr];
}
function aMondo(x, y) {
  const v = S.vista;
  return [(x * v.dpr - v.ox) / v.s, (y * v.dpr - v.oy) / v.s];
}

// ------------------------------------------------------------ disegno a pixel
function px(x, y, c) { w.fillStyle = c; w.fillRect(Math.round(x), Math.round(y), 1, 1); }

function linea(x0, y0, x1, y1, c, trat, off = 0) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, i = 0;
  w.fillStyle = c;
  for (;;) {
    if (!trat || ((i + off) % (trat[0] + trat[1]) + trat[0] + trat[1]) % (trat[0] + trat[1]) < trat[0]) w.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    i++;
  }
}

function ellisse(cx, cy, rx, ry, c) {
  w.fillStyle = c;
  const n = Math.ceil(Math.PI * 2 * Math.max(rx, ry));
  let lx = null, ly = null;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2, x = Math.round(cx + rx * Math.cos(a)), y = Math.round(cy + ry * Math.sin(a));
    if (x !== lx || y !== ly) w.fillRect(x, y, 1, 1);
    lx = x; ly = y;
  }
}

function ellissePiena(cx, cy, rx, ry, c) {
  w.fillStyle = c;
  for (let y = -ry; y <= ry; y++) {
    const h = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (ry + .5)) ** 2)));
    if (h > 0) w.fillRect(Math.round(cx) - h, Math.round(cy) + y, 2 * h, 1);
  }
}

function bezier(p0, c, p1, u) {
  const v = 1 - u;
  return [v * v * p0[0] + 2 * v * u * c[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * c[1] + u * u * p1[1]];
}

function arco(p0, p1) {
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  return [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - Math.min(34, 8 + d * .28)];
}

function curva(p0, c, p1, col) {
  const n = Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 1.3) + 2;
  let lx, ly;
  w.fillStyle = col;
  for (let i = 0; i <= n; i++) {
    const [x, y] = bezier(p0, c, p1, i / n), rx = Math.round(x), ry = Math.round(y);
    if (rx !== lx || ry !== ly) w.fillRect(rx, ry, 1, 1);
    lx = rx; ly = ry;
  }
}

// font di pixel 3x5 per "+1" e "z"
const GLIFI = {
  "+": ["000", "010", "111", "010", "000"], "z": ["000", "111", "001", "010", "111"],
  0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "011", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"], 8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
};
function scrivi(testo, x, y, c) {
  w.fillStyle = c;
  [...testo].forEach((ch, k) => {
    const g = GLIFI[ch]; if (!g) return;
    g.forEach((riga, r) => [...riga].forEach((b, q) => { if (b === "1") w.fillRect(Math.round(x) + k * 4 + q, Math.round(y) + r, 1, 1); }));
  });
}

// ------------------------------------------------------------ entità del mondo
function frameA(ms) {
  let t = ((ms % DURATA_ANIM) + DURATA_ANIM) % DURATA_ANIM;
  for (let i = 0; i < M.durate.length; i++) { if (t < M.durate[i]) return i; t -= M.durate[i]; }
  return 0;
}

function aggiornaTuristi(t) {
  const [cx, cy] = M.piazza.centro, rx = M.piazza.rx * .8, ry = M.piazza.ry * .8;
  for (const tu of turisti) {
    const a = tu.ang0 + tu.verso * t * 0.00005;
    tu.x = cx + rx * Math.cos(a); tu.y = cy + ry * Math.sin(a);
    tu.sinistra = tu.verso * -Math.sin(a) < 0;
  }
}

function sveglia(e) {
  if (S.replay.attivo) return (S.replay.conta[e.nome] || 0) > 0;
  return statoSkill(e.s) !== "dorme";
}

function salto(e, t) {
  for (const f of S.effetti) if (f.tipo === "salto" && f.nome === e.nome) {
    const p = (t - f.t0) / 380;
    if (p >= 0 && p <= 1) return Math.round(4 * Math.sin(Math.PI * p));
  }
  return 0;
}

function corpo(e) { return [e.x, e.y - 13]; }
function posizione(nome) { const e = entita[nome]; return e ? corpo(e) : null; }
function statuaTesta() { return [M.piazza.statua[0], M.piazza.statua[1] - 30]; }

function disegnaMostro(e, t) {
  const mo = M.mostri[e.sprite], desto = sveglia(e);
  const f = desto ? frameA(t + e.fase) : 6;
  const r = mo.frame[f], y = e.y - mo.ancora[1] - salto(e, t);
  const img = desto ? AT : ATS;
  if (e.sinistra) {
    w.save(); w.translate(Math.round(e.x) * 2, 0); w.scale(-1, 1);
    w.drawImage(img, r[0], r[1], r[2], r[3], Math.round(e.x) - mo.ancora[0], Math.round(y), r[2], r[3]);
    w.restore();
  } else {
    w.drawImage(img, r[0], r[1], r[2], r[3], Math.round(e.x) - mo.ancora[0], Math.round(y), r[2], r[3]);
  }
}

function disegnaSprite(tipo, pos) {
  const sp = M.sprite[tipo], r = sp.rect;
  w.drawImage(AT, r[0], r[1], r[2], r[3], pos[0] - sp.ancora[0], pos[1] - sp.ancora[1], r[2], r[3]);
}

function disegnaStatua(t) {
  const mo = M.mostri.claude, r = mo.frame[frameA(t)], [x, y] = M.piazza.statua;
  w.drawImage(AT, r[0], r[1], r[2], r[3], x - mo.ancora[0], y - mo.ancora[1], r[2], r[3]);
}

function centroEdificio(tipo) { const o = oggetti.find(q => q.tipo === tipo); return o && o.centro; }

// ------------------------------------------------------------ il mondo, fotogramma per fotogramma
function disegnaMondo(t) {
  w.clearRect(0, 0, M.w, M.h);
  w.drawImage(SF, 0, 0);
  const sel = S.scelto, hov = S.hover;
  const nomeSel = sel && sel.tipo === "skill" ? sel.id : null;
  const infraSel = sel && sel.tipo === "infra" ? sel.id : null;

  // onde che partono dalla statua di Claude
  const [cx, cy] = M.piazza.centro;
  for (let j = 0; j < 3; j++) {
    const p = ((t / 3200) + j / 3) % 1, rx = 24 + p * (M.piazza.rx - 26);
    ellisse(cx, cy, rx, rx / 2, `rgba(255,158,107,${(.55 * (1 - p)).toFixed(3)})`);
  }

  // piazzole: accese se la skill lavora oggi (o nel replay)
  for (const e of abitanti.concat(turisti)) {
    const acceso = S.replay.attivo ? (S.replay.conta[e.nome] || 0) > 0 : statoSkill(e.s) === "oggi";
    if (acceso) {
      const pulsa = .16 + .08 * Math.sin(t / 380 + e.fase);
      ellissePiena(e.x, e.y, 12, 6, `rgba(255,158,107,${pulsa.toFixed(3)})`);
      ellisse(e.x, e.y, 12, 6, "rgba(255,158,107,.55)");
    }
    if (nomeSel === e.nome) ellisse(e.x, e.y, 13, 6.5, "#ffffff");
  }

  // cavi delle infrastrutture: dagli edifici ai mostriciattoli con lo stesso segno
  if (S.mostra.infra) {
    for (const e of abitanti) for (const k of e.s.infra) {
      const inf = INFRA[k]; if (!inf.edificio) continue;
      const c = centroEdificio(inf.edificio); if (!c) continue;
      const acceso = infraSel === k || nomeSel === e.nome;
      const spento = (infraSel && infraSel !== k) || (nomeSel && nomeSel !== e.nome);
      const a = acceso ? 1 : spento ? .12 : .4;
      linea(c[0], c[1], e.x, e.y, hexA(inf.colore, a), [3, 3], -Math.floor(t / 90));
    }
  }

  // tutto ciò che sta in piedi, ordinato per profondità
  aggiornaTuristi(t);
  const cose = [];
  for (const o of oggetti) cose.push([o.pos[1], () => disegnaSprite(o.tipo, o.pos)]);
  for (const e of abitanti) cose.push([e.y, () => disegnaMostro(e, t)]);
  for (const e of turisti) cose.push([e.y, () => disegnaMostro(e, t)]);
  cose.push([M.piazza.centro[1], () => disegnaStatua(t)]);
  cose.sort((a, b) => a[0] - b[0]).forEach(c => c[1]());

  // luci: torre che lampeggia, lampioni
  for (const o of oggetti) {
    const sp = M.sprite[o.tipo]; if (!sp.luce) continue;
    const lx = o.pos[0] - sp.ancora[0] + sp.luce[0], ly = o.pos[1] - sp.ancora[1] + sp.luce[1];
    if (o.tipo === "torre") {
      if (t % 1200 < 600) { ellissePiena(lx, ly, 4, 3, "rgba(63,200,228,.35)"); w.fillStyle = "#bff4ff"; w.fillRect(lx - 1, ly, 3, 1); }
    } else {
      ellissePiena(lx, ly + 1, 4, 3, "rgba(255,210,122,.16)");
    }
  }

  // archi "usate insieme" con le scintille che li percorrono
  if (S.mostra.strade) {
    for (const [a, b, n] of D.strade) {
      const p0 = posizione(a), p1 = posizione(b); if (!p0 || !p1) continue;
      const tocca = nomeSel && (a === nomeSel || b === nomeSel);
      const alfa = tocca ? .95 : nomeSel || infraSel ? .1 : clamp(.22 + .1 * n, .25, .7);
      const c = arco(p0, p1);
      curva(p0, c, p1, `rgba(255,158,107,${alfa})`);
      if (!(nomeSel || infraSel) || tocca) {
        const k = Math.min(3, n), fase = (hash(a + b) % 1000) / 1000;
        for (let j = 0; j < k; j++) {
          const [x, y] = bezier(p0, c, p1, ((t * .00028) + fase + j / k) % 1);
          w.fillStyle = "#ffe2c9"; w.fillRect(Math.round(x), Math.round(y), 2, 2);
        }
      }
    }
  }

  // chi dorme fa le "z"
  for (const e of abitanti) {
    if (sveglia(e)) continue;
    for (let j = 0; j < 2; j++) {
      const p = ((t + e.fase * 3) / 2400 + j / 2) % 1;
      scrivi("z", e.x + 4 + p * 5, e.y - 32 - p * 9, `rgba(170,178,214,${(.8 * (1 - p)).toFixed(2)})`);
    }
  }

  disegnaEffetti(t);

  // segnalino sopra chi è sotto il mouse o selezionato
  for (const nome of new Set([hov && hov.tipo === "skill" ? hov.id : null, nomeSel])) {
    const e = nome && entita[nome]; if (!e) continue;
    const x = Math.round(e.x), y = Math.round(e.y) - 33 - salto(e, t) + Math.round(Math.sin(t / 200));
    w.fillStyle = nome === nomeSel ? CALDO : "#ffffff";
    w.fillRect(x - 2, y, 5, 1); w.fillRect(x - 1, y + 1, 3, 1); w.fillRect(x, y + 2, 1, 1);
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function disegnaEffetti(t) {
  S.effetti = S.effetti.filter(f => t - f.t0 < (f.dur || 900));
  for (const f of S.effetti) {
    const p = (t - f.t0) / (f.dur || 900);
    if (f.tipo === "messaggero") {
      if (p < 0) continue;
      const fine = posizione(f.a) || f.p1;
      const c = arco(f.p0, fine);
      for (let k = 4; k >= 0; k--) {
        const u = clamp(p - k * .035, 0, 1), [x, y] = bezier(f.p0, c, fine, 1 - (1 - u) * (1 - u));
        const r = k === 0 ? 2 : 1;
        w.fillStyle = k === 0 ? "#fff3e8" : `rgba(255,158,107,${(.7 - k * .13).toFixed(2)})`;
        w.fillRect(Math.round(x) - r + 1, Math.round(y) - r + 1, r * 2 - (k ? 0 : 1), r * 2 - (k ? 0 : 1));
      }
      if (p < .15) ellisse(f.p0[0], f.p0[1], 3 + p * 30, (3 + p * 30) / 2, `rgba(255,158,107,${(.6 - p * 4).toFixed(2)})`);
    } else if (f.tipo === "piu") {
      const e = entita[f.nome]; if (!e) continue;
      scrivi("+" + f.n, e.x + 7, e.y - 38 - p * 10, `rgba(255,226,201,${(1 - p).toFixed(2)})`);
    }
  }
}

// ------------------------------------------------------------ schermo
function ciclo(t) {
  aggiornaCam(t);
  tickReplay(t);
  disegnaMondo(t);
  const v = S.vista, dpr = v.dpr;
  v.s = S.cam.zoom * dpr;
  v.ox = Math.round(schermo.width / 2 - S.cam.x * v.s);
  v.oy = Math.round(schermo.height / 2 - S.cam.y * v.s);
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.fillStyle = VUOTO; sc.fillRect(0, 0, schermo.width, schermo.height);
  if (S.anim || Math.abs(v.s - Math.round(v.s)) < 1e-6) {
    sc.imageSmoothingEnabled = false;
    sc.drawImage(mondo, v.ox, v.oy, Math.round(M.w * v.s), Math.round(M.h * v.s));
  } else {
    // es. zoom 1,5 su schermo normale: pixel ingranditi di 2 e poi ridotti con morbidezza, così nessun pixel "balla"
    const k = Math.ceil(v.s);
    if (grande.width !== M.w * k) { grande.width = M.w * k; grande.height = M.h * k; }
    const g = grande.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, grande.width, grande.height);
    g.drawImage(mondo, 0, 0, grande.width, grande.height);
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = "high";
    sc.drawImage(grande, v.ox, v.oy, Math.round(M.w * v.s), Math.round(M.h * v.s));
  }
  posizionaEtichette();
  if (t - (ciclo.mm || 0) > 120) { minimappa(); ciclo.mm = t; }
  disegnaRitratti(t);
  requestAnimationFrame(ciclo);
}

// ------------------------------------------------------------ etichette HTML
const etichette = [];
function etichetta(el, mondoXY, opz = {}) { $("#etichette").appendChild(el); etichette.push({ el, mondoXY, ...opz }); return el; }

function costruisciEtichette() {
  for (const [k, d] of Object.entries(M.distretti)) {
    const el = document.createElement("div");
    el.className = "cartellino" + (d.aperto ? "" : " cantiere");
    el.dataset.distretto = k;
    const membri = abitanti.filter(a => a.s.distretto === k);
    const oggi = membri.filter(a => statoSkill(a.s) === "oggi").length;
    const chiamate = membri.reduce((n, a) => n + a.s.chiamate, 0);
    el.innerHTML = `<span class="icona" style="background:${d.colore}">${esc(d.nome[0])}</span>
      <span><span class="nome">${esc(d.nome)}</span><br><span class="sotto">${d.aperto
        ? `${membri.length} skill · <span class="on">${oggi} attive oggi</span> · ${chiamate} chiamate`
        : `in costruzione · ${membri.length} prototipo`}</span></span>`;
    el.addEventListener("click", () => { seleziona({ tipo: "distretto", id: k }); inquadraDistretto(k); });
    // sotto il quartiere se in alto c'è qualcosa (la torre, la piazza), altrimenti sopra
    const p = d.poligono, sotto = SOTTO.has(k);
    etichetta(el, () => sotto ? [p[2][0], p[2][1] + 12] : [p[0][0], p[0][1] - 40], { sotto });
  }
  const pz = document.createElement("div");
  pz.className = "cartellino piazza";
  const tot = D.totale;
  pz.innerHTML = `<span class="icona">C</span><span><span class="nome">Piazza di Claude</span><br>
    <span class="sotto">${tot} chiamate · ${D.sessioni} sessioni</span></span>`;
  pz.addEventListener("click", () => seleziona({ tipo: "claude", id: "claude" }));
  etichetta(pz, () => [M.piazza.statua[0], M.piazza.statua[1] - 50]);

  for (const o of oggetti) {
    const k = EDIFICIO_INFRA[o.tipo]; if (!k) continue;
    const sp = M.sprite[o.tipo], el = document.createElement("div");
    el.className = "targa edificio";
    el.style.setProperty("--c", INFRA[k].colore);
    el.textContent = INFRA[k].nome;
    const cima = cimaSprite(sp.rect);
    etichetta(el, () => [o.pos[0] - sp.ancora[0] + sp.rect[2] / 2, o.pos[1] - sp.ancora[1] + cima - 16], { minZoom: 1.5 });
  }
  for (const e of abitanti.concat(turisti)) {
    const el = document.createElement("div");
    el.className = "targa";
    el.textContent = e.nome;
    e.targa = el;
    etichetta(el, () => [e.x, e.y + 3], { nome: e.nome });
  }
}

function posizionaEtichette() {
  $("#etichette").classList.toggle("compatte", S.cam.zoom < 1.5);
  const nomeSel = S.scelto && S.scelto.tipo === "skill" ? S.scelto.id : null;
  const nomeHov = S.hover && S.hover.tipo === "skill" ? S.hover.id : null;
  for (const et of etichette) {
    let visibile = true;
    if (et.minZoom && S.cam.zoom < et.minZoom) visibile = false;
    if (et.nome) {
      visibile = et.nome === nomeSel || et.nome === nomeHov || (S.mostra.nomi && S.cam.zoom >= 1.5);
      et.el.classList.toggle("scelta", et.nome === nomeSel);
    }
    if (!visibile) { et.el.style.display = "none"; continue; }
    const [x, y] = aSchermo(...et.mondoXY());
    et.el.style.display = "";
    et.el.style.left = x + "px"; et.el.style.top = y + "px";
    if (et.sotto) et.el.style.transform = "translate(-50%, 0)";
  }
}

// ------------------------------------------------------------ minimappa
function minimappa() {
  const c = $("#minimappa"), x = c.getContext("2d"), k = c.width / M.w;
  x.imageSmoothingEnabled = true;
  x.drawImage(SF, 0, 0, c.width, c.height);
  for (const e of abitanti.concat(turisti)) {
    x.fillStyle = sveglia(e) ? CALDO : "#5d6385";
    x.fillRect(e.x * k - 1.5, (e.y - 8) * k - 1.5, 3, 3);
  }
  const { cw, ch } = S.vista, z = S.cam.zoom;
  x.strokeStyle = "#e6e7ef"; x.lineWidth = Math.max(1, k);
  x.strokeRect((S.cam.x - cw / 2 / z) * k, (S.cam.y - ch / 2 / z) * k, cw / z * k, ch / z * k);
}

// ------------------------------------------------------------ cosa c'è sotto il mouse
function cosaC(mx, my) {
  const trovati = [];
  for (const e of abitanti.concat(turisti)) {
    if (mx >= e.x - 10 && mx <= e.x + 16 && my >= e.y - 26 && my <= e.y + 2) trovati.push([e.y, { tipo: "skill", id: e.nome }]);
  }
  const [sx, sy] = M.piazza.statua;
  if (mx >= sx - 22 && mx <= sx + 22 && my >= sy - 30 && my <= sy + 10) trovati.push([M.piazza.centro[1], { tipo: "claude", id: "claude" }]);
  for (const o of oggetti) {
    const k = EDIFICIO_INFRA[o.tipo]; if (!k) continue;
    const sp = M.sprite[o.tipo], x0 = o.pos[0] - sp.ancora[0], y0 = o.pos[1] - sp.ancora[1];
    if (mx >= x0 && mx <= x0 + sp.rect[2] && my >= y0 && my <= y0 + sp.rect[3]) {
      const px_ = AT.width ? leggiAlfa(sp.rect[0] + (mx - x0), sp.rect[1] + (my - y0)) : 255;
      if (px_ > 0) trovati.push([o.pos[1], { tipo: "infra", id: k }]);
    }
  }
  if (trovati.length) return trovati.sort((a, b) => b[0] - a[0])[0][1];
  for (const [k, d] of Object.entries(M.distretti)) if (dentro(mx, my, d.poligono)) return { tipo: "distretto", id: k };
  return null;
}

let alfaAtlante;
function cimaSprite(r) {           // prima riga non trasparente: le targhe stanno appena sopra il tetto
  for (let y = 0; y < r[3]; y++) for (let x = 0; x < r[2]; x++) if (leggiAlfa(r[0] + x, r[1] + y) > 0) return y;
  return 0;
}
function leggiAlfa(x, y) {
  if (!alfaAtlante) {
    const c = document.createElement("canvas"); c.width = AT.width; c.height = AT.height;
    const g = c.getContext("2d"); g.drawImage(AT, 0, 0);
    alfaAtlante = { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width };
  }
  return alfaAtlante.d[(Math.floor(y) * alfaAtlante.w + Math.floor(x)) * 4 + 3];
}

function dentro(x, y, poli) {
  let s = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [xi, yi] = poli[i], [xj, yj] = poli[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) s = !s;
  }
  return s;
}

function descrivi(h) {
  if (h.tipo === "skill") {
    const s = D.skill[h.id];
    return `${esc(h.id)}<span class="meta">${s.chiamate} chiamate · ultimo uso ${quando(s.ultimo)}</span>`;
  }
  if (h.tipo === "infra") {
    const n = abitanti.filter(a => a.s.infra.includes(h.id)).length;
    return `${esc(INFRA[h.id].titolo)}<span class="meta">${n} skill collegate</span>`;
  }
  if (h.tipo === "claude") return `Claude<span class="meta">da qui parte ogni chiamata</span>`;
  const d = M.distretti[h.id];
  return `${esc(d.nome)}<span class="meta">${d.aperto ? "clicca per entrare" : "in costruzione"}</span>`;
}

// ------------------------------------------------------------ input
(function input() {
  const punti = new Map();
  let trascina = null, pinza = null;
  schermo.addEventListener("pointerdown", ev => {
    schermo.setPointerCapture(ev.pointerId);
    punti.set(ev.pointerId, [ev.offsetX, ev.offsetY]);
    if (punti.size === 2) {
      const [a, b] = [...punti.values()];
      pinza = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
      trascina = null;
    } else {
      trascina = { x: ev.offsetX, y: ev.offsetY, cx: S.cam.x, cy: S.cam.y, mosso: false };
    }
  });
  schermo.addEventListener("pointermove", ev => {
    if (punti.has(ev.pointerId)) punti.set(ev.pointerId, [ev.offsetX, ev.offsetY]);
    if (pinza && punti.size === 2) {
      const [a, b] = [...punti.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d / pinza.d > 1.3) { passoZoom(1, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinza.d = d; }
      else if (d / pinza.d < .77) { passoZoom(-1, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinza.d = d; }
      return;
    }
    if (trascina) {
      const dx = ev.offsetX - trascina.x, dy = ev.offsetY - trascina.y;
      if (Math.hypot(dx, dy) > 4) trascina.mosso = true;
      if (trascina.mosso) {
        S.anim = null;
        S.cam.x = clamp(trascina.cx - dx / S.cam.zoom, 0, M.w);
        S.cam.y = clamp(trascina.cy - dy / S.cam.zoom, 0, M.h);
        schermo.classList.add("trascina");
      }
      return;
    }
    const [mx, my] = aMondo(ev.offsetX, ev.offsetY);
    S.hover = cosaC(mx, my);
    const sug = $("#suggerimento");
    if (S.hover && S.hover.tipo !== "distretto") {
      sug.innerHTML = descrivi(S.hover); sug.hidden = false;
      sug.style.left = ev.offsetX + "px"; sug.style.top = ev.offsetY + "px";
    } else sug.hidden = true;
    schermo.classList.toggle("sopra", !!S.hover);
  });
  const fine = ev => {
    punti.delete(ev.pointerId);
    if (punti.size < 2) pinza = null;
    if (trascina && !trascina.mosso && ev.type === "pointerup") {
      const [mx, my] = aMondo(ev.offsetX, ev.offsetY), h = cosaC(mx, my);
      if (h) {
        seleziona(h);
        if (h.tipo === "distretto") inquadraDistretto(h.id);
      }
    }
    trascina = null;
    schermo.classList.remove("trascina");
  };
  schermo.addEventListener("pointerup", fine);
  schermo.addEventListener("pointercancel", fine);
  schermo.addEventListener("pointerleave", () => { S.hover = null; $("#suggerimento").hidden = true; });
  schermo.addEventListener("wheel", ev => {
    ev.preventDefault();
    const ora = performance.now();
    if (ora - (input.ultimaRotella || 0) < 140) return;
    input.ultimaRotella = ora;
    passoZoom(ev.deltaY < 0 ? 1 : -1, ev.offsetX, ev.offsetY);
  }, { passive: false });

  $("#zoom-piu").onclick = () => passoZoom(1);
  $("#zoom-meno").onclick = () => passoZoom(-1);
  $("#zoom-tutto").onclick = () => tuttaLaCitta();
  $("#minimappa").addEventListener("click", ev => {
    const r = ev.currentTarget.getBoundingClientRect(), k = r.width / M.w;
    vaiA((ev.clientX - r.left) / k, (ev.clientY - r.top) / k, S.cam.zoom);
  });
  for (const b of document.querySelectorAll("[data-livello]")) {
    b.onclick = () => {
      const k = b.dataset.livello;
      S.mostra[k] = !S.mostra[k];
      b.setAttribute("aria-pressed", S.mostra[k]);
      if (k === "nomi" && S.mostra.nomi && S.cam.zoom < 1.5) passoZoom(1);
    };
  }
  for (const b of document.querySelectorAll("[data-vista]")) b.onclick = () => vista(b.dataset.vista);
  $("#chiudi").onclick = () => seleziona(null);
  window.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { if (S.scelto) seleziona(null); else if (!$("#registro").hidden) vista("citta"); }
    if (ev.target.closest("input, select, textarea")) return;
    if (ev.key === "+" || ev.key === "=") passoZoom(1);
    if (ev.key === "-") passoZoom(-1);
    if (ev.key === " ") { ev.preventDefault(); $("#play").click(); }
  });
})();

// ------------------------------------------------------------ selezione e pannello
function seleziona(h) {
  S.scelto = h;
  const p = $("#pannello");
  if (!h) { p.hidden = true; aggiornaIndirizzo(); return; }
  const html = h.tipo === "skill" ? schedaSkill(h.id) : h.tipo === "infra" ? schedaInfra(h.id)
    : h.tipo === "distretto" ? schedaDistretto(h.id) : schedaClaude();
  $("#contenuto").innerHTML = html;
  p.hidden = false;
  p.scrollTop = 0;
  for (const b of p.querySelectorAll("[data-skill]")) b.onclick = () => vaiASkill(b.dataset.skill);
  for (const b of p.querySelectorAll("[data-infra]")) b.onclick = () => seleziona({ tipo: "infra", id: b.dataset.infra });
  aggiornaIndirizzo();
}

function vaiASkill(nome) {
  seleziona({ tipo: "skill", id: nome });
  const e = entita[nome];
  if (e) vaiA(e.x, e.y - 14, Math.max(S.cam.zoom, livelli().find(l => l >= 2) || 2));
}

function ritratto(sprite, grande) {
  const n = grande ? 48 : 32;
  return `<canvas class="ritratto" data-sprite="${esc(sprite)}" width="${n}" height="${n}"></canvas>`;
}

function disegnaRitratti(t) {
  for (const c of document.querySelectorAll("canvas.ritratto")) {
    const mo = M.mostri[c.dataset.sprite]; if (!mo) continue;
    const r = mo.frame[frameA(t)], g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(AT, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
  }
  const lg = $("#logo").getContext("2d"), r = M.mostri.claude.frame[frameA(t)];
  lg.clearRect(0, 0, 48, 48); lg.drawImage(AT, r[0], r[1], r[2], r[3], 0, 0, 48, 48);
}

function barreGiorni(giorni) {
  let max = 1, celle = [];
  for (let k = 13; k >= 0; k--) { const g = piuGiorni(OGGI, -k), n = giorni[g] || 0; max = Math.max(max, n); celle.push([g, n]); }
  return `<div class="barre">${celle.map(([g, n]) =>
    `<div class="${n ? "pieno" : ""}" style="height:${n ? 8 + 92 * n / max : 4}%" title="${fmtGiorno(g)}: ${n} chiamate"></div>`).join("")}</div>
    <div class="barre-asse"><span>${fmtGiorno(celle[0][0])}</span><span>oggi</span></div>`;
}

function barraModi(modi) {
  const tot = Object.values(modi).reduce((a, b) => a + b, 0) || 1;
  return `<div class="modi">${Object.entries(MODI).map(([m, c]) => modi[m] ? `<span style="width:${100 * modi[m] / tot}%;background:${c}"></span>` : "").join("")}</div>
    <div class="legenda">${Object.entries(MODI).map(([m, c]) => `<span><i style="--c:${c}"></i>${m} <b>${modi[m] || 0}</b></span>`).join("")}</div>`;
}

function etichettaDistretto(k) {
  if (!k) return `<span class="etichetta-d"><i style="--c:#646a87"></i>Senza quartiere</span>`;
  const d = M.distretti[k];
  return `<span class="etichetta-d"><i style="--c:${d.colore}"></i>${esc(d.nome)}</span>`;
}

function schedaSkill(nome) {
  const s = D.skill[nome], st = statoSkill(s), e = entita[nome];
  const giorniAttivi = Object.keys(s.giorni).length;
  const insieme = Object.entries(s.insieme).sort((a, b) => b[1] - a[1]);
  const maxI = insieme.length ? insieme[0][1] : 1;
  const statoTesto = st === "oggi" ? "al lavoro oggi" : st === "settimana" ? "usata questa settimana" : s.chiamate ? "dorme da più di una settimana" : "dorme: mai usata da quando registro";
  const d = s.distretto && M.distretti[s.distretto];
  return `
    <div class="testa-scheda">${ritratto(e ? e.sprite : "turista")}
      <div><h2>${esc(nome)}</h2>${etichettaDistretto(s.distretto)}<br><span class="stato ${st}">${statoTesto}</span></div></div>
    ${s.cosa_fa ? `<p>${esc(s.cosa_fa)}</p>` : `<p>Questa skill non ha ancora una scheda: arriverà quando costruiremo il suo quartiere.</p>`}
    ${s.oggetto ? `<div class="oggetto">In mano: ${esc(s.oggetto)}</div>` : ""}
    <div class="cifre"><div><b>${s.chiamate}</b><span>chiamate</span></div><div><b>${giorniAttivi}</b><span>giorni d'uso</span></div>
      <div><b>${esc(quando(s.ultimo))}</b><span>ultimo uso</span></div></div>
    <h3>Ultime due settimane</h3>${barreGiorni(s.giorni)}
    <h3>Come la usi</h3>${barraModi(s.modi)}
    ${s.infra.length ? `<h3>Infrastrutture condivise</h3><div class="pillole">${s.infra.map(k =>
      `<button type="button" class="pillola" data-infra="${k}" style="border-color:${INFRA[k].colore}">${esc(INFRA[k].nome)} <small>${esc(INFRA[k].segno)}</small></button>`).join("")}</div>` : ""}
    <h3>Usata insieme a</h3>
    ${insieme.length ? `<div class="lista">${insieme.map(([n, k]) => `<button type="button" class="riga" data-skill="${esc(n)}">
      <span>${esc(n)}</span><span class="n">${k}×</span></button><div class="barretta" style="width:${100 * k / maxI}%"></div>`).join("")}</div>`
      : `<div class="vuoto-msg">Ancora nessuna: finora l'hai usata da sola.</div>`}
    ${s.notion ? `<a class="bottone" href="${esc(s.notion)}" target="_blank" rel="noopener">Apri la scheda in Notion ↗</a>
      <div class="nota">Nella scheda trovi lo zip e il comando per installarla su un altro computer.</div>`
      : d && !d.aperto ? `<div class="nota">Prototipo: il quartiere ${esc(d.nome)} è ancora in costruzione.</div>` : ""}`;
}

function schedaInfra(k) {
  const inf = INFRA[k];
  const membri = abitanti.filter(a => a.s.infra.includes(k)).sort((a, b) => b.s.chiamate - a.s.chiamate);
  const tot = membri.reduce((n, a) => n + a.s.chiamate, 0), max = Math.max(1, ...membri.map(a => a.s.chiamate));
  return `
    <div class="testa-scheda" style="padding-right:30px"><div><h2>${esc(inf.titolo)}</h2>
      <span class="etichetta-d"><i style="--c:${inf.colore}"></i>Infrastruttura condivisa</span></div></div>
    <p>${esc(inf.desc)}</p>
    <div class="oggetto">Segno sui mostriciattoli: ${esc(inf.segno)}</div>
    <div class="cifre"><div><b>${membri.length}</b><span>skill collegate</span></div><div><b>${tot}</b><span>chiamate</span></div>
      <div><b>${membri.filter(a => statoSkill(a.s) === "oggi").length}</b><span>attive oggi</span></div></div>
    <h3>Chi la usa</h3>
    <div class="lista">${membri.map(a => `<button type="button" class="riga" data-skill="${esc(a.nome)}"><span>${esc(a.nome)}</span>
      <span class="n">${a.s.chiamate}</span></button><div class="barretta" style="width:${100 * a.s.chiamate / max}%;background:${inf.colore}"></div>`).join("")}</div>`;
}

function schedaDistretto(k) {
  const d = M.distretti[k];
  const membri = abitanti.filter(a => a.s.distretto === k).sort((a, b) => b.s.chiamate - a.s.chiamate);
  const tot = membri.reduce((n, a) => n + a.s.chiamate, 0), max = Math.max(1, ...membri.map(a => a.s.chiamate));
  const dormono = membri.filter(a => statoSkill(a.s) === "dorme");
  return `
    <div class="testa-scheda" style="padding-right:30px"><div><h2>${esc(d.nome)}</h2>${etichettaDistretto(k)}
      <br><span class="stato ${d.aperto ? "oggi" : "dorme"}">${d.aperto ? "aperto" : "in costruzione"}</span></div></div>
    ${d.aperto ? "" : `<p>Per ora qui c'è solo il prototipo del mostriciattolo. Il quartiere aprirà quando faremo le schede delle sue skill.</p>`}
    <div class="cifre"><div><b>${membri.length}</b><span>skill</span></div><div><b>${tot}</b><span>chiamate</span></div>
      <div><b>${dormono.length}</b><span>dormono</span></div></div>
    <h3>Le skill, dalla più usata</h3>
    <div class="lista">${membri.map(a => `<button type="button" class="riga" data-skill="${esc(a.nome)}"><span>${esc(a.nome)}</span>
      <span class="n">${a.s.chiamate || "—"}</span></button><div class="barretta" style="width:${100 * a.s.chiamate / max}%"></div>`).join("")}</div>`;
}

function schedaClaude() {
  const modi = {}, conta = {};
  for (const [nome, s] of Object.entries(D.skill)) {
    for (const [m, n] of Object.entries(s.modi)) modi[m] = (modi[m] || 0) + n;
    if (s.chiamate) conta[nome] = s.chiamate;
  }
  const top = Object.entries(conta).sort((a, b) => b[1] - a[1]).slice(0, 6), max = top.length ? top[0][1] : 1;
  return `
    <div class="testa-scheda">${ritratto("claude", true)}<div><h2>Claude</h2>
      <span class="etichetta-d"><i style="--c:#d97757"></i>Piazza di Claude</span></div></div>
    <p>Ogni chiamata parte da qui: un comando che digiti, una skill che Claude carica da solo o uno script che lancia.</p>
    <div class="cifre"><div><b>${D.totale}</b><span>chiamate</span></div><div><b>${D.sessioni}</b><span>sessioni</span></div>
      <div><b>${Object.keys(D.giornate).length}</b><span>giorni con usi</span></div></div>
    <h3>Come arrivano le chiamate</h3>${barraModi(modi)}
    <h3>Le più chiamate</h3>
    <div class="lista">${top.map(([n, k]) => `<button type="button" class="riga" data-skill="${esc(n)}"><span>${esc(n)}</span>
      <span class="n">${k}</span></button><div class="barretta" style="width:${100 * k / max}%"></div>`).join("")}</div>
    <div class="nota">Registro dal ${fmtGiorno(D.dal)}: prima di allora le conversazioni di Claude Code non sono più salvate.</div>`;
}

// ------------------------------------------------------------ registro
function vista(v) {
  for (const b of document.querySelectorAll("[data-vista]")) b.setAttribute("aria-pressed", b.dataset.vista === v);
  const r = $("#registro");
  r.hidden = v !== "registro";
  if (v === "registro") registro();
  aggiornaIndirizzo();
}

function registro() {
  const giorni = Object.keys(D.giornate).sort().reverse();
  const usate = Object.values(D.skill).filter(s => s.chiamate).length;
  const dormono = abitanti.filter(a => statoSkill(a.s) === "dorme").sort((a, b) => (a.s.ultimo || "").localeCompare(b.s.ultimo || ""));
  const r = $("#registro");
  r.innerHTML = `
    <h2>Registro</h2>
    <div class="kpi"><div><b>${D.totale}</b><span>chiamate</span></div><div><b>${D.sessioni}</b><span>sessioni</span></div>
      <div><b>${usate}</b><span>skill usate</span></div><div><b>${dormono.length}</b><span>dormono</span></div></div>
    <h3><span>Ultime giornate</span><span>${giorni.length}</span></h3>
    ${giorni.slice(0, 14).map(g => { const d = D.giornate[g]; return `<div class="sessione"><div class="testa">
      <span><b>${g === OGGI ? "oggi" : fmtGiorno(g)}</b> · ${d.sessioni} ${d.sessioni === 1 ? "sessione" : "sessioni"}</span>
      <span>${d.chiamate} ${d.chiamate === 1 ? "chiamata" : "chiamate"}</span></div><div class="pillole">${[...d.ordine].sort((a, b) => b[1] - a[1]).map(([n, c]) =>
        `<button type="button" class="pillola" data-skill="${esc(n)}">${esc(n)}${c > 1 ? `<small>×${c}</small>` : ""}</button>`).join("")}</div></div>`; }).join("")}
    <h3><span>Dormono</span><span>${dormono.length}</span></h3>
    ${dormono.length ? dormono.map(a => `<button type="button" class="riga" data-skill="${esc(a.nome)}"><span>${esc(a.nome)}</span>
      <span class="n">${a.s.ultimo ? "ultimo " + fmtGiorno(a.s.ultimo) : "mai usata"}</span></button>`).join("") : `<div class="vuoto-msg">Nessuna: tutte usate di recente.</div>`}
    <h3><span>Senza quartiere</span><span>${turisti.length}</span></h3>
    <div class="vuoto-msg" style="margin-bottom:6px">Skill usate che non hanno ancora una scheda: girano per la piazza con la valigia.</div>
    ${turisti.map(t => `<button type="button" class="riga" data-skill="${esc(t.nome)}"><span>${esc(t.nome)}</span><span class="n">${t.s.chiamate}</span></button>`).join("")}`;
  for (const b of r.querySelectorAll("[data-skill]")) b.onclick = () => vaiASkill(b.dataset.skill);
}

// ------------------------------------------------------------ replay della giornata
// Nei dati pubblici non ci sono orari: la giornata si rivede nell'ordine in cui le skill
// sono state usate per la prima volta, ognuna con le sue chiamate di quel giorno.
function preparaReplay() {
  const sel = $("#giorno");
  sel.innerHTML = Object.keys(D.giornate).sort().reverse().map(g =>
    `<option value="${g}">${g === OGGI ? "oggi" : fmtGiorno(g)} · ${D.giornate[g].chiamate} usi</option>`).join("");
  sel.onchange = () => { caricaGiorno(sel.value); if (S.replay.attivo) avvia(0); };
  $("#play").onclick = () => {
    const R = S.replay;
    if (!R.attivo || R.i >= R.lotti.length) avvia(0);
    else { R.pausa = !R.pausa; R.prossimo = performance.now(); aggiornaPlay(); }
  };
  $("#esci-replay").onclick = esciReplay;
  for (const b of document.querySelectorAll("[data-v]")) b.onclick = () => {
    S.replay.vel = +b.dataset.v;
    for (const q of document.querySelectorAll("[data-v]")) q.setAttribute("aria-pressed", q === b);
  };
  const linea = $("#linea");
  linea.addEventListener("click", ev => {
    const r = $("#tacche").getBoundingClientRect(), f = clamp((ev.clientX - r.left) / r.width, 0, .999);
    avvia(Math.floor(f * S.replay.lotti.length));
  });
  linea.addEventListener("keydown", ev => {
    if (ev.key === "ArrowRight") { ev.preventDefault(); avvia(Math.min(S.replay.i + 1, S.replay.lotti.length - 1)); }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); avvia(Math.max(S.replay.i - 1, 0)); }
  });
  if (sel.value) caricaGiorno(sel.value);
}

function caricaGiorno(g) {
  const R = S.replay;
  R.giorno = g;
  R.lotti = D.giornate[g].ordine.map(([nome, n]) => ({ nome, n }));
  $("#tacche").innerHTML = R.lotti.map((l, i) =>
    `<div class="tacca" data-i="${i}" style="left:${100 * (i + .5) / R.lotti.length}%" title="${esc(l.nome)} · ${l.n}"></div>`).join("");
  R.i = 0;
  orologio();
}

function avvia(da) {
  const R = S.replay;
  R.attivo = true; R.pausa = false; R.i = da; R.conta = {};
  for (let i = 0; i < da; i++) R.conta[R.lotti[i].nome] = (R.conta[R.lotti[i].nome] || 0) + R.lotti[i].n;
  S.effetti = [];
  R.prossimo = performance.now() + 250;
  $("#feed").innerHTML = "";
  $("#esci-replay").hidden = false;
  aggiornaPlay(); orologio();
}

function esciReplay() {
  const R = S.replay;
  R.attivo = false; R.pausa = true; R.i = 0; R.conta = {};
  S.effetti = [];
  $("#feed").innerHTML = "";
  $("#esci-replay").hidden = true;
  aggiornaPlay(); orologio();
}

function aggiornaPlay() {
  const R = S.replay, suona = R.attivo && !R.pausa && R.i < R.lotti.length;
  $("#play").textContent = suona ? "❚❚" : "▶";
  $("#play").setAttribute("aria-label", suona ? "Pausa" : "Rivedi la giornata");
}

function tickReplay(t) {
  const R = S.replay;
  if (!R.attivo || R.pausa) return;
  if (R.i < R.lotti.length && t >= R.prossimo) {
    lancia(R.i, t);
    R.i++;
    R.prossimo = t + 760 / R.vel;
    orologio();
  }
  if (R.i >= R.lotti.length && !S.effetti.some(f => f.tipo === "messaggero")) { R.pausa = true; aggiornaPlay(); }
}

function lancia(i, t) {
  const R = S.replay, { nome, n } = R.lotti[i], prima = i > 0 ? R.lotti[i - 1].nome : null;
  // se la skill precedente lavora spesso con questa, il messaggero parte da lì; altrimenti dalla piazza
  const legate = prima && D.skill[prima] && D.skill[prima].insieme[nome];
  const da = legate && posizione(prima) ? posizione(prima) : statuaTesta();
  const dur = 720 / R.vel;
  S.effetti.push({ tipo: "messaggero", p0: da, a: nome, p1: posizione(nome) || statuaTesta(), t0: t, dur });
  setTimeout(() => {
    if (!R.attivo) return;
    R.conta[nome] = (R.conta[nome] || 0) + n;
    const ora = performance.now();
    S.effetti.push({ tipo: "salto", nome, t0: ora, dur: 380 });
    S.effetti.push({ tipo: "piu", nome, n, t0: ora, dur: 900 });
  }, dur);
  const f = $("#feed"), el = document.createElement("div");
  el.className = "evento";
  el.innerHTML = `<i></i><span>${esc(nome)}</span><span class="modo">${n} ${n === 1 ? "chiamata" : "chiamate"}</span>`;
  f.prepend(el);
  while (f.children.length > 4) f.lastChild.remove();
}

function orologio() {
  const R = S.replay, g = D.giornate[R.giorno];
  $("#orologio").innerHTML = R.attivo ? `${R.i}/${R.lotti.length} <small>skill</small>` : `<small>${g ? g.chiamate : 0} usi</small>`;
  for (const el of document.querySelectorAll(".tacca")) el.classList.toggle("fatta", R.attivo && +el.dataset.i < R.i);
  const te = $("#testina");
  if (R.attivo && R.i > 0) {
    te.style.display = "block";
    te.style.left = `calc(8px + (100% - 16px) * ${(R.i - .5) / R.lotti.length})`;
  } else te.style.display = "none";
}

// ------------------------------------------------------------ intestazione e indirizzo
function intestazione() {
  const usate = Object.values(D.skill).filter(s => s.chiamate).length;
  const oggi = D.giornate[OGGI] ? D.giornate[OGGI].chiamate : 0;
  $("#numeri").innerHTML = `<span class="vivo"><b>${oggi}</b> chiamate oggi</span><span><b>${D.totale}</b> dal ${fmtGiorno(D.dal)}</span>
    <span><b>${usate}</b> skill usate</span><span><b>${abitanti.length}</b> abitanti</span>`;
  $("#aggiornato").textContent = `dati del ${fmtGiorno(OGGI)} alle ${oraDi(D.aggiornato)}`;
}

function aggiornaIndirizzo() {
  const h = S.scelto;
  let a = "";
  if (h && h.tipo === "skill") a = "#skill=" + encodeURIComponent(h.id);
  else if (h && h.tipo === "distretto") a = "#" + h.id;
  else if (!$("#registro").hidden) a = "#registro";
  history.replaceState(null, "", a || location.pathname + location.search);
}

function daIndirizzo() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("skill=") && entita[h.slice(6)]) {
    const e = entita[h.slice(6)];
    seleziona({ tipo: "skill", id: e.nome });
    dimensiona();
    vaiA(e.x, e.y - 14, livelli().find(l => l >= 2) || 2, true);
  } else if (M.distretti[h]) {
    inquadraDistretto(h, true);        // solo l'inquadratura: negli embed stretti il pannello coprirebbe la mappa
  } else {
    if (h === "registro") vista("registro");
    tuttaLaCitta(true);
  }
}

carica().catch(err => {
  scena.innerHTML = `<p style="padding:24px;color:#9a9fb8">La città non si è caricata: ${esc(err.message)}</p>`;
  console.error(err);
});
