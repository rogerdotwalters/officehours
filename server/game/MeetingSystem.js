/**
 * MeetingSystem — emergency "all-hands" meetings and ejection votes.
 *
 * Lifecycle:  idle -> discussing (chat + vote) -> results -> idle
 * Only active players (still in the office) may vote. Who has voted is public;
 * who they voted for is revealed with the result.
 */
import { MEETING_DURATION_MS, MEETING_RESULT_MS } from '../../shared/constants.js';

export const SKIP = 'skip';

export class MeetingSystem {
  constructor() {
    this.current = null;
  }

  get active() {
    return this.current !== null;
  }

  start({ calledBy, voterIds, now }) {
    this.current = {
      calledBy,
      stage: 'discussing',
      voters: new Set(voterIds),
      votes: new Map(),              // voterId -> targetId | SKIP
      endsAt: now + MEETING_DURATION_MS,
      result: null,
    };
    return this.current;
  }

  /** Returns { ok, reason? }. Changing your vote is not allowed. */
  vote(voterId, targetId, isValidTarget) {
    const m = this.current;
    if (!m || m.stage !== 'discussing') return { ok: false, reason: 'Voting is closed.' };
    if (!m.voters.has(voterId)) return { ok: false, reason: "You can't vote in this meeting." };
    if (m.votes.has(voterId)) return { ok: false, reason: 'You already voted.' };
    if (targetId !== SKIP && !isValidTarget(targetId)) return { ok: false, reason: 'Invalid vote.' };
    m.votes.set(voterId, targetId);
    return { ok: true };
  }

  /** A voter left the office mid-meeting (e.g. disconnected). */
  removeVoter(id) {
    this.current?.voters.delete(id);
    this.current?.votes.delete(id);
  }

  everyoneVoted() {
    const m = this.current;
    return !!m && [...m.voters].every((id) => m.votes.has(id));
  }

  /** Close voting and compute the result. Ties and skip-wins eject nobody. */
  close(now) {
    const m = this.current;
    const counts = new Map();
    for (const target of m.votes.values()) counts.set(target, (counts.get(target) || 0) + 1);

    let top = null;
    let topCount = 0;
    let tie = false;
    for (const [target, count] of counts) {
      if (count > topCount) { top = target; topCount = count; tie = false; }
      else if (count === topCount) tie = true;
    }

    const ejectedId = !top || tie || top === SKIP ? null : top;
    m.stage = 'results';
    m.endsAt = now + MEETING_RESULT_MS;
    m.result = {
      ejectedId,
      tie,
      tally: Object.fromEntries(counts),
      ballots: Object.fromEntries(m.votes),   // revealed only now
    };
    return m.result;
  }

  end() {
    this.current = null;
  }

  /** Public view sent to all clients. */
  serialize(now) {
    const m = this.current;
    if (!m) return null;
    return {
      calledBy: m.calledBy,
      stage: m.stage,
      msLeft: Math.max(0, m.endsAt - now),
      voters: [...m.voters],
      voted: [...m.votes.keys()],
      result: m.result,
    };
  }
}
