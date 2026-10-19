/* ===================== BarberFlow · app.js ===================== */
'use strict';

/* ---------- Constantes y estado ---------- */
const KEY = 'barberflow_v1';
const CATS = ['Comida/Bebidas', 'Gasolina', 'Insumos/Herramientas de Barbería', 'Comisión de Terminal', 'Gastos Hormiga', 'Otros'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/** Carga los datos guardados (o crea una estructura vacía). */
function load() {
  const empty = { tx: [], goal: { name: '', target: 0, saved: 0 }, lastClose: 0,
    presets: [{ n: 'Corte', a: 15000 }, { n: 'Barba', a: 8000 }, { n: 'Corte + barba', a: 20000 }] };
  const raw = localStorage.getItem(KEY);
  try {
    const d = Object.assign(empty, JSON.parse(raw) || {});
    if (!d.v) { // migración única: pesos -> centavos enteros (evita errores de redondeo)
      d.tx.forEach(t => { t.amount = Math.round(t.amount * 100); t.tip = Math.round((t.tip || 0) * 100); });
      d.goal.target = Math.round(d.goal.target * 100); d.goal.saved = Math.round(d.goal.saved * 100);
      d.v = 2;
    }
    if (!d.goals) d.goals = (d.goal.target > 0 || d.goal.saved > 0)
      ? [{ id: 1, name: d.goal.name || 'Mi meta', target: d.goal.target, saved: d.goal.saved, log: d.goal.log || [] }] : [];
    delete d.goal;
    d.tx.forEach(t => { if (!t.tipPay) t.tipPay = t.pay === 'card' ? 'card' : 'cash'; });
    return d;
  } catch (e) {
    if (raw) localStorage.setItem(KEY + '_corrupto', raw); // nunca se pierde el dato original
    return empty;
  }
}
let db = load();
let type = 'in';      // 'in' = ingreso, 'out' = egreso
let pay = 'cash';     // 'cash' = efectivo, 'card' = terminal
let editId = null;    // id del registro que se está editando
const save = () => localStorage.setItem(KEY, JSON.stringify(db));

/* ---------- Utilidades ---------- */
const money = c => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format((c || 0) / 100);
const cents = v => Math.round((parseFloat(v) || 0) * 100); // "12.5" -> 1250
const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthKey = ts => dayKey(ts).slice(0, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Lunes de la semana a la que pertenece ts (medianoche local). */
function weekStart(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 1500);
}
/** Suma base, propinas y gastos de una lista de movimientos. */
function totals(list) {
  let base = 0, tips = 0, exp = 0;
  list.forEach(t => { if (t.type === 'in') { base += t.amount; tips += t.tip; } else exp += t.amount; });
  return { base, tips, exp, income: base + tips, net: base + tips - exp };
}
/** Parte de un ingreso cobrada en efectivo / por terminal (la propina puede ir en otro método que el servicio). */
const cashIn = t => t.type === 'in' ? (t.pay === 'cash' ? t.amount : 0) + (t.tipPay === 'cash' ? t.tip : 0) : 0;
const cardIn = t => t.type === 'in' ? (t.pay === 'card' ? t.amount : 0) + (t.tipPay === 'card' ? t.tip : 0) : 0;
/** ¿Tiene algo pendiente de cierre? (dinero en terminal o gasto pagado con tu tarjeta personal) */
const pend = t => t.pay === 'card' || t.pay === 'personal' || (t.type === 'in' && t.tip > 0 && t.tipPay === 'card');
let viewDate = dayKey(Date.now()); // día que se está viendo/registrando
const dayTx = k => db.tx.filter(t => dayKey(t.ts) === k);
const todayTx = () => dayTx(dayKey(Date.now()));
/** Marca de tiempo para un registro nuevo: ahora, o mediodía del día elegido si es pasado. */
const stamp = () => viewDate === dayKey(Date.now()) ? Date.now() : new Date(viewDate + 'T12:00:00').getTime() + (Date.now() % 1e6);

/* ---------- Dashboard ---------- */
function renderDash() {
  const today = dayTx(viewDate), tot = totals(today);
  // Efectivo en mano: ingresos en efectivo menos gastos pagados en efectivo (hoy)
  const cash = today.reduce((s, t) => s + cashIn(t) - (t.type === 'out' && t.pay === 'cash' ? t.amount : 0), 0);
  // Terminal: todo lo cobrado por tarjeta aún no transferido (menos gastos pagados con terminal, ej. comisión)
  const term = db.tx.filter(t => !t.settled).reduce((s, t) => s + cardIn(t) - (t.type === 'out' && t.pay === 'card' ? t.amount : 0), 0);
  // Gastos pagados con tu tarjeta personal que aún no te repones de la terminal
  const pers = db.tx.filter(t => t.type === 'out' && t.pay === 'personal' && !t.settled).reduce((s, t) => s + t.amount, 0);
  $('#cPers').textContent = pers ? 'Por reponerte (tu tarjeta): ' + money(pers) : '';
  $('#cNetSub').textContent = 'De ' + money(tot.income) + ' ingresados';
  $('#cCash').textContent = money(cash);
  $('#cTerm').textContent = money(term);
  $('#cExp').textContent = money(tot.exp);
  $('#cNet').textContent = money(tot.net);
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
}

/** Cierre de terminal: marca como transferidos todos los movimientos de tarjeta. */
$('#btnClose').onclick = () => {
  if (!confirm('¿Ya transferiste el dinero de la terminal a tu cuenta? El contador volverá a $0 y tus gastos con tarjeta personal se marcan como repuestos.')) return;
  db.tx.forEach(t => { if (pend(t)) t.settled = true; });
  db.lastClose = Date.now(); // un cobro con tarjeta capturado en fecha anterior ya nace cerrado
  save(); renderAll(); toast('Terminal en cero');
};

/* ---------- Formulario de registro ---------- */
function fillCats() { $('#cat').innerHTML = CATS.map(c => `<option>${c}</option>`).join(''); }

/** Actualiza textos y campos según Ingreso/Egreso. */
function setType(t) {
  type = t;
  if (t === 'in' && pay === 'personal') setPay('cash'); // "Mi tarjeta" solo aplica a gastos
  $('#form').dataset.type = t;
  $$('#typeTabs button').forEach(b => b.classList.toggle('on', b.dataset.type === t));
  $('#lblAmount').textContent = t === 'in' ? 'del servicio' : 'del gasto';
  $('#lblPay').textContent = t === 'in' ? 'Método de pago' : 'Pagado con';
  $('#btnSubmit').textContent = editId ? 'Guardar cambios' : (t === 'in' ? 'Registrar Servicio' : 'Registrar Gasto');
}
let tipPay = 'cash', tipTouched = false;
function setTipPay(p, touched) {
  tipPay = p; if (touched) tipTouched = true;
  $$('#tipTabs button').forEach(b => b.classList.toggle('on', b.dataset.tp === p));
}
function setPay(p) {
  pay = p;
  $$('#payTabs button').forEach(b => b.classList.toggle('on', b.dataset.pay === p));
  if (!tipTouched) setTipPay(p === 'card' ? 'card' : 'cash'); // la propina sigue al método, salvo que lo cambies
}
$$('#tipTabs button').forEach(b => b.onclick = () => setTipPay(b.dataset.tp, true));
$$('#typeTabs button').forEach(b => b.onclick = () => { if (!editId) setType(b.dataset.type); });
$$('#payTabs button').forEach(b => b.onclick = () => setPay(b.dataset.pay));
// Si el gasto es "Comisión de Terminal", sugiere que se descuente de la terminal
$('#cat').onchange = () => { if ($('#cat').value === 'Comisión de Terminal') setPay('card'); };

function resetForm() {
  editId = null; tipTouched = false; $('#form').reset(); setPay('cash'); setType(type);
  $('#btnCancel').hidden = true;
}
$('#btnCancel').onclick = resetForm;

$('#form').onsubmit = e => {
  e.preventDefault();
  const amount = cents($('#amount').value);
  if (!(amount > 0)) return;
  const rec = {
    type, amount, pay, tipPay: type === 'in' ? tipPay : '',
    tip: type === 'in' ? cents($('#tip').value) : 0,
    cat: type === 'out' ? $('#cat').value : '',
    note: type === 'out' ? $('#note').value.trim() : ''
  };
  let t;
  if (editId) { t = db.tx.find(x => x.id === editId); Object.assign(t, rec); }            // edición
  else { t = { id: Date.now(), ts: stamp(), settled: false, ...rec }; db.tx.push(t); }    // alta nueva
  t.settled = pend(t) && (t.settled || t.ts <= db.lastClose);
  save(); toast(editId ? 'Cambios guardados' : (type === 'in' ? 'Servicio registrado' : 'Gasto registrado'));
  resetForm(); renderAll();
};

/* ---------- Historial del día ---------- */
function renderList() {
  const list = dayTx(viewDate).sort((a, b) => b.ts - a.ts); // más reciente arriba
  $('#list').innerHTML = list.length ? list.map(t => {
    const hora = new Date(t.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const ico = t.type === 'in' ? (t.pay === 'cash' ? '💵' : '💳') : '🔻';
    const sub = t.type === 'in'
      ? `${hora} · Servicio${t.tip ? ' + propina ' + money(t.tip) + (t.tipPay !== t.pay ? (t.tipPay === 'cash' ? ' 💵' : ' 💳') : '') : ''}`
      : `${hora} · ${esc(t.cat)}${t.note ? ' · ' + esc(t.note) : ''}${t.pay === 'card' ? ' · Terminal' : t.pay === 'personal' ? ' · Mi tarjeta' : ''}`;
    return `<li class="${t.type}"><span class="ico">${ico}</span>
      <div class="info"><b>${t.type === 'in' ? '+' : '−'}${money(t.type === 'in' ? t.amount + t.tip : t.amount)}</b><small>${sub}</small></div>
      <div class="act"><button data-edit="${t.id}" aria-label="Editar">✏️</button><button data-del="${t.id}" aria-label="Eliminar">🗑️</button></div></li>`;
  }).join('') : '<li class="empty">Aún no hay movimientos hoy.</li>';
}
$('#list').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.del) {
    if (confirm('¿Eliminar este registro?')) { db.tx = db.tx.filter(t => t.id != b.dataset.del); save(); renderAll(); }
  } else if (b.dataset.edit) {
    const t = db.tx.find(x => x.id == b.dataset.edit); if (!t) return;
    editId = t.id; setType(t.type); setPay(t.pay); setTipPay(t.tipPay || 'cash', true);
    $('#amount').value = t.amount / 100; $('#tip').value = t.tip ? t.tip / 100 : ''; $('#note').value = t.note || '';
    if (t.cat) $('#cat').value = t.cat;
    $('#btnCancel').hidden = false; $('#btnSubmit').textContent = 'Guardar cambios';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

/* ---------- Estadísticas de gastos ---------- */
function renderStats() {
  const p = $('#period').value, now = Date.now();
  const inPeriod = ts => p === 'all' || (p === 'day' && dayKey(ts) === dayKey(now)) ||
    (p === 'month' && monthKey(ts) === monthKey(now)) ||
    (p === 'week' && weekStart(ts).getTime() === weekStart(now).getTime());
  const byCat = {};
  db.tx.filter(t => t.type === 'out' && inPeriod(t.ts)).forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + t.amount);
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, r) => s + r[1], 0);
  $('#bars').innerHTML = rows.length
    ? rows.map(([c, v]) => { const pc = v / total * 100;
        return `<div class="bar"><div class="row"><span>${esc(c)}</span><span>${money(v)} · ${pc.toFixed(0)}%</span></div>
        <div class="track"><div class="fill" style="width:${pc}%"></div></div></div>`; }).join('') +
      `<div class="row" style="display:flex;justify-content:space-between"><b>Total gastado</b><b>${money(total)}</b></div>`
    : '<p class="empty">Sin gastos en este periodo.</p>';
}
$('#period').onchange = renderStats;

