/**
 * Emotes: hold the emote button, drag to a bubble, let go. The emote pops up
 * over your head for everyone who can see you. Add or change them here; the
 * radial menu lays out however many there are.
 */
export const EMOTES = [
  { id: 'lol',    glyph: '\u{1F602}', label: 'LOL' },
  { id: 'ok',     glyph: '\u{1F44D}', label: 'Thumbs up' },
  { id: 'shock',  glyph: '\u{1F631}', label: 'Shocked' },
  { id: 'coffee', glyph: '\u2615',    label: 'Coffee' },
  { id: 'sleepy', glyph: '\u{1F634}', label: 'Sleepy' },
  { id: 'eyes',   glyph: '\u{1F440}', label: 'Watching you' },
  { id: 'shh',    glyph: '\u{1F92B}', label: 'Shh' },
  { id: 'love',   glyph: '\u2764\uFE0F', label: 'Love' },
];
export const EMOTES_BY_ID = new Map(EMOTES.map((e) => [e.id, e]));
export const EMOTE_MS = 3200;
