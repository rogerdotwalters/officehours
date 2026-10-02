/**
 * Evidence: the mess slackers leave behind.
 *
 * When a slacker finishes a task version with `evidence`, a mark appears at
 * that object right away (everyone who can see it notices), and a few seconds
 * later the whole office hears about it, which gives the slacker a head start.
 * If a productive employee does their version of a task at the same object,
 * the mess is cleaned up. Some marks also fade by themselves.
 *
 *   ttl:      milliseconds before it fades (null = stays until cleaned)
 *   delay:    milliseconds before the office-wide announcement
 *   announce: the feed message; {room} is filled in (null = no announcement)
 *
 * The art for each kind is drawn by client/js/render/evidenceArt.js.
 */
export const EVIDENCE = {
  fish:         { ttl: 150_000, delay: 8000, announce: 'A horrible fish smell is drifting out of the {room}.' },
  stolen_lunch: { ttl: null,    delay: 9000, announce: 'Someone ate a coworker\u2019s lunch from the {room} fridge. There\u2019s a very angry note on it now.' },
  empty_pot:    { ttl: 120_000, delay: 8000, announce: 'The coffee pot in the {room} is empty and burning. Again.' },
  flood:        { ttl: null,    delay: 7000, announce: 'Water is coming under the {room} door. Somebody clogged a toilet.' },
  doodle:       { ttl: null,    delay: 9000, announce: 'Someone drew something unprofessional on the {room} whiteboard.' },
  copies:       { ttl: null,    delay: 9000, announce: 'Embarrassing photocopies are all over the {room} floor.' },
  memes:        { ttl: null,    delay: 9000, announce: 'The printer in the {room} just finished printing 400 pages of memes.' },
  litter:       { ttl: null,    delay: 9000, announce: 'Someone dumped the recycling all over the {room}.' },
  fat_cat:      { ttl: null,    delay: 10_000, announce: 'The office cat is looking... noticeably rounder.' },
  chain_email:  { ttl: 60_000,  delay: 5000, announce: 'Everyone just got 4 chain emails, forwarded to All Staff from a desk in {room}.' },
  // A coworker's screen: no announcement. Anyone walking past can see it; IT finds it at 5 PM.
  screen:       { ttl: null,    delay: 0,    announce: null },
};

/**
 * How chaos counts against the day. The end-of-day score is
 *   productivity % - chaos %
 * Each shenanigan adds PER_SHENANIGAN; every mess still there at 5 PM adds PER_MESS_LEFT.
 */
export const CHAOS = { PER_SHENANIGAN: 8, PER_MESS_LEFT: 4 };
