/**
 * In-person emotes. Out on the floor nobody can type: you can only react, and
 * only people who can see you notice. Talking happens at your desk terminal.
 * Keys 1-8 on a keyboard, or the emote buttons on screen.
 */
export const EMOTES = [
  { id: 'wave',    glyph: '👋', label: 'Wave' },
  { id: 'yes',     glyph: '👍', label: 'Yes' },
  { id: 'no',      glyph: '👎', label: 'No' },
  { id: 'look',    glyph: '👀', label: 'Look' },
  { id: 'what',    glyph: '❓', label: 'What?' },
  { id: 'alarm',   glyph: '❗', label: 'Watch out' },
  { id: 'shh',     glyph: '🤫', label: 'Shh' },
  { id: 'laugh',   glyph: '😂', label: 'Ha' },
];

export const EMOTES_BY_ID = new Map(EMOTES.map((e) => [e.id, e]));
export const EMOTE_MS = 2600;        // how long a bubble shows
export const EMOTE_COOLDOWN_MS = 900;