/* ---------- Resumen mensual / semanal ---------- */
/** Agrupa movimientos con keyFn y devuelve [clave, totales] ordenado de más reciente a más antiguo. */
function group(keyFn) {
  const g = {};
  db.tx.forEach(t => (g[keyFn(t.ts)] = g[keyFn(t.ts)] || []).push(t));
  return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0])).map(([k, l]) => [k, totals(l)]);
}
function tableHTML(rows, labelFn, withDelta) {
  if (!rows.length) return '<tr><td class="empty">Sin datos todavía.</td></tr>';
  return '<tr><th>Periodo</th><th>Ingreso total</th><th>Gastos</th><th>Neto</th><th>% neto</th>' + (withDelta ? '<th>vs ant.</th>' : '') + '</tr>' +
    rows.map(([k, t], i) => {
      const prev = rows[i + 1], d = prev ? t.net - prev[1].net : null;
      return `<tr><td>${labelFn(k)}</td><td>${money(t.income)}</td><td>${money(t.exp)}</td>
        <td class="${t.net >= 0 ? 'pos' : 'neg'}">${money(t.net)}</td><td>${t.income > 0 ? Math.round(t.net / t.income * 100) + '%' : '—'}</td>` +
        (withDelta ? `<td class="${d === null ? '' : d >= 0 ? 'pos' : 'neg'}">${d === null ? '—' : (d >= 0 ? '▲ ' : '▼ ') + money(Math.abs(d))}</td>` : '') + '</tr>';
    }).join('');
}
function renderMonth() {
  // Comparativo del mes actual: ingreso total vs gastos vs ganancia neta real
  const m = totals(db.tx.filter(t => monthKey(t.ts) === monthKey(Date.now())));
  const pc = x => m.income > 0 ? Math.max(0, Math.min(100, x / m.income * 100)) : 0;
  const bar = (label, val, cls, extra) => `<div class="bar"><div class="row"><span>${label}</span><b>${money(val)}${extra || ''}</b></div><div class="track"><div class="fill ${cls}" style="width:${pc(val)}%"></div></div></div>`;
  $('#cmp').innerHTML = (m.income || m.exp)
    ? bar('Ingreso total del mes', m.income, 'y') + `<small class="muted">Incluye propinas ${money(m.tips)}</small>` +
      bar('Gastos', m.exp, 'r') + bar('Ganancia neta real', m.net, 'g', ' · ' + pc(m.net).toFixed(0) + '%')
    : '<p class="empty">Sin movimientos este mes.</p>';
  $('#tMonth').innerHTML = tableHTML(group(monthKey), k => {
    const [y, mo] = k.split('-'); return new Date(y, mo - 1, 1).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
  }, true);
  $('#tWeek').innerHTML = tableHTML(group(ts => dayKey(weekStart(ts))).slice(0, 8), k => {
    const [y, mo, d] = k.split('-'); return 'Sem ' + new Date(y, mo - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }, false);
}

/* ---------- Metas de ahorro (varias) ---------- */
function renderGoal() {
  $('#goalList').innerHTML = db.goals.length ? db.goals.map(g => {
    const pc = g.target > 0 ? Math.min(100, g.saved / g.target * 100) : 0;
    return `<div class="panel"><div class="goal-title">${esc(g.name)}</div>
      <div class="goal-nums">${money(g.saved)} <small>de ${money(g.target)} (${pc.toFixed(0)}%)</small></div>
      <div class="track"><div class="fill g" style="width:${pc}%"></div></div>
      <div class="goalbtns">${[['pct', 'Abonar %'], ['man', 'Abonar $'], ['edit', '✏️'], ['del', '🗑️']]
        .map(([a, l]) => `<button data-g="${g.id}" data-a="${a}">${l}</button>`).join('')}</div></div>`;
  }).join('') : '<p class="empty">Aún no tienes metas. Agrega la primera abajo.</p>';
}
$('#btnGoal').onclick = () => {
  const name = $('#gName').value.trim(), target = cents($('#gTarget').value);
  if (!name || target <= 0) return alert('Escribe un nombre y un monto objetivo.');
  db.goals.push({ id: Date.now(), name, target, saved: 0, log: [] });
  $('#gName').value = ''; $('#gTarget').value = ''; save(); renderGoal(); toast('Meta agregada');
};
$('#goalList').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const g = db.goals.find(x => x.id == b.dataset.g); if (!g) return;
  const a = b.dataset.a, hoy = dayKey(Date.now());
  if (a === 'pct') {
    const pct = Math.min(100, Math.max(1, parseFloat($('#gPct').value) || 0));
    const net = totals(todayTx()).net;
    if (net <= 0) return alert('Hoy no hay ganancia neta para abonar.');
    // Solo se abona lo que falta para completar el % de hoy (no se duplica)
    const ya = g.log.filter(x => x.pct && dayKey(x.ts) === hoy).reduce((s, x) => s + x.amt, 0);
    const abono = Math.round(net * pct / 100) - ya;
    if (abono <= 0) return alert('Hoy ya abonaste ' + money(ya) + ' a esta meta, que cubre el ' + pct + '%.');
    g.saved += abono; g.log.push({ ts: Date.now(), amt: abono, pct: true }); toast('Abonaste ' + money(abono));
  } else if (a === 'man') {
    const v = cents(prompt('¿Cuánto abonas a "' + g.name + '"? ($)')); if (v <= 0) return;
    g.saved += v; g.log.push({ ts: Date.now(), amt: v }); toast('Abonaste ' + money(v));
  } else if (a === 'edit') {
    const n = prompt('Nombre de la meta:', g.name); if (n === null) return;
    const m = prompt('Monto objetivo ($):', g.target / 100); if (m === null) return;
    g.name = n.trim() || g.name; g.target = cents(m) || g.target;
  } else if (a === 'del') {
    if (!confirm('¿Eliminar la meta "' + g.name + '" y su ahorro registrado?')) return;
    db.goals = db.goals.filter(x => x !== g);
  }
  save(); renderGoal();
};

