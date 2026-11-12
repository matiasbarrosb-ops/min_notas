/* =====================================================================
   Mis Notas — app general con catálogo compartido de ramos
   - Modo nube: Supabase (cuentas + base de datos) + /api/extraer (IA en Vercel)
   - Modo demo: todo en este navegador (si config.js no tiene Supabase)
   ===================================================================== */
const CFG = window.APP_CONFIG || {};
const APROB = 3.95;
const $ = id => document.getElementById(id);
window.$ = $;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (x, a = 1, b = 7) => Math.max(a, Math.min(b, x));
const fmt = x => x == null || isNaN(x) ? '—' : (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
const fmt2 = x => (Math.round(x * 100) / 100).toString().replace('.', ',');
const parseG = s => { s = String(s).trim().replace(',', '.'); if (s === '') return null; let v = +s; if (isNaN(v)) return NaN; if (v >= 10 && v <= 70) v = v / 10; return v; };
const normSigla = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/-\d+$/, '');
const normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['de','la','el','y','a','en','del','los','las','para','i','ii','iii','introduccion']);
function similitud(a, b) { const A = new Set(normTxt(a).split(' ').filter(w => w && !STOP.has(w))), B = new Set(normTxt(b).split(' ').filter(w => w && !STOP.has(w))); if (!A.size || !B.size) return 0; let n = 0; A.forEach(w => B.has(w) && n++); return n / Math.min(A.size, B.size); }
function toast(m) { const t = $('toast'); t.textContent = m; t.style.opacity = 1; clearTimeout(toast._t); toast._t = setTimeout(() => t.style.opacity = 0, 2600); }
const uid = () => Math.random().toString(36).slice(2, 10);

/* ============================================================ BACKEND */
let MODE = (CFG.supabaseUrl && CFG.supabaseAnonKey) ? 'cloud' : 'demo';
let sb = null, USER = null;
let CATALOGO = [];      // [{id,sigla,nombre,universidad,periodo,carrera,fuente,def,creado_por,created_at}]
let MIS = [];           // [{ramo_id,notas,opts,override}]
let OFFLINE = false;
const cacheKey = () => 'notasapp.cache.' + (USER?.id || 'x');
function guardarCache() { if (MODE !== 'cloud') return; try { localStorage.setItem(cacheKey(), JSON.stringify({ CATALOGO, MIS, t: Date.now() })); } catch (e) { } }
function leerCache() { try { return JSON.parse(localStorage.getItem(cacheKey()) || 'null'); } catch (e) { return null; } }
const PEND = new Set(); // ramos con cambios sin guardar (sin conexión)

const demo = {
  key: 'notasapp.demo.v1',
  st: null,
  load() { try { this.st = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { } if (!this.st) this.st = { extra: [], mis: [] }; return this.st; },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.st)); } catch (e) { } }
};

const api = {
  async init() {
    if (MODE === 'cloud') {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      const { data } = await sb.auth.getSession();
      USER = data.session?.user || null;
      sb.auth.onAuthStateChange((_e, s) => { const was = USER?.id; USER = s?.user || null; if (was !== USER?.id) boot(); });
    } else {
      demo.load(); USER = { id: 'demo', email: 'demo' };
      // Importar notas de la versión anterior de la página (si existen en este navegador)
      try {
        const old = JSON.parse(localStorage.getItem('misnotas.v1') || 'null');
        if (old && old.ramos && !demo.st.mis.length && !demo.st.importado) {
          old.ramos.forEach(r => { if (!r.sigla) return; demo.st.mis.push({ ramo_id: 'seed-' + normSigla(r.sigla) + '-2026-2', notas: (old.notas || {})[r.id] || {}, opts: (old.opts || {})[r.id] || { meta: APROB }, override: null }); });
          demo.st.importado = true; demo.save();
        }
      } catch (e) { }
    }
  },
  async loadCatalogo() {
    if (MODE === 'cloud') {
      const { data, error } = await sb.from('ramos').select('*').order('sigla');
      if (error) throw error; CATALOGO = data;
    } else {
      let seed = [];
      try { seed = await (await fetch('catalogo.json')).json(); } catch (e) { }
      CATALOGO = [...seed.map((r, i) => ({ ...r, id: 'seed-' + normSigla(r.sigla) + '-' + (r.periodo || ''), creado_por: null, created_at: '2026-11-12' })), ...demo.st.extra];
    }
  },
  async loadMis() {
    if (MODE === 'cloud') {
      const { data, error } = await sb.from('inscripciones').select('*'); if (error) throw error; MIS = data;
    } else { demo.st.mis = demo.st.mis.filter(m => CATALOGO.some(c => c.id === m.ramo_id)); MIS = demo.st.mis; }
  },
  async inscribir(ramo_id) {
    const row = { ramo_id, notas: {}, opts: { meta: APROB }, override: null };
    if (MODE === 'cloud') { const { data, error } = await sb.from('inscripciones').insert({ ...row, user_id: USER.id }).select().single(); if (error) throw error; MIS.push(data); }
    else { MIS.push(row); demo.save(); }
  },
  async desinscribir(ramo_id) {
    if (MODE === 'cloud') { const { error } = await sb.from('inscripciones').delete().eq('ramo_id', ramo_id).eq('user_id', USER.id); if (error) throw error; }
    MIS = MIS.filter(m => m.ramo_id !== ramo_id); if (MODE === 'demo') { demo.st.mis = MIS; demo.save(); }
  },
  _t: {},
  guardar(ramo_id) { // con debounce
    clearTimeout(this._t[ramo_id]);
    this._t[ramo_id] = setTimeout(async () => {
      const m = MIS.find(x => x.ramo_id === ramo_id); if (!m) return;
      if (MODE === 'cloud') {
        guardarCache();
        try { const { error } = await sb.from('inscripciones').update({ notas: m.notas, opts: m.opts, override: m.override }).eq('ramo_id', ramo_id).eq('user_id', USER.id); if (error) throw error; PEND.delete(ramo_id); }
        catch (e) { PEND.add(ramo_id); if (!navigator.onLine) { OFFLINE = true; drawHeader(); } else toast('No se pudo guardar: ' + e.message); }
      }
      else demo.save();
    }, 500);
  },
  async crearRamo(r) {
    if (MODE === 'cloud') {
      const { data, error } = await sb.from('ramos').insert({ sigla: r.sigla, nombre: r.nombre, universidad: r.universidad, periodo: r.periodo, carrera: r.carrera, fuente: r.fuente, def: r.def }).select().single();
      if (error) throw error; CATALOGO.push(data); return data;
    }
    const row = { ...r, id: 'u-' + uid(), creado_por: 'demo', created_at: new Date().toISOString() };
    demo.st.extra.push(row); demo.save(); CATALOGO.push(row); return row;
  },
  async buscarDuplicados(sigla, nombre) {
    const s = normSigla(sigla);
    return CATALOGO.filter(c => (s && normSigla(c.sigla) === s) || similitud(c.nombre, nombre) >= 0.75)
      .map(c => ({ ...c, motivo: normSigla(c.sigla) === s ? 'Misma sigla' : 'Nombre parecido' }));
  },
  async extraer(payload) { // payload: {tipo:'pdf',data,base64} | {tipo:'texto',texto}
    if (MODE === 'cloud') {
      const { data } = await sb.auth.getSession();
      const res = await fetch(CFG.apiUrl || '/api/extraer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token || '') }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || ('Error ' + res.status));
      return j.ramo;
    }
    // demo: usa la IA del entorno de Claude si está disponible
    const sample = window.claude ? await window.claude.use('sample') : null;
    if (!sample) throw new Error('La lectura con IA se activa cuando la página esté publicada en Vercel. Mientras tanto, usa "A mano".');
    let texto = payload.texto;
    if (payload.tipo === 'pdf') texto = payload.textoPdf;
    const out = await sample.json(PROMPT_EXTRAER + '\n\n<programa>\n' + texto.slice(0, 60000) + '\n</programa>', { modelTier: 'default' });
    return out;
  },
  async login(email) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
  },
  async logout() { await sb.auth.signOut(); }
};

