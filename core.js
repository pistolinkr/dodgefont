// dodgefont core — outline engines, style pipeline, OTF building. No DOM here (runs in node for check.mjs).
(function (G) {
  const C = G.ClipperLib, OT = G.opentype;
  const S = 4; // Clipper works on integers: font units × S
  const JOIN = { round: C.JoinType.jtRound, miter: C.JoinType.jtMiter, square: C.JoinType.jtSquare };

  // ---------- geometry ----------
  function flatten(cmds) {
    const out = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0;
    const P = (px, py) => cur.push({ X: Math.round(px * S), Y: Math.round(py * S) });
    for (const c of cmds) {
      if (c.type === 'M') { cur = []; out.push(cur); x = sx = c.x; y = sy = c.y; P(x, y); continue; }
      if (c.type === 'Z') { x = sx; y = sy; continue; }
      if (!cur) { cur = []; out.push(cur); P(x, y); }
      if (c.type === 'L') P(c.x, c.y);
      else if (c.type === 'Q') for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t; P(u*u*x + 2*u*t*c.x1 + t*t*c.x, u*u*y + 2*u*t*c.y1 + t*t*c.y); }
      else if (c.type === 'C') for (let i = 1; i <= 10; i++) { const t = i / 10, u = 1 - t; P(u*u*u*x + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x, u*u*u*y + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y); }
      x = c.x; y = c.y;
    }
    return out.filter(p => p.length > 2);
  }
  function bool(type, a, b) {
    const c = new C.Clipper(), o = [];
    c.AddPaths(a, C.PolyType.ptSubject, true);
    if (b && b.length) c.AddPaths(b, C.PolyType.ptClip, true);
    c.Execute(type, o, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return o;
  }
  const union = (a, b) => bool(C.ClipType.ctUnion, a, b);
  const diff = (a, b) => bool(C.ClipType.ctDifference, a, b);
  function offset(p, d, join = 'round') {
    if (!d || !p.length) return p;
    const co = new C.ClipperOffset(2, S * 0.6), o = [];
    co.AddPaths(p, JOIN[join], C.EndType.etClosedPolygon);
    co.Execute(o, d * S);
    return o;
  }
  const map = (p, f) => p.map(r => r.map(f));
  const move = (p, dx, dy) => map(p, q => ({ X: q.X + Math.round(dx * S), Y: q.Y + Math.round(dy * S) }));
  const rect = (x0, y0, x1, y1) => [[{X:x0*S,Y:y0*S},{X:x1*S,Y:y0*S},{X:x1*S,Y:y1*S},{X:x0*S,Y:y1*S}].map(q => ({ X: Math.round(q.X), Y: Math.round(q.Y) }))];

  // ---------- engines: produce {polys, adv} in output units ----------
  function srcShape(font, ch) {
    const g = font.charToGlyph(ch);
    if (!g || !g.index) return null;
    return { key: g.index, polys: union(flatten(g.path.commands)), adv: g.advanceWidth };
  }
  function moduleShape(shape, cx, cy, r) {
    if (shape === 'circle') return Array.from({ length: 20 }, (_, i) => ({ X: Math.round((cx + r * Math.cos(i * Math.PI / 10)) * S), Y: Math.round((cy + r * Math.sin(i * Math.PI / 10)) * S) }));
    if (shape === 'diamond') return [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]].map(([X, Y]) => ({ X: Math.round(X * S), Y: Math.round(Y * S) }));
    return rect(cx - r, cy - r, cx + r, cy + r)[0];
  }
  function pixelShape(px, st, ch) {
    const g = px.glyphs[ch], cell = 1000 / px.rows;
    if (!g) return ch === ' ' ? { key: 'p ', polys: [], adv: 400 } : null;
    const r = cell / 2 * st.moduleSize / 100, polys = [];
    g.bits.forEach((row, ri) => [...row].forEach((b, ci) => {
      if (b === '1') polys.push(moduleShape(st.module, (ci + 0.5) * cell, (px.rows - px.desc - ri - 0.5) * cell, r));
    }));
    return { key: 'p' + ch, polys: union(polys), adv: g.cols * cell };
  }

  // ---------- style pipeline ----------
  // inst: {delta, slant}. Units in style are per-1000 em; k rescales to the font's UPM.
  function stylize(shape, st, inst, upm, engine) {
    const k = upm / 1000, w = st.width / 100;
    let p = shape.polys;
    if (engine === 'modular') { const g = st.snap * k * S; p = union(map(p, q => ({ X: Math.round(q.X / g) * g, Y: Math.round(q.Y / g) * g }))); }
    if (w !== 1) p = map(p, q => ({ X: Math.round(q.X * w), Y: q.Y }));
    const d = (st.weight + (inst.delta || 0)) * k;
    p = offset(p, d, st.join);
    if (st.round) { const r = st.round * k; p = offset(offset(p, -r), r); p = offset(offset(p, r), -r); }
    const fx = st.fx * k; let extra = 0;
    if (st.effect === 'outline') p = diff(p, offset(p, -fx, st.join));
    else if (st.effect === 'inline') p = diff(p, diff(offset(p, -fx, st.join), offset(p, -fx * 1.5, st.join)));
    else if (st.effect === 'stencil') { const y = upm * 0.25; p = diff(p, rect(-upm * 2, y - fx / 2, upm * 4, y + fx / 2)); }
    else if (st.effect === 'shadow') { p = union(p, diff(move(p, fx, -fx), offset(p, fx * 0.4))); extra = fx; }
    const t = Math.tan(((st.slant || 0) + (inst.slant || 0)) * Math.PI / 180);
    const dx = d + st.tracking * k / 2;
    p = map(p, q => ({ X: Math.round(q.X + q.Y * t + dx * S), Y: q.Y }));
    p = C.Clipper.CleanPolygons(p, S * 0.6).filter(r => r.length > 2);
    const path = new OT.Path();
    for (const r of p) { r.forEach((q, i) => path[i ? 'lineTo' : 'moveTo'](Math.round(q.X / S), Math.round(q.Y / S))); path.close(); }
    return { path, adv: Math.max(0, Math.round(shape.adv * w + 2 * d + st.tracking * k + extra)) };
  }

  // ---------- naming (Windows/Mac style linking) ----------
  function names(family, instName, italic) {
    const base = instName.trim() || 'Regular';
    const style = italic ? (base === 'Regular' ? 'Italic' : base + ' Italic') : base;
    const ribbi = base === 'Regular' || base === 'Bold';
    const bold = base === 'Bold';
    return {
      style, bold,
      legacyFamily: ribbi ? family : family + ' ' + base,
      legacyStyle: ribbi ? style : (italic ? 'Italic' : 'Regular'),
      ps: (family.replace(/[^A-Za-z0-9]/g, '') || 'Dodgefont') + '-' + style.replace(/[^A-Za-z0-9]/g, ''),
    };
  }

  // Patch head.macStyle + post.italicAngle (opentype.js leaves them 0) and fix checksums.
  function patchStyle(buf, bold, italic, angle) {
    const dv = new DataView(buf), n = dv.getUint16(4), recs = {};
    for (let i = 0; i < n; i++) { const o = 12 + 16 * i; recs[String.fromCharCode(...new Uint8Array(buf, o, 4))] = o; }
    const sum = (off, len) => { let s = 0; for (let i = 0; i < len; i += 4) s = (s + (i + 4 <= len ? dv.getUint32(off + i) : new Uint8Array(buf, off + i, len - i).reduce((a, b, j) => a + (b << (24 - 8 * j)), 0))) >>> 0; return s; };
    const tbl = t => ({ rec: recs[t], off: dv.getUint32(recs[t] + 8), len: dv.getUint32(recs[t] + 12) });
    const head = tbl('head'), post = tbl('post');
    dv.setUint16(head.off + 44, (bold ? 1 : 0) | (italic ? 2 : 0));
    dv.setInt32(post.off + 4, Math.round(-angle * 65536));
    dv.setUint32(head.off + 8, 0);
    for (const t of [head, post]) dv.setUint32(t.rec + 4, sum(t.off, t.len));
    dv.setUint32(head.off + 8, (0xB1B0AFBA - sum(0, buf.byteLength & ~3)) >>> 0);
    return buf;
  }

  // ---------- font building ----------
  function charsetOf(cfg) {
    let cps = [];
    if (cfg.engine === 'pixel') cps = [' ', ...Object.keys(cfg.pixel.glyphs)].map(c => c.codePointAt(0));
    else if (cfg.charset === 'all' && cfg.src) cps = Object.keys(cfg.src.tables.cmap.glyphIndexMap).map(Number);
    else { for (let c = 0x20; c < 0x7f; c++) cps.push(c); for (let c = 0xa0; c <= 0xff; c++) cps.push(c); }
    for (const ch of cfg.extra || '') cps.push(ch.codePointAt(0));
    return [...new Set(cps)].map(c => String.fromCodePoint(c));
  }

  // cfg: {engine, src, pixel, style, family}; inst: {name, weightClass, delta}; opts: {italic, italicAngle, chars}
  function buildFont(cfg, inst, opts = {}) {
    const pix = cfg.engine === 'pixel', px = cfg.pixel;
    const upm = pix ? 1000 : cfg.src.unitsPerEm;
    const asc = pix ? Math.round((px.rows - px.desc) * 1000 / px.rows) : cfg.src.ascender;
    const desc = pix ? -Math.round(px.desc * 1000 / px.rows) : Math.min(0, cfg.src.descender);
    const italic = !!opts.italic, slant = italic ? opts.italicAngle || 0 : 0;
    const glyphs = [new OT.Glyph({ name: '.notdef', advanceWidth: Math.round(upm / 2), path: new OT.Path() })];
    const byKey = new Map();
    for (const ch of opts.chars || charsetOf(cfg)) {
      const cp = ch.codePointAt(0);
      const shape = pix ? pixelShape(px, cfg.style, ch) : srcShape(cfg.src, ch);
      if (!shape) continue;
      if (byKey.has(shape.key)) { byKey.get(shape.key).unicodes.push(cp); continue; }
      const { path, adv } = stylize(shape, cfg.style, { delta: inst.delta, slant }, upm, cfg.engine);
      const hex = cp.toString(16).toUpperCase();
      const g = new OT.Glyph({ name: cp > 0xffff ? 'u' + hex : 'uni' + hex.padStart(4, '0'), unicode: cp, advanceWidth: adv, path });
      g.unicodes = [cp];
      byKey.set(shape.key, g); glyphs.push(g);
    }
    const nm = names(cfg.family, inst.name, italic);
    const font = new OT.Font({
      familyName: nm.legacyFamily, styleName: nm.legacyStyle, fullName: cfg.family + ' ' + nm.style, postScriptName: nm.ps,
      designer: 'dodgefont', manufacturer: 'dodgefont', version: 'Version 1.000',
      unitsPerEm: upm, ascender: asc, descender: desc, glyphs,
      weightClass: inst.weightClass || 400,
      fsSelection: (italic ? 1 : 0) | (nm.bold ? 32 : 0) | (!italic && !nm.bold ? 64 : 0),
    });
    font.names.preferredFamily = { en: cfg.family };
    font.names.preferredSubfamily = { en: nm.style };
    const buf = patchStyle(font.toArrayBuffer(), nm.bold, italic, slant);
    return { buf, file: nm.ps + '.otf', style: nm.style, glyphCount: glyphs.length };
  }

  // Pixelate one glyph of a source font. canvas: any 2D-capable canvas (OffscreenCanvas / <canvas>).
  function rasterize(font, ch, rows, desc, canvas, threshold = 0.42) {
    const g = font.charToGlyph(ch);
    if (!g || !g.index) return null;
    const ss = 8, cols = Math.max(1, Math.round(g.advanceWidth / font.unitsPerEm * rows));
    canvas.width = cols * ss; canvas.height = rows * ss;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const p = g.getPath(0, (rows - desc) * ss, rows * ss); p.fill = '#000'; p.draw(ctx);
    const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data, bits = [];
    for (let r = 0; r < rows; r++) {
      let row = '';
      for (let c = 0; c < cols; c++) {
        let s = 0;
        for (let y = 0; y < ss; y++) for (let x = 0; x < ss; x++) s += a[((r * ss + y) * canvas.width + c * ss + x) * 4 + 3];
        row += s / (ss * ss * 255) > threshold ? '1' : '0';
      }
      bits.push(row);
    }
    return { cols, bits };
  }

  G.DF = { buildFont, charsetOf, rasterize, names, patchStyle };
})(typeof window !== 'undefined' ? window : globalThis);
