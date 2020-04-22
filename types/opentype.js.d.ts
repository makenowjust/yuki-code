declare module 'opentype.js' {
  export class Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: GlyphSet;
    substitution: Substitution;

    constructor(options: FontConstructorOptions);

    hasChar(c: string): boolean;
    charToGlyph(c: string): Glyph;
    stringToGlyphs(s: string): Glyph[];
    toArrayBuffer(): ArrayBuffer;
  }

  export type FontConstructorOptions = {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: Glyph[];
  };

  export class Glyph {
    name: string;
    path: Path;
    unicode: number | undefined;
    unicodes: number[];
    advanceWidth: number;

    constructor(options: GlyphOptions);
  }

  export interface GlyphOptions {
    name: string;
    advanceWidth: number;
    path: Path;
    unicode?: number | undefined;
    unicodes?: number[];
  }

  export class GlyphSet {
    length: number;

    get(index: number): Glyph;
  }

  export class Path {
    commands: PathCommand[];

    constructor();
  }

  export interface PathCommand {
    type: string;
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Substitution {
    add(feature: 'liga', ligature: Ligature): void;
  }

  export interface Ligature {
    sub: number[];
    by: number;
  }
  export function load(path: string): Promise<Font>;
}