/* Instrucciones para la IA (la misma lógica está en api/extraer.js) */
const PROMPT_EXTRAER = `Eres un asistente que convierte el programa de un ramo universitario chileno (escala de notas 1,0 a 7,0; se aprueba con 3,95) en JSON para una calculadora de notas.
Devuelve SOLO un objeto JSON con esta forma:
{"sigla":"MAT1630","nombre":"Cálculo III","periodo":"2026-2","combinacion":"ponderado"|"minimos",
 "eximicion":null|{"parte":"np","umbral":5.5,"sinRojos":false},
 "partes":[{"id":"p","nombre":"Nota final","peso":1,"minimo":null,
   "items":[{"id":"i1","nombre":"Interrogación 1","peso":0.2,"fecha":"2026-09-08"|null,"examen":false,"reemplazable":false,
     "sub":null|[{"id":"c1","nombre":"Control 1","fecha":null}]}]}],
 "reglas":["frases cortas con reglas importantes"],"dudas":["lo que no quedó claro"]}
Reglas:
- Los pesos de los items DENTRO de cada parte suman 1. Los pesos de las partes suman 1.
- Usa UNA parte si la nota final es un promedio ponderado simple. Usa varias partes con "combinacion":"minimos" cuando hay componentes que se aprueban por separado (ej. cátedra y laboratorio, o nota de presentación y examen reprobatorio); pon "minimo":3.95 en las partes que exigen nota mínima.
- Si el examen es reprobatorio, ponlo en su propia parte (id "exp") con minimo 3.95, y la nota de presentación en otra parte (id "np").
- Marca "examen":true en el examen final. "reemplazable":true en evaluaciones que, si se faltan justificadamente, se reemplazan por el examen.
- Usa "sub" cuando una evaluación es el promedio de varias (ej. controles); en ese caso el item padre tiene el peso y los sub no tienen peso.
- Si hay eximición, completa "eximicion" con el id de la parte de presentación y el umbral numérico; "sinRojos":true si exige no tener notas bajo 4,0.
- Fechas en formato AAAA-MM-DD solo si aparecen; si no, null.
- Si algo no está en el programa, NO lo inventes: pon tu mejor supuesto y explícalo en "dudas".
- Escribe en español.`;

/* ============================================================ ACCESO A DATOS DEL USUARIO */
function M(rid) { return MIS.find(m => m.ramo_id === rid); }
function N(rid) { const m = M(rid); return m ? (m.notas || (m.notas = {})) : {}; }
function O(rid) { const m = M(rid); if (!m) return { meta: APROB }; return m.opts || (m.opts = { meta: APROB }); }
function getG(rid, i) { const v = N(rid)[i]; return (v == null || v === '') ? null : +v; }
function setG(rid, i, v) { if (v == null || v === '' || isNaN(v)) delete N(rid)[i]; else N(rid)[i] = v; api.guardar(rid); }
function ramo(rid) { const c = CATALOGO.find(x => x.id === rid); if (!c) return null; const m = M(rid); const def = (m && m.override) || c.def; return { id: c.id, sigla: c.sigla, nombre: c.nombre, fuente: c.fuente, periodo: c.periodo, carrera: c.carrera, creado_por: c.creado_por, editado: !!(m && m.override), ...def }; }
const misRamos = () => MIS.map(m => ramo(m.ramo_id)).filter(Boolean);

