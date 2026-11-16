// dodgefont UI
const VER = '1.0.0';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const tick = () => new Promise(r => setTimeout(r));
const get = (o, k) => k.split('.').reduce((a, b) => a[b], o);
const set = (o, k, v) => { const ks = k.split('.'), l = ks.pop(); ks.reduce((a, b) => a[b], o)[l] = v; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PRESETS = [['inter', 'Inter'], ['space-grotesk', 'Space Grotesk'], ['archivo', 'Archivo'], ['playfair-display', 'Playfair Display'], ['dm-serif-display', 'DM Serif Display'], ['fraunces', 'Fraunces'], ['roboto-mono', 'Roboto Mono']];
const HINTS = {
  outline: '베이스 폰트의 윤곽선을 가져와 굵기·폭·기울기·라운드·이펙트를 입힙니다.',
  modular: '윤곽선을 그리드에 스냅해 기하학적 모듈 서체로 재구성합니다. "그리드" 값이 해상도입니다.',
  pixel: '격자 위에 직접 그리는 비트맵 엔진. 베이스 폰트로 자동 픽셀화한 뒤 편집하세요.',
};

const DEFAULTS = () => ({
  name: 'Dodge Sans', engine: 'outline', preset: 'inter', charset: 'latin', extra: '',
  style: { weight: 0, width: 100, slant: 0, round: 0, tracking: 0, snap: 40, join: 'round', effect: 'none', fx: 30, module: 'square', moduleSize: 100 },
  instances: [
    { name: 'Thin', weightClass: 100, delta: -45, on: true }, { name: 'Light', weightClass: 300, delta: -22, on: true },
    { name: 'Regular', weightClass: 400, delta: 0, on: true }, { name: 'Medium', weightClass: 500, delta: 14, on: true },
    { name: 'Bold', weightClass: 700, delta: 38, on: true }, { name: 'Black', weightClass: 900, delta: 70, on: true },
  ],
  italic: false, italicAngle: 10,
  scale: { base: 16, ratio: 1.333 },
  roles: [
    { name: 'Display', inst: 'Black', step: 6 }, { name: 'H1', inst: 'Bold', step: 4 }, { name: 'H2', inst: 'Bold', step: 3 },
    { name: 'H3', inst: 'Medium', step: 2 }, { name: 'Body', inst: 'Regular', step: 0 }, { name: 'Caption', inst: 'Light', step: -1 },
  ],
  sample: { head: 'Dodge the ordinary type.', body: 'Quick zephyrs blow, vexing daft Jim. A typeface is a voice; give it weight, rhythm and hierarchy, then ship it to every desk.' },
  pixel: { rows: 12, desc: 3, glyphs: {} },
  tab: 'specimen', glyphInst: 'Regular',
});

let state = DEFAULTS(), src = null, srcUpload = null; // srcUpload: ArrayBuffer of a user font
try { const s = JSON.parse(localStorage.getItem('dodgefont') || 'null'); if (s) state = Object.assign(DEFAULTS(), s); } catch {}
const save = () => { try { localStorage.setItem('dodgefont', JSON.stringify(state)); } catch {} };
const status = t => $('#status').textContent = t;

// ---------- source font ----------
async function loadSource(buf, label) {
  try { src = opentype.parse(buf); }
  catch (e) { status('폰트를 읽지 못했습니다 (WOFF2는 미지원 — TTF/OTF/WOFF 사용): ' + e.message); return; }
  status(label + ' · ' + src.numGlyphs + ' glyphs');
  if (state.engine === 'pixel' && !Object.keys(state.pixel.glyphs).length) reseedPixels();
  schedule();
}
async function loadPreset(id) {
  const p = PRESETS.find(x => x[0] === id) || PRESETS[0];
  status(p[1] + ' 불러오는 중…');
  try {
    const r = await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${p[0]}@latest/latin-400-normal.woff`);
    if (!r.ok) throw new Error(r.status);
    srcUpload = null; await loadSource(await r.arrayBuffer(), p[1]);
  } catch (e) { status('프리셋을 불러오지 못했습니다: ' + e.message); }
}
$('#preset').innerHTML = PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') + '<option value="upload" disabled>업로드한 폰트</option>';
$('#preset').onchange = e => { state.preset = e.target.value; save(); loadPreset(state.preset); };
$('#srcFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  srcUpload = await f.arrayBuffer(); state.preset = 'upload'; $('#preset').value = 'upload';
  if (state.name === 'Dodge Sans') { state.name = f.name.replace(/\.\w+$/, '').replace(/[-_].*/, '') + ' Dodge'; $('#family').value = state.name; }
  await loadSource(srcUpload.slice(0), f.name); save();
};

// ---------- bindings ----------
function syncControls() {
  $('#family').value = state.name;
  for (const el of $$('[data-k]')) {
    const v = get(state, el.dataset.k);
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
    const out = el.parentElement.querySelector('output'); if (out) out.textContent = v;
  }
  for (const box of $$('[data-chips]')) for (const b of box.children) b.classList.toggle('on', b.dataset.v === get(state, box.dataset.chips));
  for (const b of $('#engine').children) b.classList.toggle('on', b.dataset.v === state.engine);
  $('#engineHint').textContent = HINTS[state.engine];
  $('#snapRow').hidden = state.engine !== 'modular';
  $('#moduleBox').hidden = state.engine !== 'pixel';
  $('#charsetBox').hidden = state.engine === 'pixel';
  $('#tabs [data-v=pixel]').hidden = state.engine !== 'pixel';
  if (state.engine !== 'pixel' && state.tab === 'pixel') state.tab = 'specimen';
  for (const b of $('#tabs').children) b.classList.toggle('on', b.dataset.v === state.tab);
  for (const v of ['specimen', 'glyphs', 'pixel']) $('#view-' + v).hidden = state.tab !== v;
  $('#preset').value = state.preset;
  $('#pxRows').value = state.pixel.rows; $('#pxDesc').value = state.pixel.desc;
  renderTables();
}
document.addEventListener('input', e => {
  const k = e.target.dataset.k; if (!k) return;
  const el = e.target, v = el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.type === 'number') ? Number(el.value) : el.value;
  set(state, k, v);
  const out = el.parentElement.querySelector('output'); if (out) out.textContent = v;
  schedule();
});
$('#family').oninput = e => { state.name = e.target.value.trim() || 'Untitled'; save(); };
for (const box of $$('[data-chips]')) box.onclick = e => { const b = e.target.closest('button'); if (!b) return; set(state, box.dataset.chips, b.dataset.v); syncControls(); schedule(); };
$('#engine').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.engine = b.dataset.v;
  if (state.engine === 'pixel') { if (!Object.keys(state.pixel.glyphs).length) reseedPixels(); state.tab = 'pixel'; }
  syncControls(); schedule();
};
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; state.tab = b.dataset.v; syncControls(); schedule(); };
$('#theme').onclick = () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'light' ? 'dark' : 'light'; drawPx(); };
if (matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';

// ---------- family + role tables ----------
const instNames = () => state.instances.map(i => i.name);
function renderTables() {
  $('#insts').innerHTML = '<tr><td></td><td><small>이름</small></td><td><small>wght</small></td><td><small>굵기 ±</small></td><td></td></tr>' + state.instances.map((s, i) => `<tr>
    <td><input type="checkbox" data-i="${i}" data-f="on" ${s.on ? 'checked' : ''} aria-label="포함"></td>
    <td><input type="text" data-i="${i}" data-f="name" value="${esc(s.name)}"></td>
    <td><input type="number" data-i="${i}" data-f="weightClass" value="${s.weightClass}" min="1" max="1000" step="100"></td>
    <td><input type="number" data-i="${i}" data-f="delta" value="${s.delta}" step="2"></td>
    <td><button class="x" data-del="${i}" aria-label="삭제">×</button></td></tr>`).join('');
  const opts = sel => instNames().map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
  $('#roleTable').innerHTML = state.roles.map((r, i) => `<tr>
    <td><input type="text" data-r="${i}" data-f="name" value="${esc(r.name)}"></td>
    <td><select data-r="${i}" data-f="inst">${opts(r.inst)}</select></td>
    <td><input type="number" data-r="${i}" data-f="step" value="${r.step}" min="-3" max="10" aria-label="스케일 단계"></td></tr>`).join('');
  $('#glyphInst').innerHTML = opts(state.glyphInst);
}
function tableEdit(e) {
  const el = e.target, f = el.dataset.f; if (!f) return;
  const row = el.dataset.i != null ? state.instances[el.dataset.i] : el.dataset.r != null ? state.roles[el.dataset.r] : null; if (!row) return;
  const old = row.name;
  row[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  if (el.dataset.i != null && f === 'name') { // keep role / preview references pointing at the renamed weight
    for (const r of state.roles) if (r.inst === old) r.inst = row.name;
    if (state.glyphInst === old) state.glyphInst = row.name;
    if (e.type === 'change') renderTables();
  }
  schedule();
}
for (const t of ['#insts', '#roleTable']) { $(t).addEventListener('input', tableEdit); $(t).addEventListener('change', tableEdit); }
$('#insts').onclick = e => {
  const d = e.target.dataset.del; if (d == null || state.instances.length < 2) return;
  state.instances.splice(d, 1); renderTables(); schedule();
};
$('#addInst').onclick = () => {
  const last = state.instances[state.instances.length - 1];
  state.instances.push({ name: 'Weight ' + (state.instances.length + 1), weightClass: Math.min(1000, last.weightClass + 100), delta: last.delta + 20, on: true });
  renderTables(); schedule();
};
$('#glyphInst').onchange = e => { state.glyphInst = e.target.value; schedule(); };

// ---------- building ----------
const cfgNow = () => ({ engine: state.engine, src, pixel: state.pixel, style: state.style, family: state.name, charset: state.charset, extra: state.extra });
const ready = () => state.engine === 'pixel' ? Object.keys(state.pixel.glyphs).length > 0 : !!src;
const instByName = n => state.instances.find(i => i.name === n) || state.instances[0];
const variants = () => state.instances.filter(i => i.on).flatMap(inst => state.italic ? [{ inst, italic: false }, { inst, italic: true }] : [{ inst, italic: false }]);
const build = (v, chars) => DF.buildFont(cfgNow(), v.inst, { italic: v.italic, italicAngle: state.italicAngle, chars });

let timer = 0, gen = 0;
const faces = new Map();
function schedule() { save(); clearTimeout(timer); timer = setTimeout(render, 140); }
async function face(key, buf, my) {
  const fam = `df-${key}-${my}`.replace(/[^\w-]/g, '_');
  const f = new FontFace(fam, buf);
  await f.load();
  document.fonts.add(f);
  if (faces.has(key)) document.fonts.delete(faces.get(key));
  faces.set(key, f);
  return `'${fam}', system-ui`;
}
async function render() {
  if (state.tab === 'pixel') drawPx();
  if (!ready()) return;
  const my = ++gen, t0 = performance.now();
  try {
    const fam = {};
    if (state.tab === 'glyphs') {
      const chars = DF.charsetOf(cfgNow()).slice(0, 800);
      fam.g = await face('g', build({ inst: instByName(state.glyphInst), italic: false }, chars).buf, my);
      if (my !== gen) return;
      $('#glyphGrid').innerHTML = chars.filter(c => c !== ' ').map(c => `<div data-c="${esc(c)}" style="font-family:${fam.g}"><span>${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}</span>${esc(c)}</div>`).join('');
    }
    if (state.tab === 'specimen') {
      const chars = [...new Set(state.sample.head + state.sample.body + state.roles.map(r => r.name).join('') + 'Aa')];
      const vs = variants(), wanted = new Set(state.roles.map(r => r.inst));
      for (const n of wanted) if (!vs.some(v => v.inst.name === n && !v.italic)) vs.push({ inst: instByName(n), italic: false });
      for (const v of vs) {
        await tick(); if (my !== gen) return;
        fam[v.inst.name + (v.italic ? '-i' : '')] = await face(v.inst.name + (v.italic ? '-i' : ''), build(v, chars).buf, my);
      }
      if (my !== gen) return;
      const { base, ratio } = state.scale;
      $('#roles').innerHTML = state.roles.map(r => {
        const px = Math.round(base * ratio ** r.step * 10) / 10, body = r.step <= 0;
        return `<div class="role"><small>${esc(r.name)}<br>${esc(r.inst)} · ${px}px</small><div class="t ${body ? 'body' : ''}" style="font-family:${fam[r.inst]};font-size:${px}px">${esc(body ? state.sample.body : state.sample.head)}</div></div>`;
      }).join('');
      $('#waterfall').innerHTML = variants().map(v => `<div style="font-family:${fam[v.inst.name + (v.italic ? '-i' : '')]};font-size:34px"><small>${esc(v.inst.name)}${v.italic ? ' Italic' : ''} · ${v.inst.weightClass}</small>${esc(state.sample.head)}</div>`).join('');
    }
    status(`미리보기 ${Math.round(performance.now() - t0)}ms`);
  } catch (e) { console.error(e); status('미리보기 오류: ' + e.message); }
}
$('#glyphGrid').onclick = e => {
  const c = e.target.closest('[data-c]')?.dataset.c; if (!c || state.engine !== 'pixel') return;
  if (!state.pixel.glyphs[c]) seedOne(c);
  pxCur = c; state.tab = 'pixel'; syncControls(); schedule();
};

// ---------- pixel engine editor ----------
let pxCur = 'A', painting = null;
const scratch = document.createElement('canvas');
function seedOne(ch) {
  const r = src && DF.rasterize(src, ch, state.pixel.rows, state.pixel.desc, scratch);
  state.pixel.glyphs[ch] = r || { cols: Math.round(state.pixel.rows * 0.6), bits: Array(state.pixel.rows).fill('0'.repeat(Math.round(state.pixel.rows * 0.6))) };
}
function reseedPixels() {
  if (!src) { status('픽셀화하려면 베이스 폰트가 필요합니다'); return; }
  state.pixel.glyphs = {};
  for (let c = 0x21; c < 0x7f; c++) { const ch = String.fromCharCode(c), r = DF.rasterize(src, ch, state.pixel.rows, state.pixel.desc, scratch); if (r) state.pixel.glyphs[ch] = r; }
  for (const ch of state.extra || '') if (ch.trim()) seedOne(ch);
  if (!state.pixel.glyphs[pxCur]) pxCur = Object.keys(state.pixel.glyphs)[0];
}
function drawPx() {
  const keys = Object.keys(state.pixel.glyphs).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  $('#pxList').innerHTML = keys.map(k => `<button data-c="${esc(k)}" class="${k === pxCur ? 'on' : ''}">${esc(k)}</button>`).join('');
  const g = state.pixel.glyphs[pxCur], cv = $('#px'); if (!g) return;
  const R = state.pixel.rows, cell = Math.max(10, Math.min(36, Math.floor(520 / R))), css = getComputedStyle(document.documentElement);
  cv.width = g.cols * cell; cv.height = R * cell;
  const x = cv.getContext('2d');
  x.fillStyle = css.getPropertyValue('--field'); x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = css.getPropertyValue('--ink');
  g.bits.forEach((row, r) => [...row].forEach((b, c) => { if (b === '1') x.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2); }));
  x.strokeStyle = css.getPropertyValue('--line'); x.beginPath();
  for (let c = 0; c <= g.cols; c++) { x.moveTo(c * cell + .5, 0); x.lineTo(c * cell + .5, cv.height); }
  for (let r = 0; r <= R; r++) { x.moveTo(0, r * cell + .5); x.lineTo(cv.width, r * cell + .5); }
  x.stroke();
  x.strokeStyle = css.getPropertyValue('--acc'); x.lineWidth = 2; x.beginPath();
  x.moveTo(0, (R - state.pixel.desc) * cell); x.lineTo(cv.width, (R - state.pixel.desc) * cell); x.stroke();
}
function paintAt(e) {
  const cv = $('#px'), g = state.pixel.glyphs[pxCur], b = cv.getBoundingClientRect();
  const c = Math.floor((e.clientX - b.left) / b.width * g.cols), r = Math.floor((e.clientY - b.top) / b.height * state.pixel.rows);
  if (c < 0 || r < 0 || c >= g.cols || r >= state.pixel.rows) return;
  if (painting == null) painting = g.bits[r][c] === '1' ? '0' : '1';
  g.bits[r] = g.bits[r].slice(0, c) + painting + g.bits[r].slice(c + 1);
  drawPx();
}
$('#px').onpointerdown = e => { e.target.setPointerCapture(e.pointerId); painting = null; paintAt(e); };
$('#px').onpointermove = e => { if (e.buttons) paintAt(e); };
$('#px').onpointerup = () => { painting = null; schedule(); };
$('#pxList').onclick = e => { const c = e.target.dataset.c; if (c) { pxCur = c; drawPx(); } };
$('#pxReseed').onclick = () => { state.pixel.rows = Number($('#pxRows').value) || 12; state.pixel.desc = Math.min(state.pixel.rows - 1, Number($('#pxDesc').value) || 0); reseedPixels(); syncControls(); schedule(); };
$('#pxSeedOne').onclick = () => { seedOne(pxCur); schedule(); };
$('#pxClear').onclick = () => { const g = state.pixel.glyphs[pxCur]; g.bits = g.bits.map(r => '0'.repeat(r.length)); schedule(); };
$('#pxWide').onclick = () => { const g = state.pixel.glyphs[pxCur]; g.cols++; g.bits = g.bits.map(r => r + '0'); schedule(); };
$('#pxNarrow').onclick = () => { const g = state.pixel.glyphs[pxCur]; if (g.cols < 2) return; g.cols--; g.bits = g.bits.map(r => r.slice(0, -1)); schedule(); };
$('#pxAdd').onchange = e => { const ch = [...e.target.value][0]; e.target.value = ''; if (!ch || !ch.trim()) return; if (!state.pixel.glyphs[ch]) seedOne(ch); pxCur = ch; schedule(); };

// ---------- export ----------
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const slug = () => state.name.replace(/[^A-Za-z0-9]/g, '') || 'Dodgefont';
const README = {
  mac: n => `${n} — macOS 설치\n\n1) 모든 .otf 파일을 선택하고 더블클릭 → "서체 관리자(Font Book)"에서 [설치].\n2) 또는 install.command 를 더블클릭하면 ~/Library/Fonts 로 복사합니다.\n   (처음 실행 시 차단되면: 우클릭 → 열기)\n\n설치 후 앱을 다시 실행하면 "${n}" 패밀리 아래 웨이트가 묶여 보입니다.\n\nmade with dodgefont`,
  windows: n => `${n} — Windows 설치\n\n1) .otf 파일들을 모두 선택 → 우클릭 → [모든 사용자용으로 설치] (또는 [설치]).\n2) 또는 install.ps1 을 우클릭 → [PowerShell에서 실행] (현재 사용자에게 설치, 관리자 권한 불필요).\n\nWord 등에서는 Regular/Bold/Italic 은 "${n}" 아래로, 그 외 웨이트는 "${n} Light" 처럼 별도 이름으로 나타납니다 (Windows 표준 방식).\n\nmade with dodgefont`,
};
const SCRIPTS = {
  mac: ['install.command', '#!/bin/sh\ncd "$(dirname "$0")" && cp -f *.otf "$HOME/Library/Fonts/" && echo "설치 완료 — 앱을 다시 실행하세요."\n'],
  windows: ['install.ps1', '$dst = "$env:LOCALAPPDATA\\Microsoft\\Windows\\Fonts"\r\nNew-Item -ItemType Directory -Force $dst | Out-Null\r\nGet-ChildItem -Path $PSScriptRoot -Filter *.otf | ForEach-Object {\r\n  Copy-Item $_.FullName $dst -Force\r\n  New-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" -Name "$($_.BaseName) (OpenType)" -Value "$dst\\$($_.Name)" -PropertyType String -Force | Out-Null\r\n}\r\nWrite-Host "설치 완료 — 앱을 다시 실행하세요."\r\n'],
};
async function busy(fn) {
  const btns = $$('header .btn'); btns.forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { console.error(e); status('내보내기 오류: ' + e.message); } finally { btns.forEach(b => b.disabled = false); }
}
for (const b of $$('[data-os]')) b.onclick = () => busy(async () => {
  if (!ready()) return status('먼저 베이스 폰트나 픽셀 글리프를 준비하세요');
  const os = b.dataset.os, vs = variants(), zip = new JSZip(), dir = zip.folder(`${slug()}-${os}`);
  for (const [i, v] of vs.entries()) {
    status(`${i + 1}/${vs.length} ${v.inst.name}${v.italic ? ' Italic' : ''} 생성 중…`); await tick();
    const r = build(v); dir.file(r.file, r.buf);
  }
  dir.file(os === 'mac' ? '설치방법_macOS.txt' : '설치방법_Windows.txt', README[os](state.name));
  dir.file(SCRIPTS[os][0], SCRIPTS[os][1], { unixPermissions: 0o755 });
  download(await zip.generateAsync({ type: 'blob', platform: 'UNIX' }), `${slug()}-${os}.zip`);
  status(`${vs.length}개 스타일을 ${os === 'mac' ? 'macOS' : 'Windows'}용으로 내보냈습니다`);
});
$('#exportOne').onclick = () => busy(async () => {
  if (!ready()) return;
  status('생성 중…'); await tick();
  const r = build({ inst: instByName(state.glyphInst), italic: false });
  download(new Blob([r.buf], { type: 'font/otf' }), r.file);
  status(`${r.file} · ${r.glyphCount} glyphs`);
});

// ---------- project files ----------
$('#saveProj').onclick = () => {
  const p = { app: 'dodgefont', ver: VER, ...state };
  if (srcUpload) p.srcB64 = btoa(Array.from(new Uint8Array(srcUpload), c => String.fromCharCode(c)).join(''));
  download(new Blob([JSON.stringify(p)], { type: 'application/json' }), slug() + '.dodgefont.json');
};
$('#loadProj').onclick = () => $('#projFile').click();
$('#projFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const p = JSON.parse(await f.text()); if (p.app !== 'dodgefont') throw new Error('dodgefont 프로젝트가 아닙니다');
    const { srcB64, app, ver, ...rest } = p;
    state = Object.assign(DEFAULTS(), rest); syncControls();
    if (srcB64) { srcUpload = Uint8Array.from(atob(srcB64), c => c.charCodeAt(0)).buffer; await loadSource(srcUpload.slice(0), f.name); }
    else await loadPreset(state.preset === 'upload' ? 'inter' : state.preset);
  } catch (err) { status('프로젝트를 열지 못했습니다: ' + err.message); }
  e.target.value = '';
};

// ---------- boot ----------
syncControls();
loadPreset(state.preset === 'upload' ? (state.preset = 'inter') : state.preset);
