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
  // one pixel-grid cell → list of rings (dot-matrix, LED, CRT scanline, cross-stitch …)
  function moduleShape(shape, cx, cy, r) {
    if (shape === 'circle') return [Array.from({ length: 20 }, (_, i) => ({ X: Math.round((cx + r * Math.cos(i * Math.PI / 10)) * S), Y: Math.round((cy + r * Math.sin(i * Math.PI / 10)) * S) }))];
    if (shape === 'diamond') return [[[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]].map(([X, Y]) => ({ X: Math.round(X * S), Y: Math.round(Y * S) }))];
    if (shape === 'hline') return rect(cx - r, cy - r * 0.42, cx + r, cy + r * 0.42);
    if (shape === 'vline') return rect(cx - r * 0.42, cy - r, cx + r * 0.42, cy + r);
    if (shape === 'cross') return [...rect(cx - r, cy - r * 0.3, cx + r, cy + r * 0.3), ...rect(cx - r * 0.3, cy - r, cx + r * 0.3, cy + r)];
    return rect(cx - r, cy - r, cx + r, cy + r);
  }
  function pixelShape(px, st, ch) {
    const g = px.glyphs[ch], cell = 1000 / px.rows;
    if (!g) return ch === ' ' ? { key: 'p ', polys: [], adv: 400 } : null;
    const r = cell / 2 * st.moduleSize / 100, polys = [];
    g.bits.forEach((row, ri) => [...row].forEach((b, ci) => {
      if (b === '1') polys.push(...moduleShape(st.module, (ci + 0.5) * cell, (px.rows - px.desc - ri - 0.5) * cell, r));
    }));
    return { key: 'p' + ch, polys: union(polys), adv: g.cols * cell };
  }

  // ---------- style pipeline ----------
  // deterministic per-glyph randomness (mulberry32), so exports match the preview
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const ring = (cx, cy, r, n = 14) => Array.from({ length: n }, (_, i) => ({ X: Math.round(cx + r * Math.cos(i * 2 * Math.PI / n)), Y: Math.round(cy + r * Math.sin(i * 2 * Math.PI / n)) }));
  const box = (x0, y0, x1, y1) => [{ X: x0, Y: y0 }, { X: x1, Y: y0 }, { X: x1, Y: y1 }, { X: x0, Y: y1 }].map(q => ({ X: Math.round(q.X), Y: Math.round(q.Y) }));
  const flat = a => [].concat(...a);

  // Wobbly hand-made edges: resample every contour and push points by smooth 2-D noise.
  function roughen(p, amt, R, k) {
    const step = 16 * k * S, A = amt * k * S, f = 1 / (55 * k * S), ph = [R() * 99, R() * 99, R() * 99, R() * 99];
    const n = (t, o) => Math.sin(t * f * 6.3 + ph[o]) * 0.6 + Math.sin(t * f * 17.1 + ph[o + 2]) * 0.4;
    return union(p.map(r => {
      const out = []; let s = 0;
      r.forEach((a, i) => {
        const b = r[(i + 1) % r.length], L = Math.hypot(b.X - a.X, b.Y - a.Y), m = Math.max(1, Math.ceil(L / step));
        for (let j = 0; j < m; j++) { const u = j / m, t = s + L * u; out.push({ X: Math.round(a.X + (b.X - a.X) * u + n(t, 0) * A), Y: Math.round(a.Y + (b.Y - a.Y) * u + n(t, 1) * A) }); }
        s += L;
      });
      return out;
    }));
  }

  // inst: {delta, slant, seed}. Units in style are per-1000 em; k rescales to the font's UPM.
  function stylize(shape, st, inst, upm, engine) {
    const k = upm / 1000, w = st.width / 100, h = (st.height || 100) / 100, R = rng((inst.seed || 1) * 9973 + 17);
    let p = shape.polys;
    if (engine === 'modular') { const g = st.snap * k * S; p = union(map(p, q => ({ X: Math.round(q.X / g) * g, Y: Math.round(q.Y / g) * g }))); }
    if (w !== 1 || h !== 1) p = map(p, q => ({ X: Math.round(q.X * w), Y: Math.round(q.Y * h) }));
    // round corners on the master outline, before thinning, so light weights don't fall apart
    if (st.round) { const r = st.round * k; p = offset(offset(p, -r), r); p = offset(offset(p, r), -r); }
    // family deltas scale with the base's stem (heavy bases grow less, light ones more); thinning never eats a stroke
    const stem = inst.stem || 85, dl = inst.delta || 0, f = Math.min(1, Math.max(0.35, 85 / stem)) * (dl > 0 && inst.dense ? 0.5 : 1);
    const d = Math.max(-0.25 * stem, st.weight + dl * f) * k;
    p = offset(p, d, st.join);
    // broad-nib pen: Minkowski sum with a rotated flat rectangle → calligraphic / Didone contrast
    let penX = 0;
    if (st.contrast > 0) {
      // narrow elliptical nib: rotate the nib onto X, stretch Y so the nib becomes a circle, one round offset, undo
      const a = (st.penAngle || 0) * Math.PI / 180, hw = st.contrast * k / 2, r = hw / Math.max(2 * k, hw * 0.08);
      const rot = (q, t) => ({ X: Math.round(q.X * Math.cos(t) - q.Y * Math.sin(t)), Y: Math.round(q.X * Math.sin(t) + q.Y * Math.cos(t)) });
      p = map(offset(map(p, q => { q = rot(q, -a); return { X: q.X, Y: Math.round(q.Y * r) }; }), hw), q => rot({ X: q.X, Y: q.Y / r }, a));
      penX = st.contrast * k * Math.abs(Math.cos(a));
    }
    if (st.rough) p = roughen(p, st.rough, R, k);
    const fx = st.fx * k, fs = fx * S; let extra = 0;
    const B = p.length ? C.Clipper.GetBounds(p) : null; // left/right/top(=minY)/bottom(=maxY), S units
    if (st.effect === 'outline') p = diff(p, offset(p, -fx, st.join));
    else if (st.effect === 'inline') p = diff(p, diff(offset(p, -fx, st.join), offset(p, -fx * 1.5, st.join)));
    else if (st.effect === 'stencil') { const y = upm * 0.25; p = diff(p, rect(-upm * 2, y - fx / 2, upm * 4, y + fx / 2)); }
    else if (st.effect === 'shadow') { p = union(p, diff(move(p, fx, -fx), offset(p, fx * 0.4))); extra = fx; }
    else if (st.effect === 'extrude') {
      // depth = sweep of the face along the 45° light direction (same stretched-offset trick as the pen)
      const L = fx * Math.SQRT2 / 2, a = -Math.PI / 4, r = L / (1.5 * k);
      const rot = (q, t) => ({ X: Math.round(q.X * Math.cos(t) - q.Y * Math.sin(t)), Y: Math.round(q.X * Math.sin(t) + q.Y * Math.cos(t)) });
      const solid = move(map(offset(map(p, q => { q = rot(q, -a); return { X: q.X, Y: Math.round(q.Y * r) }; }), L), q => rot({ X: q.X, Y: q.Y / r }, a)), fx / 2, -fx / 2);
      p = union(p, diff(solid, offset(p, Math.max(5 * k, fx * 0.12)))); extra = fx;
    } else if (st.effect === 'drip' && B) {
      const wv = Math.max(14 * k, fx * 0.32) * S, drips = [];
      for (const r of p) {
        if (!C.Clipper.Orientation(r)) continue; // outer contours only
        const minY = Math.min(...r.map(q => q.Y)), low = r.filter(q => q.Y < minY + 14 * k * S);
        for (let i = 0, c = 1 + (R() < 0.45); i < c; i++) {
          const x = low[Math.floor(R() * low.length)].X, len = fs * (0.6 + R() * 2.4);
          drips.push(box(x - wv / 2, minY - len, x + wv / 2, minY + wv), ring(x, minY - len, wv * 0.62));
        }
      }
      p = union(p, drips);
    } else if (st.effect === 'halftone' && B) {
      // keep whole dots whose centre is inked (even-odd over the clean union) — no boolean ops, dots may overlap
      const g = Math.max(26 * k, fx) * S, dots = [], inked = pt => { // even-odd ray cast
        let c = false;
        for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const A = r[i], Bq = r[j]; if ((A.Y > pt.Y) !== (Bq.Y > pt.Y) && pt.X < (Bq.X - A.X) * (pt.Y - A.Y) / (Bq.Y - A.Y) + A.X) c = !c; }
        return c;
      };
      for (let y = B.top, row = 0; y <= B.bottom; y += g, row++)
        for (let x = B.left + (row % 2) * g / 2; x <= B.right; x += g) {
          const t = (y - B.top) / Math.max(1, B.bottom - B.top); // 0 at the bottom of the glyph, 1 at the top
          if (inked({ X: Math.round(x), Y: Math.round(y) })) dots.push(ring(x, y, g * 0.6 * (1 - 0.7 * t), 6)); // ponytail: hex dots — opentype.js charstring encoding grows ~n² per glyph
        }
      p = dots;
    } else if (st.effect === 'erode' && B) {
      const area = (B.right - B.left) * (B.bottom - B.top), holes = [];
      for (let i = 0, n = Math.min(160, area / (fs * fs) * 0.9); i < n; i++)
        holes.push(ring(B.left + R() * (B.right - B.left), B.top + R() * (B.bottom - B.top), fs * (0.15 + R() * 0.5), 7));
      p = diff(p, holes);
    }
    if (st.jitter) { // kinetic / bouncy: per-glyph tilt + baseline hop, baked into the outline
      const a = (R() * 2 - 1) * st.jitter * Math.PI / 180, dy = (R() * 2 - 1) * st.jitter * 5 * k * S;
      const cx = shape.adv * w / 2 * S, cy = 350 * k * S, c = Math.cos(a), s = Math.sin(a);
      p = map(p, q => ({ X: Math.round(cx + (q.X - cx) * c - (q.Y - cy) * s), Y: Math.round(cy + (q.X - cx) * s + (q.Y - cy) * c + dy) }));
    }
    const t = Math.tan(((st.slant || 0) + (inst.slant || 0)) * Math.PI / 180);
    let adv = shape.adv * w + 2 * d + penX + st.tracking * k + extra, dx = d + penX / 2 + st.tracking * k / 2;
    p = map(p, q => ({ X: Math.round(q.X + q.Y * t), Y: q.Y }));
    if (st.mono && p.length) { // monospace: one advance for every glyph, ink centered
      const b = C.Clipper.GetBounds(p);
      adv = 600 * k * w + st.tracking * k + extra;
      dx = (adv - extra - (b.right - b.left) / S) / 2 - b.left / S;
    } else if (st.mono) adv = 600 * k * w + st.tracking * k;
    p = map(p, q => ({ X: Math.round(q.X + dx * S), Y: q.Y }));
    p = C.Clipper.CleanPolygons(p, S * 0.6).filter(r => r.length > 2);
    const path = new OT.Path();
    for (const r of p) { r.forEach((q, i) => path[i ? 'lineTo' : 'moveTo'](Math.round(q.X / S), Math.round(q.Y / S))); path.close(); }
    return { path, adv: Math.max(0, Math.round(adv)) };
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
    else {
      for (let c = 0x20; c < 0x7f; c++) cps.push(c); for (let c = 0xa0; c <= 0xff; c++) cps.push(c);
      if (cfg.charset === 'ks2350') { // KS X 1001: the 2,350 everyday Hangul syllables + compatibility jamo
        const td = new TextDecoder('euc-kr');
        for (let a = 0xb0; a <= 0xc8; a++) for (let b = 0xa1; b <= 0xfe; b++) { const ch = td.decode(new Uint8Array([a, b])); if (/^[\uac00-\ud7a3]$/.test(ch)) cps.push(ch.codePointAt(0)); }
        for (let c = 0x3131; c <= 0x3163; c++) cps.push(c);
      }
    }
    for (const ch of cfg.extra || '') cps.push(ch.codePointAt(0));
    return [...new Set(cps)].map(c => String.fromCodePoint(c));
  }

  // typical stroke thickness of the base in per-1000-em units, used to scale weights.
  // For a stroke-built shape, 2·area/perimeter ≈ stroke width; take the thinnest of a few simple glyphs.
  function stemOf(cfg) {
    if (cfg.engine === 'pixel') return 1000 / cfg.pixel.rows * cfg.style.moduleSize / 100;
    const f = cfg.src; let best = 400;
    for (const ch of 'ㅡㅇㅣlo-') {
      const g = f.charToGlyph(ch); if (!g || !g.index) continue;
      const p = union(flatten(g.path.commands)); if (!p.length) continue;
      const A = Math.abs(p.reduce((s, r) => s + C.Clipper.Area(r), 0)), P = p.reduce((s, r) => s + r.reduce((t, q, i) => { const n = r[(i + 1) % r.length]; return t + Math.hypot(n.X - q.X, n.Y - q.Y); }, 0), 0);
      if (P) best = Math.min(best, 2 * A / P / S * 1000 / f.unitsPerEm);
    }
    return best > 5 && best < 400 ? best : 85;
  }

  // cfg: {engine, src, pixel, style, family}; inst: {name, weightClass, delta}; opts: {italic, italicAngle, chars}
  function buildFont(cfg, inst, opts = {}) {
    const pix = cfg.engine === 'pixel', px = cfg.pixel;
    const upm = pix ? 1000 : cfg.src.unitsPerEm;
    const asc = pix ? Math.round((px.rows - px.desc) * 1000 / px.rows) : cfg.src.ascender;
    const desc = pix ? -Math.round(px.desc * 1000 / px.rows) : Math.min(0, cfg.src.descender);
    const italic = !!opts.italic, slant = italic ? opts.italicAngle || 0 : 0;
    const glyphs = [new OT.Glyph({ name: '.notdef', advanceWidth: Math.round(upm / 2), path: new OT.Path() })];
    const byKey = new Map(), stem = stemOf(cfg), dense = !pix && !!cfg.src.charToGlyph('가').index; // Hangul: tiny counters fill fast
    for (const ch of opts.chars || charsetOf(cfg)) {
      const cp = ch.codePointAt(0);
      const shape = pix ? pixelShape(px, cfg.style, ch) : srcShape(cfg.src, ch);
      if (!shape) continue;
      if (byKey.has(shape.key)) { byKey.get(shape.key).unicodes.push(cp); continue; }
      const { path, adv } = stylize(shape, cfg.style, { delta: inst.delta, slant, seed: cp, stem, dense }, upm, cfg.engine);
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

  G.DF = { buildFont, charsetOf, rasterize, names, patchStyle, stemOf };
})(typeof window !== 'undefined' ? window : globalThis);
