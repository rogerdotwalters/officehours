/**
 * Copier: drag each document from the stack onto the glass and press Copy.
 * The documents are, of course, nonsense. Add your own below.
 */
const DOCS = [
  { title: 'PETITION', body: 'Replace the stairs with a slide. Signed: Linda, Kev, Priya, the cat.' },
  { title: 'EMPLOYEE OF THE MONTH', body: 'Nominee: Gary. Nominated by: Gary. Seconded by: Gary. (4th attempt)' },
  { title: 'LOST: ONE STAPLER', body: 'Red. Answers to "Stapler". If found, please do NOT return it to Gary.' },
  { title: 'MEETING NOTES', body: 'Everyone agreed we should have fewer meetings. Next meeting: tomorrow, 8 AM.' },
  { title: 'FRIDGE RULES v12', body: 'Rule 1: Do not eat Linda\u2019s yogurt. Rules 2 to 40: see Rule 1.' },
  { title: 'OFFICIAL CHAIR RANKINGS', body: '1. The spinny one. 2. Also the spinny one. 47. Gary\u2019s chair.' },
  { title: 'MEMO', body: 'Casual Friday is now Pajama Friday. Approved by: nobody. Effective: now.' },
  { title: 'SCAN OF MY FACE', body: 'It is just my face, extremely close up. You\u2019re welcome.' },
  { title: 'MOTIVATIONAL POSTER', body: 'TEAMWORK: because blaming everyone is easier than blaming one person.' },
  { title: 'TOP SECRET MAP', body: 'Route to the good snacks. X marks the vending machine. Burn after reading.' },
  { title: 'BIRTHDAY CARD', body: 'For Kev. Please sign. (Gary already wrote a full page. Please don\u2019t read it.)' },
  { title: 'RESIGNATION LETTER', body: 'Dear Management, I quit. Just kidding. Unless...? Love, Accounting.' },
];

export function generateCopier(rand) {
  const count = 3 + Math.floor(rand() * 2);
  const picks = DOCS.map((d, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).slice(0, count);
  return {
    docs: picks.map(([, i], k) => ({ id: `d${k}`, ...DOCS[i] })),
    jam: Math.floor(rand() * count), // which copy jams first (it always does)
  };
}

export function checkCopier(puzzle, answer) {
  const ids = puzzle.docs.map((d) => d.id).sort().join(',');
  const copied = Array.isArray(answer?.copied) ? [...new Set(answer.copied)].sort().join(',') : '';
  return copied === ids;
}
