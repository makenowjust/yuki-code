import * as fs from 'fs';
import * as path from 'path';

import * as opentype from 'opentype.js';

const FONT_FAMILY = 'Yuki Code';
const FONT_STYLE = 'Regular';

const RESOURCES_PATH = path.join(__dirname, 'resources');
const LATIN_SUBSET_DATA_PATH = path.join(RESOURCES_PATH, 'data', 'latin.txt');
const CJK_SUBSET_DATA_PATH = path.join(RESOURCES_PATH, 'data', 'cjk.txt');
const LIGATURE_DATA_PATH = path.join(RESOURCES_PATH, 'data', 'ligature.txt');
const LATIN_FONT_PATH = path.join(RESOURCES_PATH, 'fonts', 'nova-mono', 'NovaMono-Regular.ttf');
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
  return {set, subset, map};
};

/** Calculate the given character's glyph width in the given font. */
const calculateGlyphWidth = (font: opentype.Font, c: string): number => font.charToGlyph(c).advanceWidth;

/** Adjust the given path by `ratio` and `offsetX`. */
const adjustPath = (
  path: opentype.Path,
  ratioX: number,
  ratioY: number = ratioX,
  offsetX: number = 0,
): opentype.Path => {
  const adjustedCommands: opentype.PathCommand[] = [];
  for (const command of path.commands) {
    const adjustedCommand: opentype.PathCommand = {type: command.type};
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
      const value = command[key];
      if (typeof value === 'number') {
        const ratio = key.startsWith('x') ? ratioX : ratioY;
        const offset = key.startsWith('x') ? offsetX : 0;
        adjustedCommand[key] = Math.round(value * ratio + offset);
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
  const latinSubset = await loadSubsetData(LATIN_SUBSET_DATA_PATH);
  const cjkSubset = await loadSubsetData(CJK_SUBSET_DATA_PATH);
  const ligatureData = await loadLigatureData(LIGATURE_DATA_PATH);
  const latinFont = await opentype.load(LATIN_FONT_PATH);
  const cjkFont = await opentype.load(CJK_FONT_PATH);
  const ligatureFont = await opentype.load(LIGATURE_FONT_PATH);

  const latinWidth = calculateGlyphWidth(latinFont, 'a');
  const cjkWidth = calculateGlyphWidth(cjkFont, 'あ');
  const ligatureWidth = calculateGlyphWidth(ligatureFont, 'a');
  const latinRatio = 1.0;
  const cjkRatio = latinWidth / (cjkWidth / 2);
  const ligatureRatio = latinWidth / ligatureWidth;

  const advanceWidth = latinWidth;

  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth,
    path: new opentype.Path(),
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
    glyphs.push(
      new opentype.Glyph({
        name: `l${cp.toString(16).padStart(4, '0')}`,
        unicode: cp,
        advanceWidth,
        path,
      }),
    );
  }

  console.log('Copying glyphs from latin font');
  for (const cp of latinSubset) {
    // Skip a char copied from ligature font before.
    if (ligatureData.set.has(cp)) {
      continue;
    }

    const c = String.fromCodePoint(cp);
    if (!latinFont.hasChar(c)) {
      console.log(`WARN: missing glyph in latin font: ${c} (U+${cp.toString(16)})`);
      continue;
    }

    const glyph = latinFont.charToGlyph(c);
    const path = adjustPath(glyph.path, latinRatio);
    charToGlyphIndex.set(c, glyphs.length);
    glyphs.push(
      new opentype.Glyph({
        name: `a${cp.toString(16).padStart(4, '0')}`,
        unicode: cp,
        advanceWidth,
        path,
      }),
    );
  }

  console.log('Copying glyphs from CJK font');
  for (const cp of cjkSubset) {
    const c = String.fromCodePoint(cp);
    if (!cjkFont.hasChar(c)) {
      console.log(`WARN: missing glyph in CJK font: ${c} (U+${cp.toString(16).padStart(4, '0')})`);
      continue;
    }

    const glyph = cjkFont.charToGlyph(c);
    const path = adjustPath(glyph.path, (cjkRatio * 5) / 6, (cjkRatio * 5) / 6, advanceWidth * (1 / 12));
    charToGlyphIndex.set(c, glyphs.length);
    glyphs.push(
      new opentype.Glyph({
        name: `c${cp.toString(16).padStart(4, '0')}`,
        unicode: cp,
        advanceWidth: advanceWidth * 2,
        path,
      }),
    );
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

    // A ligature glyph has negative offset because FiraCode ligature uses `calt` substitution.
    // In FiraCode, `advanceWidth` is for only last character, other characters are replaced with dummy glyph.
    // So adjusting negative offset and overiding `advanceWidth` are needed.
    const offsetX = advanceWidth * (from.length - 1);
    const path = adjustPath(glyph.path, ligatureRatio, ligatureRatio, offsetX);
    ligatureToGlyphIndex.set(name, glyphs.length);
    glyphs.push(
      new opentype.Glyph({
        name,
        advanceWidth: advanceWidth * from.length,
        path,
      }),
    );
  }

  const font = new opentype.Font({
    familyName: FONT_FAMILY,
    styleName: FONT_STYLE,
    unitsPerEm: latinFont.unitsPerEm,
    ascender: latinFont.ascender,
    descender: latinFont.descender,
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