/* ============================================================ MOTOR DE CÁLCULO */
function allItems(r) { const out = []; r.partes.forEach(p => p.items.forEach(it => { out.push(it); (it.sub || []).forEach(s => out.push(s)); })); return out; }
function examItem(r) { for (const p of r.partes) for (const it of p.items) if (it.examen) return { p, it }; return null; }
function itemVal(r, it, fill, exVal) {
  const o = O(r.id);
  if (o['just_' + it.id] && it.reemplazable && exVal != null) return exVal;
  if (it.sub && it.sub.length) {
    const vals = it.sub.map(s => { const g = getG(r.id, s.id); return g != null ? g : fill(s); }).filter(v => v != null);
    if (!vals.length) return null;
    let a = vals.reduce((x, y) => x + y, 0) / vals.length;
    if (it.bono && o['bono_' + it.bono.id]) a += it.bono.valor;
    return clamp(a);
  }
  const g = getG(r.id, it.id); return g != null ? g : fill(it);
}
function compute(r, fill, noExim) {
  const ex = examItem(r);
  let exVal = null; if (ex) { const g = getG(r.id, ex.it.id); exVal = g != null ? g : fill(ex.it); }
  const partes = r.partes.map(p => {
    let sw = 0, s = 0;
    p.items.forEach(it => { const v = itemVal(r, it, fill, exVal); if (v != null) { s += v * it.peso; sw += it.peso; } });
    if (!sw) return { p, val: null };
    let val = s / sw; if (p.bonoParte && O(r.id)['bono_' + p.bonoParte.id]) val = clamp(val + p.bonoParte.valor);
    return { p, val, completo: Math.abs(sw - p.items.reduce((a, b) => a + b.peso, 0)) < 1e-9 };
  });
  const known = partes.filter(x => x.val != null);
  if (!known.length) return { final: null, partes };
  let final;
  const pond = () => { const sw = known.reduce((a, x) => a + x.p.peso, 0); return known.reduce((a, x) => a + x.val * x.p.peso, 0) / sw; };
  if (r.combinacion === 'minimos') { const fail = known.filter(x => x.p.minimo != null && x.val < x.p.minimo); final = fail.length ? Math.min(...fail.map(x => x.val)) : pond(); }
  else final = pond();
  let eximido = false;
  if (!noExim && r.eximicion && ex && getG(r.id, ex.it.id) == null) {
    const np = partes.find(x => x.p.id === r.eximicion.parte);
    if (np && np.val != null && np.completo && Math.round(np.val * 100) / 100 >= r.eximicion.umbral - 1e-9) {
      const rojos = r.eximicion.sinRojos && np.p.items.some(it => { const v = itemVal(r, it, fill, exVal); return v != null && v < APROB; });
      if (!rojos) { eximido = true; final = np.val; }
    }
  }
  return { final, partes, eximido };
}
const actual = r => compute(r, () => null);
function supuesto(r) { const o = O(r.id); if (o.sup != null) return o.sup; const a = actual(r).final; return a != null ? Math.round(a * 10) / 10 : 4.0; }
function proyeccion(r, exNota, noExim) { const sup = supuesto(r), ex = examItem(r); return compute(r, it => ex && it === ex.it ? exNota : sup, noExim).final; }
function necesaria(r, meta) {
  const ex = examItem(r); if (!ex) return { tipo: 'sinexamen' };
  if (getG(r.id, ex.it.id) != null) return { tipo: 'rendido' };
  { const sup = supuesto(r), c = compute(r, it => it === ex.it ? 1 : sup); if (c.eximido && c.final >= meta - 1e-9) return { tipo: 'eximido', np: c.final }; }
  const f = x => proyeccion(r, x);
  if (f(1) >= meta - 1e-9) return { tipo: 'ya', val: 1 };
  if (f(7) < meta - 1e-9) return { tipo: 'imposible', max: f(7) };
  let lo = 1, hi = 7; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) >= meta) hi = m; else lo = m; }
  let v = Math.ceil(hi * 10 - 1e-6) / 10; while (v < 7 && f(v) < meta - 1e-9) v = Math.round((v + .1) * 10) / 10;
  return { tipo: 'ok', val: v };
}
function paraEximir(r) {
  if (!r.eximicion) return null; const ex = examItem(r); if (!ex || getG(r.id, ex.it.id) != null) return null;
  const np = r.partes.find(p => p.id === r.eximicion.parte); if (!np) return null;
  const pend = []; np.items.forEach(it => { if (it.sub && it.sub.length) it.sub.forEach(s => { if (getG(r.id, s.id) == null) pend.push(s); }); else if (getG(r.id, it.id) == null) pend.push(it); });
  if (!pend.length) return null;
  const g = v => compute(r, it => pend.includes(it) ? v : null).partes.find(x => x.p === np).val;
  const um = r.eximicion.umbral;
  if (g(7) < um - 1e-9) return { imposible: true };
  let lo = 1, hi = 7; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (g(m) >= um) hi = m; else lo = m; }
  let v = Math.max(r.eximicion.sinRojos ? 4 : 1, Math.ceil(hi * 10 - 1e-6) / 10); while (v < 7 && g(v) < um - 1e-9) v = Math.round((v + .1) * 10) / 10;
  return { val: v, n: pend.length };
}
function necesariaResto(r, meta) { // sin examen: promedio que necesitas en lo que falta
  const pend = allItems(r).filter(it => !(it.sub && it.sub.length) && getG(r.id, it.id) == null);
  if (!pend.length) return null;
  const f = v => compute(r, it => pend.includes(it) ? v : null).final;
  if (f(1) >= meta - 1e-9) return { val: 1, n: pend.length };
  if (f(7) < meta - 1e-9) return { imposible: true, max: f(7), n: pend.length };
  let lo = 1, hi = 7; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) >= meta) hi = m; else lo = m; }
  let v = Math.ceil(hi * 10 - 1e-6) / 10; while (v < 7 && f(v) < meta - 1e-9) v = Math.round((v + .1) * 10) / 10;
  return { val: v, n: pend.length };
}
function estado(r) {
  const a = actual(r).final, n = necesaria(r, APROB);
  if (a == null) return { cls: 'neutral', ic: '○', txt: 'Sin notas' };
  if (n.tipo === 'rendido') return a >= APROB ? { cls: 'good', ic: '✓', txt: 'Aprobado' } : { cls: 'bad', ic: '✕', txt: 'Reprobado' };
  if (n.tipo === 'eximido') return { cls: 'good', ic: '✓', txt: 'Rumbo a eximirse' };
  if (n.tipo === 'sinexamen') { const q = necesariaResto(r, APROB); if (!q) return a >= APROB ? { cls: 'good', ic: '✓', txt: 'Aprobado' } : { cls: 'bad', ic: '✕', txt: 'Reprobado' }; if (q.imposible) return { cls: 'bad', ic: '✕', txt: 'En riesgo' }; return q.val <= 4 ? { cls: 'good', ic: '✓', txt: 'Vas bien' } : q.val <= 5.5 ? { cls: 'warn', ic: '!', txt: 'Atento' } : { cls: 'bad', ic: '✕', txt: 'En riesgo' }; }
  if (n.tipo === 'ya' || (n.tipo === 'ok' && n.val <= 4)) return { cls: 'good', ic: '✓', txt: 'Vas bien' };
  if (n.tipo === 'ok' && n.val <= 5.5) return { cls: 'warn', ic: '!', txt: 'Atento' };
  return { cls: 'bad', ic: '✕', txt: 'En riesgo' };
}
function msgNec(n, meta, r) {
  if (r && actual(r).final == null) return { num: '—', msg: 'Ingresa tus notas para calcular cuánto necesitas.' };
  if (r && r.combinacion === 'minimos' && n.tipo === 'imposible') { const f = actual(r).partes.find(x => x.val != null && x.p.minimo != null && x.val < x.p.minimo && !x.p.items.some(i => i.examen)); if (f) return { num: '✕', msg: `${esc(f.p.nombre)} está en ${fmt(f.val)} y necesita ≥ ${fmt2(f.p.minimo)} por separado.` }; }
  if (n.tipo === 'sinexamen') {
    const q = necesariaResto(r, meta);
    if (!q) return { num: fmt(actual(r).final), msg: 'Nota final con todas tus notas.' };
    if (q.imposible) return { num: '>7', msg: `Ni con 7,0 en lo que falta llegas a ${fmt(meta)}.` };
    return { num: fmt(q.val), msg: `Promedio que necesitas en ${q.n === 1 ? 'la evaluación que falta' : 'las ' + q.n + ' evaluaciones que faltan'} para terminar con ${fmt(meta)}.` };
  }
  if (n.tipo === 'rendido') return { num: '✓', msg: 'Ya ingresaste la nota del examen.' };
  if (n.tipo === 'eximido') return { num: 'Eximido', msg: `Con nota de presentación ${fmt(n.np)} te eximes del examen (suponiendo lo que falta).` };
  if (n.tipo === 'ya') return { num: '1,0', msg: `Con lo que llevas, llegas a ${fmt(meta)} aunque te saques un 1,0.` };
  if (n.tipo === 'imposible') return { num: '>7', msg: `Ni con un 7,0 llegas a ${fmt(meta)} (máximo posible ${fmt(n.max)}).` };
  return { num: fmt(n.val), msg: `Necesitas al menos esto en el examen para terminar con ${fmt(meta)}.` };
}
function proxima(r) { const hoy = new Date().toISOString().slice(0, 10); return allItems(r).filter(it => it.fecha && it.fecha >= hoy && getG(r.id, it.id) == null).sort((a, b) => a.fecha < b.fecha ? -1 : 1)[0]; }
const fdate = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd}/${+m}`; };
function diasHasta(d) { return Math.round((new Date(d + 'T12:00') - new Date(new Date().toISOString().slice(0, 10) + 'T12:00')) / 864e5); }
const porConfirmar = r => (r.dudas && r.dudas.length) || r.porConfirmar;

/* ============================================================ NAVEGACIÓN */
const app = $('app');
window.go = h => { if (location.hash.slice(1) === h) render(); else location.hash = h || ''; if (!h) render(); };
window.addEventListener('hashchange', render);
function render() {
  const tb = $('tbHome'); if (tb) tb.classList.toggle('on', !location.hash.slice(1));
  if (!USER) return renderLogin();
  const h = location.hash.slice(1);
  const m = MIS.find(x => 'ramo-' + x.ramo_id === h);
  m && ramo(m.ramo_id) ? renderRamo(ramo(m.ramo_id)) : renderHome();
}
function drawHeader() {
  $('hdr').innerHTML = USER ? `<button class="btn primary hide-m" onclick="openCatalogo()">＋ Agregar ramo</button>
    ${MODE === 'cloud' ? `<button class="btn ghost" onclick="salir()" title="${esc(USER.email)}">Salir</button>` : ''}
    <button class="btn hide-m" onclick="toggleTheme()">Tema</button>` : `<button class="btn" onclick="toggleTheme()">Tema</button>`;
  $('tabbar').style.visibility = USER ? 'visible' : 'hidden';
  $('banner').innerHTML = (OFFLINE ? `<div class="offline">Sin conexión: estás viendo tus últimas notas guardadas. Lo que cambies se guardará cuando vuelva internet.</div>` : '') + installHTML() + (MODE === 'demo' ? `<div class="banner"><b>Modo demo:</b> tus ramos y notas se guardan solo en este navegador. Cuando la página esté en Vercel + Supabase, cada persona tendrá su cuenta y el catálogo será compartido.</div>` : '');
}
window.toggleTheme = () => { const d = document.documentElement; const cur = d.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); d.dataset.theme = cur === 'dark' ? 'light' : 'dark'; pintarBarra(); try { localStorage.setItem('notasapp.theme', d.dataset.theme); } catch (e) { } render(); };
window.salir = async () => { await api.logout(); };

/* ============================================================ LOGIN */
let LOGIN_MODO = 'entrar';
function renderLogin() {
  const crear = LOGIN_MODO === 'crear';
  app.innerHTML = `<div class="card login">
    <h2 style="margin:0 0 6px;font-size:22px">${crear ? 'Crea tu cuenta' : 'Entra a Mis Notas'}</h2>
    <p style="color:var(--text-2);margin:0 0 16px">Agrega tus ramos, pon tus notas y ve cuánto necesitas en el examen.</p>
    <div class="seg" style="margin-bottom:14px"><button class="${!crear ? 'on' : ''}" onclick="setLoginModo('entrar')">Entrar</button><button class="${crear ? 'on' : ''}" onclick="setLoginModo('crear')">Crear cuenta</button></div>
    <form onsubmit="event.preventDefault();enviarLogin()">
      <div class="field"><label>Tu correo</label><input id="email" type="email" required placeholder="nombre@uc.cl" autocomplete="email"></div>
      <div class="field"><label>Contraseña${crear ? ' (mínimo 6 caracteres)' : ''}</label><input id="pass" type="password" required minlength="6" autocomplete="${crear ? 'new-password' : 'current-password'}"></div>
      <button class="btn primary" style="width:100%" id="btnLogin">${crear ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
    <div id="loginMsg" class="note"></div>
    ${!crear ? `<div class="note"><a href="#" onclick="linkPorCorreo();return false">Olvidé mi contraseña / entrar con un link por correo</a></div>` : ''}</div>`;
}
window.setLoginModo = m => { LOGIN_MODO = m; renderLogin(); };
const traducir = m => /invalid login/i.test(m) ? 'Correo o contraseña incorrectos.' : /already registered|already exists/i.test(m) ? 'Ese correo ya tiene cuenta: usa "Entrar".' : /rate limit/i.test(m) ? 'Se enviaron demasiados correos. Espera un rato e intenta de nuevo.' : /not confirmed/i.test(m) ? 'Falta confirmar tu correo: revisa tu bandeja de entrada.' : m;
window.enviarLogin = async () => {
  const email = $('email').value.trim(), password = $('pass').value, b = $('btnLogin'); b.disabled = true;
  try {
    if (LOGIN_MODO === 'crear') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) $('loginMsg').innerHTML = `Te mandamos un correo a <b>${esc(email)}</b> para confirmar tu cuenta.`;
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
    }
  } catch (e) { $('loginMsg').innerHTML = `<div class="errbox">${esc(traducir(e.message))}</div>`; }
  b.disabled = false;
};
window.linkPorCorreo = async () => {
  const email = $('email').value.trim(); if (!email) { $('loginMsg').innerHTML = '<div class="errbox">Escribe tu correo arriba primero.</div>'; return; }
  try { await api.login(email); $('loginMsg').innerHTML = `Te mandamos un link a <b>${esc(email)}</b>. Al entrar, puedes seguir usando la app.`; }
  catch (e) { $('loginMsg').innerHTML = `<div class="errbox">${esc(traducir(e.message))}</div>`; }
};

/* ============================================================ INICIO */
function renderHome() {
  const rs = misRamos();
  if (!rs.length) {
    app.innerHTML = `<div class="card" style="text-align:center;padding:40px 20px">
      <div style="font-size:34px">📚</div><h2 style="margin:8px 0 6px">Agrega tus ramos</h2>
      <p style="color:var(--text-2);max-width:460px;margin:0 auto 16px">Búscalos en el catálogo que arma la comunidad. Si tu ramo no está, lo creas a mano, dictándolo o subiendo el PDF del programa.</p>
      <button class="btn primary" onclick="openCatalogo()">＋ Agregar ramo</button></div>`;
    return;
  }
  const proms = rs.map(r => actual(r).final).filter(x => x != null);
  const prom = proms.length ? proms.reduce((a, b) => a + b, 0) / proms.length : null;
  const riesgo = rs.filter(r => estado(r).cls === 'bad').length;
  const prox = rs.map(r => ({ r, it: proxima(r) })).filter(x => x.it).sort((a, b) => a.it.fecha < b.it.fecha ? -1 : 1)[0];
  app.innerHTML = `
  <div class="overview">
    <div class="card stat"><div class="lbl">Ramos</div><div class="val">${rs.length}</div></div>
    <div class="card stat"><div class="lbl">Promedio actual</div><div class="val">${fmt(prom)}</div></div>
    <div class="card stat"><div class="lbl">Ramos en riesgo</div><div class="val">${riesgo}</div></div>
    <div class="card stat"><div class="lbl">Próxima evaluación</div><div class="val sm">${prox ? `${esc(prox.it.nombre)}<br><span style="color:var(--muted);font-weight:500">${esc(prox.r.nombre)} · ${fdate(prox.it.fecha)}</span>` : '—'}</div></div>
  </div>
  <h2 class="section">Tus ramos</h2>
  <div class="grid">${rs.map(cardRamo).join('')}
    <div class="card course-card" style="align-items:center;justify-content:center;border-style:dashed;min-height:180px;color:var(--text-2)" onclick="openCatalogo()">
      <div style="font-size:26px">＋</div><div style="font-weight:600">Agregar ramo</div><div style="font-size:12.5px;color:var(--muted)">Del catálogo, a mano, por voz o PDF</div></div>
  </div>
  <div class="card chart-card" style="margin-top:16px"><h3>Promedio actual por ramo</h3><div class="sub">Con las notas que llevas. La línea marca 3,95 (aprobación).</div><div id="chHome"></div></div>`;
  barChart($('chHome'), rs.map(r => ({ label: r.sigla, full: r.nombre, v: actual(r).final })), { ref: APROB });
}
function cardRamo(r) {
  const a = actual(r).final, n = necesaria(r, APROB), e = estado(r), p = proxima(r), m = msgNec(n, APROB, r);
  const d = p ? diasHasta(p.fecha) : 0;
  return `<div class="card course-card" onclick="go('ramo-${r.id}')">
    <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap">
      <div><div class="sigla">${esc(r.sigla)}</div><div class="cname">${esc(r.nombre)}</div>${porConfirmar(r) ? '<div class="tag-conf">Revisar ponderaciones</div>' : ''}</div>
      <span class="pill ${e.cls}" style="white-space:nowrap">${e.ic} ${e.txt}</span></div>
    <div class="stats"><div class="stat"><div class="lbl">Promedio actual</div><div class="val">${fmt(a)}</div></div>
      <div class="stat"><div class="lbl">${examItem(r) ? 'Necesitas en el examen' : 'Necesitas en lo que falta'}</div><div class="val">${m.num}</div></div></div>
    <div class="next">${p ? `Próxima: <b>${esc(p.nombre)}</b> · ${fdate(p.fecha)} (${d === 0 ? 'hoy' : d === 1 ? 'mañana' : 'en ' + d + ' días'})` : 'Sin evaluaciones pendientes con fecha'}</div></div>`;
}

/* ============================================================ DETALLE DEL RAMO */
let EDIT = false;
function renderRamo(r) {
  const o = O(r.id), meta = o.meta || APROB;
  const res = actual(r), n = necesaria(r, meta), m = msgNec(n, meta, r), e = estado(r), exA = examItem(r), ex = paraEximir(r);
  app.innerHTML = `
  <button class="btn ghost back-btn" style="margin-bottom:12px" onclick="go('')">← Mis ramos</button>
  <div class="detail-head">
    <div><div class="sigla">${esc(r.sigla)}${r.periodo ? ' · ' + esc(r.periodo) : ''}</div><h2>${esc(r.nombre)}</h2><span class="pill ${e.cls}">${e.ic} ${e.txt}</span></div>
    <div class="row"><button class="btn" onclick="toggleEdit()">${EDIT ? 'Listo' : 'Editar ponderaciones'}</button>
      <button class="btn ghost" onclick="borrarNotas('${r.id}')">Borrar notas</button>
      <button class="btn ghost danger" onclick="quitarRamo('${r.id}')">Quitar ramo</button></div>
  </div>
  ${r.dudas && r.dudas.length ? `<div class="warnbox"><b>Por confirmar:</b> ${r.dudas.map(esc).join(' · ')}</div>` : ''}
  ${r.editado ? `<div class="infobox">Estás usando tus propias ponderaciones para este ramo. <a href="#" onclick="restaurar('${r.id}');return false">Volver a las del catálogo</a></div>` : ''}
  <div class="det">
    <div class="card a-tabla">${r.partes.map(p => parteHTML(r, p, res)).join('')}
      <div class="note">Escribe notas de 1,0 a 7,0 (también sirve "45" para 4,5). Se guardan solas.</div></div>
      <div class="card a-res">
        <div class="result-big"><div style="font-size:12.5px;color:var(--muted);font-weight:500">${exA ? 'Nota necesaria en el examen' : (necesariaResto(r, meta) ? 'Necesitas en lo que falta' : 'Nota final')}</div>
          <div class="num">${m.num}</div><div class="msg">${m.msg}</div>
          ${ex ? `<div class="msg" style="border-top:1px solid var(--line);padding-top:6px;margin-top:4px">${ex.imposible ? 'Ya no alcanza la eximición.' : `Para eximirte necesitas promedio <b>${fmt(ex.val)}</b> en ${ex.n === 1 ? 'la evaluación' : 'las ' + ex.n + ' evaluaciones'} que faltan de la nota de presentación.`}</div>` : ''}</div>
        <div class="stats" style="margin-top:12px">
          <div class="stat"><div class="lbl">Promedio actual</div><div class="val">${fmt(res.final)}</div></div>
          <div class="stat"><div class="lbl">Nota final proyectada</div><div class="val">${res.final == null ? '—' : fmt(exA && getG(r.id, exA.it.id) == null && n.tipo === 'ok' ? proyeccion(r, n.val) : compute(r, () => supuesto(r)).final)}</div></div></div>
        <div class="ctrl"><label>Quiero terminar con</label>
          <div class="seg">${[APROB, 5, 5.5, 6].map(v => `<button class="${Math.abs(meta - v) < 1e-9 ? 'on' : ''}" onclick="setOpt('${r.id}','meta',${v})">${v === APROB ? 'Aprobar' : fmt(v)}</button>`).join('')}</div></div>
        <div class="ctrl"><label for="sup">Para lo que falta (sin nota aún), supongo un <b id="supv">${fmt(supuesto(r))}</b></label>
          <input id="sup" type="range" min="1" max="7" step=".1" value="${supuesto(r)}" oninput="$('supv').textContent=fmtG(+this.value)" onchange="setOpt('${r.id}','sup',+this.value)">
          <div class="note">Por defecto es tu promedio actual. ${o.sup != null ? `<a href="#" onclick="setOpt('${r.id}','sup',null);return false">Volver al promedio</a>` : ''}</div></div>
      </div>
    <div class="a-extra">
      <div class="card chart-card"><h3>Tus notas</h3><div class="sub">Cada evaluación con nota. Línea: 3,95.</div><div id="chNotas"></div></div>
      ${exA ? `<div class="card chart-card"><h3>¿Cómo termino según el examen?</h3><div class="sub">Nota final si rindes el examen, según lo que te saques (lo demás que falte = ${fmt(supuesto(r))}).</div><div id="chCurva"></div></div>` : ''}
      <div class="card"><h3 style="margin:0 0 6px;font-size:14px">Reglas del ramo</h3><ul class="rules">${(r.reglas || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li>Sin reglas registradas.</li>'}</ul>
        <div class="note">Fuente: ${esc(r.fuente || '—')}${r.creado_por ? ' · agregado por la comunidad' : ''}</div></div>
    </div></div>`;
  const pts = []; r.partes.forEach(p => p.items.forEach(it => {
    if (it.sub && it.sub.length) it.sub.forEach(s => { const g = getG(r.id, s.id); if (g != null) pts.push({ label: s.nombre, full: s.nombre, v: g }); });
    else { const g = getG(r.id, it.id); if (g != null) pts.push({ label: it.nombre, full: it.nombre, v: g }); }
  }));
  const ch = $('chNotas'); pts.length ? barChart(ch, pts.map(p => ({ ...p, label: corto(p.label) })), { ref: APROB }) : ch.innerHTML = '<div class="note">Todavía no hay notas ingresadas.</div>';
  if (exA) { const xs = []; for (let x = 10; x <= 70; x++) xs.push({ x: x / 10, y: proyeccion(r, x / 10, true) }); lineChart($('chCurva'), xs, { ref: meta, mark: n.tipo === 'ok' ? n.val : null }); }
}
window.fmtG = fmt;
const corto = s => s.replace(/Interrogaci[oó]n /i, 'I').replace(/Control (escrito )?/i, 'C').replace(/^Examen.*/i, 'Ex').replace(/Prueba /i, 'P').replace(/Seminario /i, 'S').replace(/\s*\(.*\)/, '');
function parteHTML(r, p, res) {
  const o = O(r.id), pv = res.partes.find(x => x.p === p), multi = r.partes.length > 1;
  let rows = '';
  p.items.forEach(it => {
    const w = EDIT ? `<input class="wt" value="${fmt2(it.peso * 100)}" onchange="setPeso('${r.id}','${p.id}','${it.id}',this.value)">%` : `${fmt2(it.peso * 100)}%`;
    if (it.sub && it.sub.length) {
      const v = itemVal(r, it, () => null, null);
      rows += `<tr><td><b>${esc(it.nombre)}</b>${it.bono ? `<br><label class="chk"><input type="checkbox" ${o['bono_' + it.bono.id] ? 'checked' : ''} onchange="setOpt('${r.id}','bono_${it.bono.id}',this.checked)"> ${esc(it.bono.nombre)}</label>` : ''}</td><td class="w">${w}</td><td class="f"></td><td><div class="calc">${fmt(v)}</div></td></tr>`;
      it.sub.forEach(s => rows += rowInput(r, s, 'sub', ''));
    } else rows += rowInput(r, it, '', w);
  });
  return `<div class="parte">
    ${multi ? `<div class="parte-h"><b>${esc(p.nombre)}</b><span>${fmt2(p.peso * 100)}%${p.minimo != null ? ' · mínimo ' + fmt2(p.minimo) : ''} · actual <b style="color:var(--text)">${fmt(pv && pv.val)}</b></span></div>` : ''}
    <table class="ev"><thead><tr><th>Evaluación</th><th>Peso</th><th>Fecha</th><th style="text-align:center">Nota</th></tr></thead><tbody>${rows}</tbody></table>
    ${p.bonoParte ? `<label class="chk" style="margin-top:8px"><input type="checkbox" ${o['bono_' + p.bonoParte.id] ? 'checked' : ''} onchange="setOpt('${r.id}','bono_${p.bonoParte.id}',this.checked)"> ${esc(p.bonoParte.nombre)}</label>` : ''}</div>`;
}
function rowInput(r, it, cls, w) {
  const o = O(r.id), g = getG(r.id, it.id), just = o['just_' + it.id];
  return `<tr class="${cls}"><td>${esc(it.nombre)}${it.examen ? ' <span class="pill neutral" style="padding:1px 7px;font-size:11px">examen</span>' : ''}
    ${it.reemplazable ? `<br><label class="chk"><input type="checkbox" ${just ? 'checked' : ''} onchange="setOpt('${r.id}','just_${it.id}',this.checked)"> Falté justificado (vale el examen)</label>` : ''}</td>
    <td class="w">${w}</td><td class="f">${fdate(it.fecha)}</td>
    <td>${just ? '<div class="calc">= Ex</div>' : `<input class="g" inputmode="decimal" aria-label="Nota ${esc(it.nombre)}" value="${g != null ? fmt(g) : ''}" placeholder="—" onchange="onG(this,'${r.id}','${it.id}')">`}</td></tr>`;
}
const keepScroll = f => { const y = scrollY; f(); scrollTo(0, y); };
window.onG = (el, rid, i) => { const v = parseG(el.value); if (v != null && (isNaN(v) || v < 1 || v > 7)) { el.classList.add('bad'); return; } setG(rid, i, v); keepScroll(render); };
window.setOpt = (rid, k, v) => { const o = O(rid); if (v == null) delete o[k]; else o[k] = v; api.guardar(rid); keepScroll(render); };
window.toggleEdit = () => { EDIT = !EDIT; keepScroll(render); };
window.setPeso = (rid, pid, iid, val) => {
  const m = M(rid), c = CATALOGO.find(x => x.id === rid); if (!m.override) m.override = JSON.parse(JSON.stringify(c.def));
  const it = m.override.partes.find(p => p.id === pid).items.find(x => x.id === iid); const v = parseFloat(String(val).replace(',', '.'));
  if (!isNaN(v) && v >= 0) it.peso = v / 100; api.guardar(rid); keepScroll(render);
};
window.restaurar = rid => { M(rid).override = null; api.guardar(rid); keepScroll(render); };
window.borrarNotas = rid => { if (!confirmar('borrar-' + rid, 'Toca de nuevo "Borrar notas" para confirmar.')) return; const m = M(rid); m.notas = {}; m.opts = { meta: APROB }; api.guardar(rid); render(); };
window.quitarRamo = async rid => { if (!confirmar('quitar-' + rid, 'Toca de nuevo "Quitar ramo" para confirmar. Se borran tus notas de este ramo.')) return; await api.desinscribir(rid); go(''); toast('Ramo quitado'); };
function confirmar(k, msg) { if (confirmar.k === k && Date.now() - confirmar.t < 5000) { confirmar.k = null; return true; } confirmar.k = k; confirmar.t = Date.now(); toast(msg); return false; }

/* ============================================================ GRÁFICOS */
const tip = $('tip');
function showTip(e, html) { tip.innerHTML = html; tip.style.opacity = 1; tip.style.left = Math.max(8, Math.min(e.clientX - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8)) + 'px'; tip.style.top = Math.max(8, e.clientY - 48) + 'px'; }
const hideTip = () => tip.style.opacity = 0;
function barChart(el, data, { ref }) {
  const W = Math.max(el.clientWidth, 280), H = 200, pl = 30, pr = 8, pt = 12, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const y = v => pt + ih - (v - 1) / 6 * ih, n = data.length, step = iw / n, bw = Math.min(46, step * 0.6);
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="Gráfico de barras de notas">`;
  [1, 2, 3, 4, 5, 6, 7].forEach(t => s += `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t}</text>`);
  data.forEach((d, i) => {
    const cx = pl + step * i + step / 2;
    if (d.v != null) { const top = y(d.v), bot = y(1); s += `<path d="M${cx - bw / 2},${bot} V${top + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${bot} Z" fill="var(--series)"/><text x="${cx}" y="${top - 5}" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--text)">${fmt(d.v)}</text>`; }
    const maxc = Math.max(3, Math.floor(step / 6.6)); const lb = d.label.length > maxc ? d.label.slice(0, maxc - 1) + '…' : d.label;
    s += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-2)">${esc(lb)}</text><rect x="${pl + step * i}" y="${pt}" width="${step}" height="${ih}" fill="transparent" data-i="${i}"/>`;
  });
  if (ref != null) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--ref)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  el.innerHTML = s + '</svg>';
  el.querySelectorAll('rect[data-i]').forEach(rc => { const d = data[+rc.dataset.i]; const f = e => showTip(e.touches ? e.touches[0] : e, `${esc(d.full)}: <b>${fmt(d.v)}</b>`); rc.addEventListener('mousemove', f); rc.addEventListener('mouseleave', hideTip); rc.addEventListener('touchstart', e => { f(e); clearTimeout(hideTip._t); hideTip._t = setTimeout(hideTip, 1800); }, { passive: true }); });
}
function lineChart(el, pts, { ref, mark }) {
  const W = Math.max(el.clientWidth, 280), H = 190, pl = 30, pr = 10, pt = 10, pb = 28, iw = W - pl - pr, ih = H - pt - pb;
  const x = v => pl + (v - 1) / 6 * iw, y = v => pt + ih - (v - 1) / 6 * ih;
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="Nota final según nota del examen">`;
  [1, 2, 3, 4, 5, 6, 7].forEach(t => s += `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t}</text><text x="${x(t)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--muted)">${t}</text>`);
  s += `<text x="${W - pr}" y="${H - 1}" text-anchor="end" font-size="10.5" fill="var(--muted)">nota en el examen →</text>`;
  if (ref != null) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--ref)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  const v = pts.filter(p => p.y != null);
  s += `<path d="${v.map((p, i) => (i ? 'L' : 'M') + x(p.x) + ',' + y(p.y)).join(' ')}" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round"/>`;
  if (mark != null) { const p = v.find(q => Math.abs(q.x - mark) < .05); if (p) s += `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="5" fill="var(--series)" stroke="var(--surface)" stroke-width="2"/>`; }
  s += `<line class="cr" x1="0" x2="0" y1="${pt}" y2="${pt + ih}" stroke="var(--muted)" opacity="0"/><circle class="dt" r="4" fill="var(--series)" stroke="var(--surface)" stroke-width="2" opacity="0"/><rect class="hit" x="${pl}" y="${pt}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  el.innerHTML = s;
  const hit = el.querySelector('.hit'), cr = el.querySelector('.cr'), dt = el.querySelector('.dt');
  const mover = e => { if (e.touches) e = e.touches[0]; const b = hit.getBoundingClientRect(); const xv = Math.round((1 + (e.clientX - b.left) / b.width * 6) * 10) / 10; const p = v.reduce((a, c) => Math.abs(c.x - xv) < Math.abs(a.x - xv) ? c : a);
    cr.setAttribute('x1', x(p.x)); cr.setAttribute('x2', x(p.x)); cr.setAttribute('opacity', 1); dt.setAttribute('cx', x(p.x)); dt.setAttribute('cy', y(p.y)); dt.setAttribute('opacity', 1); showTip(e, `Examen ${fmt(p.x)} → final <b>${fmt(p.y)}</b>`); };
  const salir = () => { hideTip(); cr.setAttribute('opacity', 0); dt.setAttribute('opacity', 0); };
  hit.addEventListener('mousemove', mover); hit.addEventListener('mouseleave', salir);
  hit.addEventListener('touchstart', mover, { passive: true }); hit.addEventListener('touchmove', mover, { passive: true }); hit.addEventListener('touchend', () => setTimeout(salir, 1500));
}

/* ============================================================ MODAL */
function openModal(h) { $('modal').innerHTML = `<button class="btn ghost x" onclick="closeModal()" aria-label="Cerrar">✕</button>` + h; $('modalBg').style.display = 'flex'; }
window.closeModal = () => { $('modalBg').style.display = 'none'; detenerDictado(); };
$('modalBg').addEventListener('click', e => { if (e.target === $('modalBg')) closeModal(); });

/* ---------- Catálogo ---------- */
window.openCatalogo = () => {
  openModal(`<h3>Agregar ramo</h3>
    <input class="search" id="q" placeholder="Busca por sigla o nombre (ej: MAT1630, Física)" oninput="filtrarCat()" autocomplete="off">
    <div class="cat-list" id="catList"></div>
    <div class="row" style="justify-content:space-between;margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
      <span style="color:var(--text-2);font-size:14px">¿No encuentras tu ramo?</span>
      <button class="btn primary" onclick="openCrear()">Crear ramo nuevo</button></div>`);
  filtrarCat(); setTimeout(() => $('q') && $('q').focus(), 50);
};
window.filtrarCat = () => {
  const q = normTxt($('q').value), qs = normSigla($('q').value);
  const hoy = Date.now();
  const list = CATALOGO.filter(c => !q || normSigla(c.sigla).includes(qs) || normTxt(c.nombre).includes(q) || normTxt(c.carrera || '').includes(q))
    .sort((a, b) => a.sigla.localeCompare(b.sigla) || String(b.periodo).localeCompare(String(a.periodo))).slice(0, 80);
  $('catList').innerHTML = list.length ? list.map(c => {
    const tiene = !!M(c.id), nuevo = c.creado_por && (hoy - new Date(c.created_at)) < 7 * 864e5;
    return `<div class="cat-item"><div><div><b>${esc(c.sigla)}</b> · ${esc(c.nombre)} ${nuevo ? '<span class="pill info" style="padding:1px 8px;font-size:11px">Nuevo</span>' : ''}</div>
      <div class="meta">${esc([c.universidad, c.carrera, c.periodo].filter(Boolean).join(' · '))}${c.creado_por ? ' · agregado por la comunidad' : ''}</div></div>
      ${tiene ? '<span class="pill good">✓ Ya lo tienes</span>' : `<button class="btn sm" onclick="agregarDeCatalogo('${c.id}')">Agregar</button>`}</div>`;
  }).join('') : `<div class="note" style="text-align:center;padding:20px">No hay ramos que coincidan. Créalo con el botón de abajo.</div>`;
};
window.agregarDeCatalogo = async id => { try { await api.inscribir(id); closeModal(); go('ramo-' + id); toast('Ramo agregado'); } catch (e) { toast('Error: ' + e.message); } };

/* ---------- Crear ramo: manual / voz / PDF ---------- */
const CREAR = { tab: 'pdf', texto: '', borrador: null };
window.CREAR = CREAR;
window.openCrear = (tab) => { Object.assign(CREAR, { tab: tab || CREAR.tab || 'pdf', texto: '', borrador: null }); drawCrear(); };
function drawCrear() {
  const t = CREAR.tab;
  openModal(`<h3>Crear ramo nuevo</h3>
    <div class="tabs">${[['pdf', '📄 Subir PDF'], ['voz', '🎙️ Por voz'], ['manual', '✏️ A mano']].map(([k, l]) => `<button class="${t === k ? 'on' : ''}" onclick="CREAR_tab('${k}')">${l}</button>`).join('')}</div>
    <div id="crearBody">${t === 'pdf' ? crearPdfHTML() : t === 'voz' ? crearVozHTML() : ''}</div>`);
  if (t === 'manual') { CREAR.borrador = borradorVacio(); drawPreview(); }
}
window.CREAR_tab = k => { detenerDictado(); CREAR.tab = k; drawCrear(); };
function crearPdfHTML() {
  return `<p style="color:var(--text-2);margin-top:0">Sube el programa del curso. La IA lo lee y arma las evaluaciones; después revisas todo antes de guardarlo.</p>
    <label class="dropzone" id="dz"><input type="file" accept="application/pdf" id="pdfIn" style="display:none" onchange="leerPdf(this.files[0])">
      <div style="font-size:28px">📄</div><b>Elige el PDF o arrástralo aquí</b><div class="note">Máximo 15 MB</div></label>
    <div id="iaEstado"></div>`;
}
function crearVozHTML() {
  return `<p style="color:var(--text-2);margin-top:0">Cuéntale a la IA cómo se evalúa el ramo, como se lo explicarías a un amigo. Por ejemplo: <i>"Física, sigla FIS109A. Tres interrogaciones de 20% cada una, controles 10% y examen 30%. El examen es el 9 de diciembre."</i></p>
    <button class="mic" id="micBtn" onclick="toggleDictado()" aria-label="Grabar">🎙️</button>
    <div class="note" id="micEstado" style="text-align:center">${hayDictado() ? 'Toca el micrófono y habla' : 'Tu navegador no permite dictar: escríbelo abajo'}</div>
    <div class="field"><label>Lo que dijiste (puedes corregirlo)</label><textarea id="vozTxt" oninput="CREAR.texto=this.value">${esc(CREAR.texto)}</textarea></div>
    <button class="btn primary" onclick="procesarTexto()">Armar ramo con IA</button>
    <div id="iaEstado"></div>`;
}
function borradorVacio() {
  return { sigla: '', nombre: '', periodo: periodoActual(), carrera: '', universidad: 'UC', combinacion: 'ponderado', eximicion: null,
    partes: [{ id: 'p', nombre: 'Nota final', peso: 1, minimo: null, items: [
      { id: 'i1', nombre: 'Interrogación 1', peso: .2 }, { id: 'i2', nombre: 'Interrogación 2', peso: .2 }, { id: 'i3', nombre: 'Interrogación 3', peso: .2 }, { id: 'ex', nombre: 'Examen', peso: .4, examen: true }] }],
    reglas: [], dudas: [], fuente: 'Agregado a mano' };
}
function periodoActual() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() < 7 ? 1 : 2); }

/* PDF */
let pdfjsLib = null;
async function textoDePdf(file) {
  if (!pdfjsLib) { await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); pdfjsLib = window.pdfjsLib; pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; }
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; let out = '';
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) { const tc = await (await doc.getPage(i)).getTextContent(); out += tc.items.map(t => t.str).join(' ') + '\n'; }
  return out;
}
const toB64 = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(f); });
window.leerPdf = async file => {
  if (!file) return; if (file.size > 15e6) return iaEstado('error', 'El PDF pesa más de 15 MB.');
  iaEstado('cargando', 'Leyendo el programa… (puede tardar unos 20 segundos)');
  try {
    let payload;
    if (MODE === 'cloud' && file.size <= 3.2e6) payload = { tipo: 'pdf', data: await toB64(file), nombre: file.name };
    else { const t = await textoDePdf(file); if (t.replace(/\s/g, '').length < 200) throw new Error('No pude sacar texto del PDF (¿es una imagen escaneada?). Prueba por voz o a mano.'); payload = { tipo: 'pdf', textoPdf: t, texto: t, nombre: file.name }; }
    const r = await api.extraer(payload); recibirBorrador(r, 'Programa PDF: ' + file.name);
  } catch (e) { iaEstado('error', e.message); }
};
function iaEstado(tipo, msg) { const el = $('iaEstado'); if (!el) return; el.innerHTML = tipo === 'cargando' ? `<div class="infobox" style="margin-top:12px"><span class="spinner"></span> ${esc(msg)}</div>` : `<div class="errbox">${esc(msg)}</div>`; }
window.procesarTexto = async () => {
  detenerDictado(); const t = ($('vozTxt').value || '').trim(); if (t.length < 20) return iaEstado('error', 'Cuéntame un poco más sobre cómo se evalúa el ramo.');
  iaEstado('cargando', 'Armando el ramo…');
  try { recibirBorrador(await api.extraer({ tipo: 'texto', texto: t }), 'Descrito por voz/texto'); } catch (e) { iaEstado('error', e.message); }
};
function recibirBorrador(r, fuente) {
  const b = normalizarDef(r); b.fuente = fuente; CREAR.borrador = b; drawPreview();
}
function normalizarDef(r) {
  const b = { ...borradorVacio(), ...r };
  b.partes = (r.partes || []).map((p, pi) => ({ id: p.id || 'p' + pi, nombre: p.nombre || 'Nota final', peso: +p.peso || 0, minimo: p.minimo ?? null,
    items: (p.items || []).map((it, ii) => ({ id: it.id || ('e' + pi + '_' + ii), nombre: it.nombre || 'Evaluación', peso: +it.peso || 0, fecha: it.fecha || null, examen: !!it.examen, reemplazable: !!it.reemplazable,
      sub: Array.isArray(it.sub) && it.sub.length ? it.sub.map((s, si) => ({ id: s.id || ('s' + pi + '_' + ii + '_' + si), nombre: s.nombre || 'Sub ' + (si + 1), fecha: s.fecha || null })) : undefined })) }));
  if (!b.partes.length) b.partes = borradorVacio().partes;
  const ids = new Set(); b.partes.forEach(p => p.items.forEach(it => { [it, ...(it.sub || [])].forEach(x => { while (ids.has(x.id)) x.id += '_'; ids.add(x.id); }); }));
  if (b.partes.length === 1) b.partes[0].peso = 1;
  b.reglas = Array.isArray(b.reglas) ? b.reglas : []; b.dudas = Array.isArray(b.dudas) ? b.dudas : [];
  return b;
}

/* Vista previa editable + revisión de duplicados */
window.drawPreview = drawPreview;
function drawPreview() {
  const b = CREAR.borrador; const body = $('crearBody'); if (!body) return;
  const sumP = b.partes.reduce((a, p) => a + (+p.peso || 0), 0);
  body.innerHTML = `
    ${CREAR.tab !== 'manual' ? `<div class="infobox">✓ La IA armó este borrador. <b>Revísalo antes de guardar</b>: así va a quedar para todos los que agreguen este ramo.</div>` : ''}
    ${b.dudas.length ? `<div class="warnbox"><b>La IA no estaba segura de:</b><ul class="rules" style="margin:4px 0 0">${b.dudas.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>` : ''}
    <div class="row" style="align-items:flex-start">
      <div class="field" style="max-width:150px"><label>Sigla</label><input value="${esc(b.sigla)}" oninput="B('sigla',this.value)" onchange="revisarDup()" placeholder="MAT1630"></div>
      <div class="field" style="min-width:200px"><label>Nombre</label><input value="${esc(b.nombre)}" oninput="B('nombre',this.value)" onchange="revisarDup()" placeholder="Cálculo III"></div></div>
    <div class="row" style="align-items:flex-start">
      <div class="field"><label>Universidad</label><input value="${esc(b.universidad)}" oninput="B('universidad',this.value)"></div>
      <div class="field"><label>Carrera (opcional)</label><input value="${esc(b.carrera || '')}" oninput="B('carrera',this.value)"></div>
      <div class="field" style="max-width:110px"><label>Período</label><input value="${esc(b.periodo)}" oninput="B('periodo',this.value)" placeholder="2026-2"></div></div>
    <div id="dupBox"></div>
    <h4 style="margin:12px 0 8px">Evaluaciones</h4>
    ${b.partes.map((p, pi) => previewParte(b, p, pi)).join('')}
    <div class="row" style="justify-content:space-between">
      <button class="btn sm ghost" onclick="addParte()">＋ Agregar componente (ej. laboratorio)</button>
      ${b.partes.length > 1 ? `<span class="${Math.abs(sumP - 1) < .001 ? 'sum-ok' : 'sum-bad'}">Componentes suman ${fmt2(sumP * 100)}%</span>` : ''}</div>
    ${b.partes.length > 1 ? `<label class="chk" style="margin-top:8px"><input type="checkbox" ${b.combinacion === 'minimos' ? 'checked' : ''} onchange="B('combinacion',this.checked?'minimos':'ponderado');drawPreview()"> Cada componente con mínimo se debe aprobar por separado</label>` : ''}
    ${eximicionHTML(b)}
    <h4 style="margin:14px 0 6px">Reglas importantes</h4>
    <div class="field"><textarea oninput="B('reglas',this.value.split('\\n').map(s=>s.trim()).filter(Boolean))" placeholder="Una regla por línea">${esc(b.reglas.join('\n'))}</textarea></div>
    <div id="guardarErr"></div>
    <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn ghost" onclick="closeModal()">Cancelar</button><button class="btn primary" id="btnGuardar" onclick="guardarRamo()">Guardar y agregar a mis ramos</button></div>`;
  revisarDup();
}
function previewParte(b, p, pi) {
  const sum = p.items.reduce((a, it) => a + (+it.peso || 0), 0);
  return `<div class="prev-parte">
    ${b.partes.length > 1 ? `<div class="row" style="margin-bottom:8px"><input class="inp" style="flex:1;min-width:140px" value="${esc(p.nombre)}" oninput="P(${pi},'nombre',this.value)">
      <span style="font-size:13px;color:var(--text-2)">Pesa</span><input class="inp" style="width:64px" value="${fmt2(p.peso * 100)}" onchange="P(${pi},'peso',pct(this.value));drawPreview()">%
      <label class="chk"><input type="checkbox" ${p.minimo != null ? 'checked' : ''} onchange="P(${pi},'minimo',this.checked?3.95:null)"> Mínimo 3,95</label>
      <button class="btn sm ghost" onclick="delParte(${pi})" aria-label="Quitar componente">✕</button></div>` : ''}
    <div class="prev-row" style="font-size:12px;color:var(--muted)"><span>Evaluación</span><span>Peso %</span><span class="hide-sm">Fecha</span><span class="hide-sm">Examen</span><span></span></div>
    ${p.items.map((it, ii) => `<div class="prev-row"><input type="text" value="${esc(it.nombre)}" oninput="I(${pi},${ii},'nombre',this.value)">
      <input class="num" value="${fmt2(it.peso * 100)}" onchange="I(${pi},${ii},'peso',pct(this.value));drawPreview()">
      <input type="date" class="hide-sm" value="${it.fecha || ''}" onchange="I(${pi},${ii},'fecha',this.value||null)">
      <label class="chk hide-sm"><input type="radio" name="exm" ${it.examen ? 'checked' : ''} onchange="marcarExamen(${pi},${ii})"> Examen</label>
      <button class="btn sm ghost" onclick="delItem(${pi},${ii})" aria-label="Quitar">✕</button></div>
      ${(it.sub || []).map((s, si) => `<div class="prev-row subr"><input type="text" value="${esc(s.nombre)}" oninput="S(${pi},${ii},${si},this.value)"><span class="note" style="margin:0">promedio</span><button class="btn sm ghost" onclick="delSub(${pi},${ii},${si})">✕</button></div>`).join('')}`).join('')}
    <div class="row" style="justify-content:space-between"><button class="btn sm ghost" onclick="addItem(${pi})">＋ Evaluación</button>
      <span class="${Math.abs(sum - 1) < .001 ? 'sum-ok' : 'sum-bad'}">${Math.abs(sum - 1) < .001 ? '✓ ' : ''}Suma ${fmt2(sum * 100)}%</span></div></div>`;
}
function eximicionHTML(b) {
  const e = b.eximicion;
  return `<div class="row" style="margin-top:10px"><label class="chk"><input type="checkbox" ${e ? 'checked' : ''} onchange="toggleExim(this.checked)"> Tiene eximición del examen</label>
    ${e ? `<span style="font-size:13px;color:var(--text-2)">con nota de presentación ≥</span><input class="inp" style="width:64px" value="${fmt2(e.umbral)}" onchange="CREAR.borrador.eximicion.umbral=+String(this.value).replace(',','.')">
      <label class="chk"><input type="checkbox" ${e.sinRojos ? 'checked' : ''} onchange="CREAR.borrador.eximicion.sinRojos=this.checked"> y sin notas rojas</label>` : ''}</div>`;
}
window.pct = v => (parseFloat(String(v).replace(',', '.')) || 0) / 100;
window.B = (k, v) => { CREAR.borrador[k] = v; };
window.P = (pi, k, v) => { CREAR.borrador.partes[pi][k] = v; };
window.I = (pi, ii, k, v) => { CREAR.borrador.partes[pi].items[ii][k] = v; };
window.S = (pi, ii, si, v) => { CREAR.borrador.partes[pi].items[ii].sub[si].nombre = v; };
window.delSub = (pi, ii, si) => { const it = CREAR.borrador.partes[pi].items[ii]; it.sub.splice(si, 1); if (!it.sub.length) delete it.sub; drawPreview(); };
window.addItem = pi => { CREAR.borrador.partes[pi].items.push({ id: 'n' + uid(), nombre: '', peso: 0 }); drawPreview(); };
window.delItem = (pi, ii) => { CREAR.borrador.partes[pi].items.splice(ii, 1); drawPreview(); };
window.marcarExamen = (pi, ii) => { CREAR.borrador.partes.forEach(p => p.items.forEach(it => it.examen = false)); CREAR.borrador.partes[pi].items[ii].examen = true; };
window.addParte = () => { const b = CREAR.borrador; if (b.partes.length === 1) { b.partes[0].nombre = 'Cátedra'; b.partes[0].peso = .7; } b.partes.push({ id: 'p' + uid(), nombre: 'Laboratorio', peso: .3, minimo: 3.95, items: [{ id: 'l' + uid(), nombre: 'Nota de laboratorio', peso: 1 }] }); b.combinacion = 'minimos'; drawPreview(); };
window.delParte = pi => { const b = CREAR.borrador; b.partes.splice(pi, 1); if (b.partes.length === 1) { b.partes[0].peso = 1; b.combinacion = 'ponderado'; } drawPreview(); };
window.toggleExim = on => { const b = CREAR.borrador; b.eximicion = on ? { parte: b.partes[0].id, umbral: 5.5, sinRojos: false } : null; drawPreview(); };

