/**
 * Email: open every email, then deal with it.
 *   productive: real work email. Open each one and Reply.
 *   slacker:    chain emails. Open each one and Forward to All Staff.
 * Add your own to the lists below.
 */
const WORK = [
  { from: 'Linda (Accounting)', subject: 'Q3 expense reports', body: 'Can you send me your receipts from the conference by Friday? Thanks!' },
  { from: 'Priya', subject: 'Meeting moved to 2pm', body: 'The design review is moving to 2pm in the Conference Room. Bring the mockups.' },
  { from: 'Facilities', subject: 'Fire drill on Thursday', body: 'Reminder: fire drill Thursday at 10am. Please use the stairs, not the slide we don\u2019t have.' },
  { from: 'Marco', subject: 'Client feedback', body: 'They loved the proposal! A few small changes attached. Can you take a look?' },
  { from: 'IT Department', subject: 'Laptop update tonight', body: 'Please leave your laptop on and plugged in tonight for a security update.' },
  { from: 'HR', subject: 'Benefits enrollment', body: 'Open enrollment ends next week. Please review your options in the portal.' },
  { from: 'Kev', subject: 'Draft for review', body: 'Here\u2019s the first draft of the quarterly summary. Comments welcome.' },
  { from: 'Bea', subject: 'Onboarding the new hire', body: 'Our new designer starts Monday. Could you show them around the office?' },
];
const CHAIN = [
  { from: 'Chain Letter', subject: 'FWD: FWD: FWD: send to 10 coworkers', body: 'Forward this to 10 coworkers in the next hour or the printer will jam forever. Kev didn\u2019t. Look at Kev now.' },
  { from: 'Gary', subject: 'FWD: Hilarious cat video!!!', body: 'You HAVE to see this. (It\u2019s 45 minutes long. Worth it.)' },
  { from: 'Unknown', subject: 'FWD: FREE PIZZA in the Break Room', body: 'There is no pizza. There was never any pizza. Forward to everyone.' },
  { from: 'Dwayne', subject: 'FWD: Who keeps microwaving fish', body: 'I am not angry. I am just asking. The whole floor smells like a pier.' },
  { from: 'Linda', subject: 'FWD: Pajama Friday petition', body: 'If we get 20 signatures, Casual Friday becomes Pajama Friday. We have 3. One is the cat.' },
  { from: 'Chain Letter', subject: 'FWD: RE: RE: RE: Reply All', body: 'Please stop replying all. (Sent to All Staff.)' },
  { from: 'Marco', subject: 'FWD: Fantasy league standings', body: 'I\u2019m first. Again. Screenshots attached for anyone who doubts me (all of you).' },
  { from: 'The Office Cat', subject: 'FWD: feed me', body: 'feed me feed me feed me. bowl is outside. on the lawn. feed me.' },
];

export function generateEmail(rand, variant = 'productive') {
  const list = variant === 'slacker' ? CHAIN : WORK;
  const count = 3 + Math.floor(rand() * 3);
  const pool = list.map((e, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).slice(0, count);
  return { variant, emails: pool.map(([, i], k) => ({ id: `m${k}`, ...list[i] })) };
}

/** Every email opened and dealt with (replied to, or forwarded). */
export function checkEmail(puzzle, answer) {
  const ids = puzzle.emails.map((e) => e.id).sort().join(',');
  const handled = Array.isArray(answer?.handled) ? [...new Set(answer.handled)].sort().join(',') : '';
  const opened = Array.isArray(answer?.opened) ? [...new Set(answer.opened)].sort().join(',') : '';
  return handled === ids && opened === ids;
}
