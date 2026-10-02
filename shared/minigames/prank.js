/**
 * The computer prank (slackers only): sneak onto a coworker's computer and put
 * something unprofessional on the screen. Everything is shown PG, behind
 * censor bars. When IT finds it at 5 PM, the computer's owner is fired.
 */
export const PRANK_CONTENT = [
  { id: 'beach',  label: 'Questionable beach photo', site: 'vacation-pics.biz', censored: true },
  { id: 'job',    label: 'JobHunt.com: "Escape your terrible boss today!"', site: 'jobhunt.com', censored: false },
  { id: 'memes',  label: '"My boss is a potato" meme collection (47 items)', site: 'memes.lol', censored: false },
  { id: 'dating', label: 'Office Crush Finder: "Your coworker likes you!"', site: 'crushfinder.love', censored: true },
  { id: 'nap',    label: 'Live webcam of you, asleep at your desk', site: 'napcam.tv', censored: true },
];

export function generatePrank(rand, variant = 'slacker') {
  return { variant: 'slacker', options: PRANK_CONTENT.map((c) => c.id) };
}

export function checkPrank(puzzle, answer) {
  return answer?.woke === true && answer?.opened === true && puzzle.options.includes(answer?.content) && answer?.wallpaper === true;
}
