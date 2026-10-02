/**
 * Email: 3 to 5 chain emails and office nonsense. Open each one, read it, delete it.
 * Add your own to the list below.
 */
const EMAILS = [
  { from: 'IT Department', subject: 'Mandatory password change', body: 'Your password expires in 3 days. Please choose a new password that you have never used, cannot remember, and will write on a sticky note.' },
  { from: 'HR', subject: 'Please stop filing complaints about the cat', body: 'The cat is not an employee and cannot be reported to HR. We have checked. Twice.' },
  { from: 'Facilities', subject: 'The fridge will be cleaned out at 5pm', body: 'Anything left in the fridge at 5pm will be thrown away. This includes the yogurt from March. Especially the yogurt from March.' },
  { from: 'Linda (Accounting)', subject: 'Cake in the break room!!!', body: 'It\u2019s Kev\u2019s birthday! There\u2019s cake in the break room. Please leave some for people who are in meetings. Gary.' },
  { from: 'Gary', subject: 'Has anyone seen my stapler?', body: 'It\u2019s red. It was on my desk. I am not angry, I just want to talk to whoever has it.' },
  { from: 'All Staff', subject: 'RE: RE: RE: RE: Who replied all?', body: 'Please stop replying all.' },
  { from: 'The Office Cat', subject: 'feed me', body: 'feed me feed me feed me. bowl is outside. on the lawn. feed me.' },
  { from: 'Management', subject: 'Synergy initiative kickoff', body: 'Let\u2019s circle back offline to leverage our core competencies and move the needle on this going forward. Thoughts?' },
  { from: 'Printer', subject: 'PC LOAD LETTER', body: 'What does that mean? Nobody knows. Not even me. I am the printer.' },
  { from: 'Priya', subject: 'Lunch order', body: 'Ordering tacos for the team. Reply with your order by 11:30. Do not reply all.' },
  { from: 'Security', subject: 'Badge reminder', body: 'Please wear your badge at all times. Yes, even in the bathroom. Especially in the bathroom.' },
  { from: 'Marco', subject: 'Fantasy league standings', body: 'I\u2019m first. Again. Screenshots attached for anyone who doubts me (all of you).' },
  { from: 'Payroll', subject: 'Your payslip is ready', body: 'Your payslip for this month is available. It is the same as last month, which is to say: not enough.' },
  { from: 'Chain Letter', subject: 'FWD: FWD: FWD: send this to 10 coworkers', body: 'Send this to 10 coworkers in the next hour or the printer will jam forever. Kev didn\u2019t forward it. Look at Kev now.' },
  { from: 'Dwayne', subject: 'Who keeps microwaving fish', body: 'I am not angry. I am just asking. The whole floor smells like a pier. You know who you are.' },
  { from: 'Linda', subject: 'Pajama Friday petition', body: 'If we get 20 signatures, Casual Friday becomes Pajama Friday. We have 3. One is the cat.' },
  { from: 'Bea', subject: 'Who parked in my spot', body: 'Silver car, parking space 14. You know who you are. The cat knows too.' },
  { from: 'Newsletter', subject: 'This week in Office Hours', body: 'Highlights: the ficus is thriving, the coffee machine is not, and we have a new snack drawer policy.' },
];

export function generateEmail(rand) {
  const count = 3 + Math.floor(rand() * 3);
  const pool = EMAILS.map((e, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).slice(0, count);
  return { emails: pool.map(([, i], k) => ({ id: `m${k}`, ...EMAILS[i] })) };
}

/** Every email opened and deleted. */
export function checkEmail(puzzle, answer) {
  const ids = puzzle.emails.map((e) => e.id).sort().join(',');
  const deleted = Array.isArray(answer?.deleted) ? [...new Set(answer.deleted)].sort().join(',') : '';
  const opened = Array.isArray(answer?.opened) ? [...new Set(answer.opened)].sort().join(',') : '';
  return deleted === ids && opened === ids;
}
