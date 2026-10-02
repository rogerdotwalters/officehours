/**
 * Copier: drag each document from the stack onto the glass and press Copy.
 *   productive: real work documents
 *   slacker:    nonsense (and the copies end up all over the floor)
 * Add your own to the lists below.
 */
const WORK_DOCS = [
  { title: 'Q3 REPORT', body: 'Revenue up 4%. Costs down 2%. Morale: stable. Coffee budget: exceeded.' },
  { title: 'MEETING AGENDA', body: '1. Welcome. 2. Project updates. 3. Next steps. 4. Any other business.' },
  { title: 'SAFETY MEMO', body: 'Please keep fire exits clear and report any spills to Facilities.' },
  { title: 'CLIENT PROPOSAL', body: 'Scope, timeline and budget for the spring campaign. Draft 3.' },
  { title: 'ONBOARDING CHECKLIST', body: 'Laptop, badge, desk, welcome lunch. Introduce to the team.' },
  { title: 'BUDGET SUMMARY', body: 'Department budgets for next quarter. Please review before Friday.' },
];
const SILLY_DOCS = [
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

export function generateCopier(rand, variant = 'productive') {
  const DOCS = variant === 'slacker' ? SILLY_DOCS : WORK_DOCS;
  const count = 3 + Math.floor(rand() * 2);
  const picks = DOCS.map((d, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).slice(0, count);
  return {
    variant,
    docs: picks.map(([, i], k) => ({ id: `d${k}`, ...DOCS[i] })),
    jam: Math.floor(rand() * count), // which copy jams first (it always does)
  };
}

export function checkCopier(puzzle, answer) {
  const ids = puzzle.docs.map((d) => d.id).sort().join(',');
  const copied = Array.isArray(answer?.copied) ? [...new Set(answer.copied)].sort().join(',') : '';
  return copied === ids;
}