/* ---------- Navegación por pestañas ---------- */
$$('.nav button').forEach(b => b.onclick = () => {
  $$('.nav button').forEach(x => x.classList.toggle('on', x === b));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
  renderAll(); window.scrollTo(0, 0);
});

/* ---------- Selector de fecha ---------- */
$('#dateSel').onchange = e => { viewDate = e.target.value || dayKey(Date.now()); renderAll(); };
$('#btnToday').onclick = () => { viewDate = dayKey(Date.now()); $('#dateSel').value = viewDate; renderAll(); };

/* ---------- Atajos de servicio y propina ---------- */
function renderChips() {
  $('#presets').innerHTML = db.presets.map((p, i) => `<button type="button" data-p="${i}">${esc(p.n)} ${money(p.a)}</button>`).join('') +
    '<button type="button" data-p="edit" aria-label="Editar atajos">⚙️</button>';
  $('#tipChips').innerHTML = [10, 15, 20].map(p => `<button type="button" data-pct="${p}">Propina ${p}%</button>`).join('') +
    [10, 20, 50].map(v => `<button type="button" data-tip="${v}">$${v}</button>`).join('');
}
$('#presets').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.p === 'edit') { // formato: Nombre:monto, Nombre:monto
    const s = prompt('Atajos (Nombre:monto, separados por coma):', db.presets.map(p => p.n + ':' + p.a / 100).join(', '));
    if (s === null) return;
    db.presets = s.split(',').map(x => x.split(':')).filter(x => x[0].trim() && cents(x[1]) > 0).map(x => ({ n: x[0].trim(), a: cents(x[1]) }));
    save(); renderChips();
  } else { $('#amount').value = db.presets[b.dataset.p].a / 100; $('#amount').focus(); }
};
$('#tipChips').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pct) { // % sobre el monto del servicio, redondeado al peso
    const base = parseFloat($('#amount').value); if (!(base > 0)) return $('#amount').focus();
    $('#tip').value = Math.round(base * b.dataset.pct / 100);
  } else $('#tip').value = b.dataset.tip;
};

/* ---------- Respaldo de datos ---------- */
$('#btnExport').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
  a.download = 'barberflow-' + dayKey(Date.now()) + '.json'; a.click();
};
$('#fileImport').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  f.text().then(txt => {
    try {
      if (!Array.isArray(JSON.parse(txt).tx)) throw 0;
      if (!confirm('Esto reemplaza todos tus datos actuales. ¿Continuar?')) return;
      localStorage.setItem(KEY, txt); db = load(); renderChips(); renderAll(); toast('Respaldo cargado');
    } catch (_) { alert('El archivo no es un respaldo válido de BarberFlow.'); }
  });
};
// Pide al navegador no borrar los datos por falta de espacio o inactividad
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
// App instalable / sin internet
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');

/* ---------- Render general e inicio ---------- */
function renderAll() { renderDash(); renderList(); renderStats(); renderMonth(); renderGoal(); }
fillCats(); renderChips(); setType('in'); $('#dateSel').value = viewDate; $('#dateSel').max = viewDate; renderAll();
// Refresca al cambiar de día si la app queda abierta
setInterval(renderDash, 60000);
