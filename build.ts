import * as fs from 'fs';
import * as path from 'path';

import * as opentype from 'opentype.js';

const FONT_FAMILY = 'Yuki Code';
const FONT_STYLE = 'Regular';

const RESOURCES_PATH = path.join(__dirname, 'resources');
const ASCII_SUBSET_DATA_PATH = path.join(RESOURCES_PATH, 'data', 'ascii.txt');
const CJK_SUBSET_DATA_PATH = path.join(RESOURCES_PATH, 'data', 'cjk.txt');
const LIGATURE_DATA_PATH = path.join(RESOURCES_PATH, 'data', 'ligature.txt');
const ASCII_FONT_PATH = path.join(RESOURCES_PATH, 'fonts', 'nova-mono', 'NovaMono-Regular.ttf');
const CJK_FONT_PATH = path.join(RESOURCES_PATH, 'fonts', 'source-han-code-jp', 'SourceHanCodeJP-Regular.otf');
const LIGATURE_FONT_PATH = path.join(RESOURCES_PATH, 'fonts', 'fira-code', 'FiraCode-Regular.otf');

const GENERATED_FONT_FILENAME = `${FONT_FAMILY.replace(/ /g, '')}-${FONT_STYLE}.otf`;
const GENERATED_FONT_PATH = path.join(__dirname, 'output', GENERATED_FONT_FILENAME);

/** Load subset character data from the given text file. */
const loadSubsetData = async (path: string): Promise<number[]> => {
  const set: Set<number> = new Set();

  const content = await fs.promises.readFile(path, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip comment.
    if (line.startsWith('#')) {
      continue;
    }

    for (const char of line) {
      set.add(char.codePointAt(0)!);
    }
  }

  return Array.from(set).sort((a, b) => a - b);
};

/** `LigatureData` represents `loadLigatureData` result. */
interface LigatureData {
  set: Set<number>;
  subset: number[];
  map: Map<string, string>;
}

/** Load ligature data from the given text file. */
const loadLigatureData = async (path: string): Promise<LigatureData> => {
  const set: Set<number> = new Set();
  const map: Map<string, string> = new Map();

  const content = await fs.promises.readFile(path, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip comment.
    if (line.startsWith('#') || line === '') {
      continue;
    }

    const [from, to] = line.split(/\s+/, 2);
    if (to) {
      map.set(from, to);
    }

    for (const char of from) {
      set.add(char.codePointAt(0)!);
    }
  }

  const subset = Array.from(set).sort((a, b) => a - b);
  return { set, subset, map };
};

/** Calculate the given character's glyph width in the given font. */
const calculateGlyphWidth = (font: opentype.Font, c: string): number =>
  font.charToGlyph(c).advanceWidth;

/** Adjust the given path by `ratio` and `offsetX`. */
const adjustPath = (path: opentype.Path, ratio: number, offsetX: number = 0): opentype.Path => {
  const adjustedCommands: opentype.PathCommand[] = [];
  for (const command of path.commands) {
    const adjustedCommand: opentype.PathCommand = {type: command.type};
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
      const value = command[key];
      if (typeof value === 'number') {
        adjustedCommand[key] = Math.round(value * ratio) + (key.startsWith('x') ? offsetX : 0);
      }
    }
    adjustedCommands.push(adjustedCommand);
  }

  const adjustedPath = new opentype.Path();
  adjustedPath.commands = adjustedCommands;
  return adjustedPath;
};

