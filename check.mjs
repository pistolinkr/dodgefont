// Smoke check: node check.mjs — builds Bold Italic + outline-effect fonts from Inter, re-parses them, checks checksums/style bits.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
const ctx = vm.createContext({ console, Math, DataView, Uint8Array, ArrayBuffer, Map, Set, Array, Object, String, Number });
ctx.self = ctx; ctx.globalThis = ctx; ctx.navigator = { userAgent: "node" };
for (const f of ['vendor/clipper.js', 'vendor/opentype.min.js', 'core.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
const { opentype, DF } = ctx;
const woff = await (await fetch('https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff')).arrayBuffer();
const src = opentype.parse(woff);
const style = { weight: 0, width: 100, slant: 0, round: 0, tracking: 0, snap: 40, join: 'round', effect: 'none', fx: 30, module: 'square', moduleSize: 100 };
const cfg = { engine: 'outline', src, style, family: 'Dodge Test', charset: 'latin', extra: '', pixel: { rows: 12, desc: 3, glyphs: {} } };

const out = DF.buildFont(cfg, { name: 'Bold', weightClass: 700, delta: 40 }, { italic: true, italicAngle: 10 });
const f = opentype.parse(out.buf);
assert.equal(out.file, 'DodgeTest-BoldItalic.otf');
assert.equal(f.tables.head.macStyle, 3);
assert.equal(f.tables.os2.usWeightClass, 700);
assert.equal(f.tables.os2.fsSelection & 33, 33);
assert.ok(f.charToGlyph('A').path.commands.length > 4, 'A has outline');
assert.ok(f.charToGlyph('A').advanceWidth > src.charToGlyph('A').advanceWidth, 'bold widens');
const dv = new DataView(out.buf); let s = 0;
for (let i = 0; i + 4 <= out.buf.byteLength; i += 4) s = (s + dv.getUint32(i)) >>> 0;
assert.equal(s, 0xB1B0AFBA, 'whole-font checksum');

for (const effect of ['outline', 'inline', 'stencil', 'shadow']) DF.buildFont({ ...cfg, engine: 'modular', style: { ...style, effect, round: 10 } }, { name: 'Black', weightClass: 900, delta: 80 });
fs.writeFileSync(process.argv[2] || '/dev/null', Buffer.from(out.buf));
console.log('ok', out.file, out.glyphCount, 'glyphs', out.buf.byteLength, 'bytes');