window.revisarDup = async () => {
  const b = CREAR.borrador, box = $('dupBox'); if (!box) return;
  if (!b.sigla && !b.nombre) { box.innerHTML = ''; return; }
  const d = await api.buscarDuplicados(b.sigla, b.nombre);
  box.innerHTML = d.length ? `<div class="warnbox"><b>Ojo: este ramo podría ya existir en el catálogo.</b>
    ${d.slice(0, 4).map(c => `<div class="row" style="justify-content:space-between;margin-top:6px;color:var(--text)"><span><b>${esc(c.sigla)}</b> · ${esc(c.nombre)} <span class="meta" style="color:var(--muted)">(${esc(c.periodo || '—')} · ${c.motivo})</span></span>
      ${M(c.id) ? '<span class="pill good">Ya lo tienes</span>' : `<button class="btn sm" onclick="agregarDeCatalogo('${c.id}')">Usar este</button>`}</div>`).join('')}
    <div class="note" style="color:var(--warn)">Si es otro ramo (u otro semestre con un programa distinto), puedes guardarlo igual.</div></div>` : '';
};
function validar(b) {
  const err = [];
  if (!b.sigla.trim()) err.push('Falta la sigla.'); if (!b.nombre.trim()) err.push('Falta el nombre.');
  b.partes.forEach(p => { const s = p.items.reduce((a, it) => a + (+it.peso || 0), 0); if (Math.abs(s - 1) > .001) err.push(`Las evaluaciones de "${p.nombre}" suman ${fmt2(s * 100)}%, deben sumar 100%.`); if (p.items.some(it => !it.nombre.trim())) err.push(`Hay una evaluación sin nombre en "${p.nombre}".`); });
  if (b.partes.length > 1) { const s = b.partes.reduce((a, p) => a + (+p.peso || 0), 0); if (Math.abs(s - 1) > .001) err.push(`Los componentes suman ${fmt2(s * 100)}%, deben sumar 100%.`); }
  return err;
}
window.guardarRamo = async () => {
  const b = CREAR.borrador, err = validar(b);
  if (err.length) { $('guardarErr').innerHTML = `<div class="errbox">${err.map(esc).join('<br>')}</div>`; return; }
  const exacto = CATALOGO.find(c => normSigla(c.sigla) === normSigla(b.sigla) && String(c.periodo || '') === String(b.periodo || '') && normTxt(c.universidad) === normTxt(b.universidad));
  if (exacto) { $('guardarErr').innerHTML = `<div class="errbox">Ya existe ${esc(exacto.sigla)} para el período ${esc(exacto.periodo)}. Usa ese (botón "Usar este" arriba) o cambia el período.</div>`; return; }
  const btn = $('btnGuardar'); btn.disabled = true; btn.textContent = 'Guardando…';
  const def = { combinacion: b.partes.length > 1 ? b.combinacion : 'ponderado', eximicion: b.eximicion || null, partes: b.partes, reglas: b.reglas, dudas: [] };
  try {
    const row = await api.crearRamo({ sigla: b.sigla.trim().toUpperCase(), nombre: b.nombre.trim(), universidad: b.universidad.trim() || 'UC', periodo: b.periodo.trim(), carrera: (b.carrera || '').trim(), fuente: b.fuente || 'Agregado por la comunidad', def });
    await api.inscribir(row.id); closeModal(); go('ramo-' + row.id); toast('Ramo creado y compartido con la comunidad');
  } catch (e) { $('guardarErr').innerHTML = `<div class="errbox">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = 'Guardar y agregar a mis ramos'; }
};

/* Dictado por voz (Web Speech API del navegador) */
let REC = null;
const hayDictado = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
window.toggleDictado = () => {
  if (REC) return detenerDictado();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  REC = new SR(); REC.lang = 'es-CL'; REC.continuous = true; REC.interimResults = true;
  const base = ($('vozTxt').value || '').trim(); let fin = '';
  REC.onresult = e => { let parc = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t + ' '; else parc += t; } const v = (base ? base + ' ' : '') + fin + parc; $('vozTxt').value = v; CREAR.texto = v; };
  REC.onerror = e => { $('micEstado').textContent = e.error === 'not-allowed' ? 'No diste permiso al micrófono. Puedes escribirlo abajo.' : 'Se cortó el dictado (' + e.error + ').'; };
  REC.onend = () => { REC = null; const b = $('micBtn'); if (b) { b.classList.remove('rec'); $('micEstado').textContent = 'Listo. Revisa el texto y toca "Armar ramo con IA".'; } };
  try { REC.start(); $('micBtn').classList.add('rec'); $('micEstado').textContent = 'Escuchando… toca de nuevo para terminar'; } catch (e) { REC = null; }
};
function detenerDictado() { if (REC) { try { REC.stop(); } catch (e) { } } }

/* ============================================================ ARRANQUE */
try { const t = localStorage.getItem('notasapp.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { }
if (document.documentElement.dataset.theme) pintarBarra();
async function boot() {
  drawHeader();
  if (!USER) return render();
  try { await api.loadCatalogo(); await api.loadMis(); OFFLINE = false; guardarCache(); }
  catch (e) {
    const c = leerCache();
    if (c) { CATALOGO = c.CATALOGO; MIS = c.MIS; OFFLINE = true; }
    else { app.innerHTML = `<div class="errbox">No se pudieron cargar los datos${navigator.onLine ? ': ' + esc(e.message) : '. Revisa tu conexión a internet.'}</div>`; return; }
  }
  drawHeader(); render();
}
/* ============================================================ APP INSTALABLE */
const esStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let promptInstalar = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; drawHeader(); });
addEventListener('appinstalled', () => { promptInstalar = null; drawHeader(); toast('App instalada'); });
function installHTML() {
  if (esStandalone() || matchMedia('(min-width: 761px)').matches) return '';
  try { if (localStorage.getItem('notasapp.noinstall')) return ''; } catch (e) { }
  const cerrar = `<button class="btn ghost sm" onclick="try{localStorage.setItem('notasapp.noinstall',1)}catch(e){};drawHeader()" aria-label="Ocultar">✕</button>`;
  if (promptInstalar) return `<div class="install"><span>📲 Instala Mis Notas en tu celular</span><span class="row"><button class="btn primary sm" onclick="instalar()">Instalar</button>${cerrar}</span></div>`;
  if (esIOS()) return `<div class="install"><span>📲 Para instalarla: toca <b>Compartir</b> ⬆️ y luego <b>"Agregar a inicio"</b>.</span>${cerrar}</div>`;
  return '';
}
window.drawHeader = () => drawHeader();
window.instalar = async () => { if (!promptInstalar) return; promptInstalar.prompt(); await promptInstalar.userChoice; promptInstalar = null; drawHeader(); };
function pintarBarra() {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.setAttribute('content', dark ? '#121211' : '#f4f3ef'); m.removeAttribute('media'); });
}
addEventListener('online', async () => { if (MODE !== 'cloud') return; OFFLINE = false; for (const id of [...PEND]) api.guardar(id); try { await api.loadCatalogo(); guardarCache(); } catch (e) { } drawHeader(); });
addEventListener('offline', () => { if (MODE === 'cloud') { OFFLINE = true; drawHeader(); } });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => { });
  let recargado = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (recargado) return; recargado = true; toast('App actualizada'); });
}
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => USER && render(), 150); });
(async () => { try { await api.init(); } catch (e) { MODE = 'demo'; demo.load(); USER = { id: 'demo' }; } boot(); })();