/** Generate font. It is an entry point of program. */
const main = async () => {
  console.log('Loading data');
  const asciiSubset = await loadSubsetData(ASCII_SUBSET_DATA_PATH);
  const cjkSubset = await loadSubsetData(CJK_SUBSET_DATA_PATH);
  const ligatureData = await loadLigatureData(LIGATURE_DATA_PATH);
  const asciiFont = await opentype.load(ASCII_FONT_PATH);
  const cjkFont = await opentype.load(CJK_FONT_PATH);
  const ligatureFont = await opentype.load(LIGATURE_FONT_PATH);

  const asciiWidth = calculateGlyphWidth(asciiFont, 'a');
  const cjkWidth = calculateGlyphWidth(cjkFont, 'あ');
  const ligatureWidth = calculateGlyphWidth(ligatureFont, 'a');
  const asciiRatio = (cjkWidth / 2) / asciiWidth;
  const cjkRatio = 5 /  6; // Other fonts are 5:3 ratio, but CJK fonts are 2:1, so fix is needed.
  const ligatureRatio = (cjkWidth / 2) / ligatureWidth;

  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: Math.round(cjkWidth / 2),
    path: new opentype.Path()
  });
  const glyphs: opentype.Glyph[] = [notdefGlyph];

  // char -> glyph index
  const charToGlyphIndex: Map<string, number> = new Map();
  // ligature name -> glyph index
  const ligatureToGlyphIndex: Map<string, number> = new Map();

  console.log('Copying glyphs from ligature font');
  for (const cp of ligatureData.subset) {
    const c = String.fromCodePoint(cp);
    if (!ligatureFont.hasChar(c)) {
      console.log(`WARN: missing glyph in ligature font: ${c} (U+${cp.toString(16)})`);
      continue;
    }

    const glyph = ligatureFont.charToGlyph(c);
    const path = adjustPath(glyph.path, ligatureRatio);
    charToGlyphIndex.set(c, glyphs.length);
    glyphs.push(new opentype.Glyph({
      name: `l${cp.toString(16).padStart(4, '0')}`,
      unicode: cp,
      advanceWidth: glyph.advanceWidth * ligatureRatio,
      path,
    }));
  }

  console.log('Copying glyphs from ASCII font');
  for (const cp of asciiSubset) {
    // Skip a char copied from ligature font before.
    if (ligatureData.set.has(cp)) {
      continue;
    }

    const c = String.fromCodePoint(cp);
    if (!asciiFont.hasChar(c)) {
      console.log(`WARN: missing glyph in ASCII font: ${c} (U+${cp.toString(16)})`);
      continue;
    }

    const glyph = asciiFont.charToGlyph(c);
    const path = adjustPath(glyph.path, asciiRatio);
    charToGlyphIndex.set(c, glyphs.length);
    glyphs.push(new opentype.Glyph({
      name: `a${cp.toString(16).padStart(4, '0')}`,
      unicode: cp,
      advanceWidth: glyph.advanceWidth * asciiRatio,
      path,
    }));
  }

  console.log('Copying glyphs from CJK font');
  for (const cp of cjkSubset) {
    const c = String.fromCodePoint(cp);
    if (!cjkFont.hasChar(c)) {
      console.log(`WARN: missing glyph in CJK font: ${c} (U+${cp.toString(16).padStart(4, '0')})`);
      continue;
    }

    const glyph = cjkFont.charToGlyph(c);
    const path = adjustPath(glyph.path, cjkRatio, cjkWidth * ((1 - cjkRatio) / 2));
    charToGlyphIndex.set(c, glyphs.length);
    glyphs.push(new opentype.Glyph({
      name: `c${cp.toString(16).padStart(4, '0')}`,
      unicode: cp,
      advanceWidth: glyph.advanceWidth,
      path,
    }));
  }

  console.log('Copying ligature glyphs');
  const ligatureGlyphs: Map<string, opentype.Glyph> = new Map();
  for (let i = 0; i < ligatureFont.glyphs.length; i++) {
    const glyph = ligatureFont.glyphs.get(i);
    ligatureGlyphs.set(glyph.name, glyph);
  }

  for (const [from, name] of ligatureData.map) {
    const glyph = ligatureGlyphs.get(name);
    if (!glyph) {
      console.log(`WARN: missing ligature glyph: ${name}`);
      continue;
    }

    // TODO: Calculate correctly. It is magical for now.
    const offsetScale = from.length === 3 ? 4.75 : 2.25;
    const path = adjustPath(glyph.path, ligatureRatio, (cjkWidth / 2) * ligatureRatio * offsetScale);
    ligatureToGlyphIndex.set(name, glyphs.length);
    glyphs.push(new opentype.Glyph({
      name,
      advanceWidth: (cjkWidth / 2) * from.length,
      path,
    }));
  }

  const font = new opentype.Font({
    familyName: FONT_FAMILY,
    styleName: FONT_STYLE,
    unitsPerEm: cjkFont.unitsPerEm * cjkRatio,
    ascender: cjkFont.ascender * cjkRatio,
    descender: cjkFont.descender * cjkRatio,
    glyphs,
  });

  // TODO: Use `calt` feature instead of `liga` for more correct substitution.
  //       e.g. `====` is displayed as three-equals plus one equal currently,
  //       but four idnependent equals are expected.
  console.log('Adding ligature information');
  for (const [from, name] of ligatureData.map) {
    font.substitution.add('liga', {
      sub: Array.from(from).map(c => charToGlyphIndex.get(c)!),
      by: ligatureToGlyphIndex.get(name)!,
    });
  }

  console.log('Generating a font');
  await fs.promises.writeFile(GENERATED_FONT_PATH, Buffer.from(font.toArrayBuffer()));
};

main().catch(err => console.error(err));
