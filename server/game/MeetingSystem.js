/**
 * MeetingSystem — meetings and firing votes. Two kinds:
 *
 *   allhands: someone rang the bell.  discussing (chat + vote) -> results.
 *             Ties and skip-wins fire nobody.
 *   eod:      the end-of-day report.  report -> (discussing -> results) if the
 *             day missed its target: management insists someone is fired, so
 *             there's no skipping; a tie (or nobody voting) is settled at random
 *             among the frontrunners.
 *
 * Only active players (still in the office) may vote. Who has voted is public;
 * who they voted for is revealed with the result.
 */
import { MEETING_DURATION_MS, MEETING_RESULT_MS } from '../../shared/constants.js';
import { randomInt } from './random.js';

const REPORT_MS = 9000;

export const SKIP = 'skip';

export class MeetingSystem {
  constructor() {
    this.current = null;
  }

  get active() {
    return this.current !== null;
  }

  start({ calledBy, voterIds, now, kind = 'allhands', report = null, voteNeeded = true }) {
    const eod = kind === 'eod';
    this.current = {
      kind,
      calledBy,
      report,                        // eod: the day's numbers (public)
      voteNeeded: eod ? voteNeeded : true,
      noSkip: eod,
      stage: eod ? 'report' : 'discussing',
      voters: new Set(voterIds),
      votes: new Map(),              // voterId -> targetId | SKIP
      endsAt: now + (eod ? REPORT_MS : MEETING_DURATION_MS),
      result: null,
    };
    return this.current;
  }

  /** eod: the report has been read; on to voting (or straight to the results). */
  openVoting(now) {
    const m = this.current;
    m.stage = 'discussing';
    m.endsAt = now + MEETING_DURATION_MS;
  }

  /** Returns { ok, reason? }. Changing your vote is not allowed. */
  vote(voterId, targetId, isValidTarget) {
    const m = this.current;
    if (!m || m.stage !== 'discussing') return { ok: false, reason: 'Voting is closed.' };
    if (!m.voters.has(voterId)) return { ok: false, reason: "You can't vote in this meeting." };
    if (m.votes.has(voterId)) return { ok: false, reason: 'You already voted.' };
    if (targetId === SKIP && m.noSkip) return { ok: false, reason: 'Management wants a name. No skipping.' };
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

  /**
   * Close voting and compute the result. All-hands: ties and skip-wins fire
   * nobody. End of day: someone is always fired (`candidates` settles ties).
   */
  close(now, candidates = []) {
    const m = this.current;
    const counts = new Map();
    for (const target of m.votes.values()) counts.set(target, (counts.get(target) || 0) + 1);

    let topCount = 0;
    for (const c of counts.values()) topCount = Math.max(topCount, c);
    const tops = [...counts].filter(([, c]) => c === topCount).map(([t]) => t);
    let tie = tops.length > 1;
    let ejectedId = !tops.length || tie || tops[0] === SKIP ? null : tops[0];
    let drawn = false;
    if (m.noSkip && m.voteNeeded && !ejectedId) {
      const pool = tops.length ? tops : candidates;
      if (pool.length) { ejectedId = pool[randomInt(pool.length)]; drawn = true; }
    }
    if (!m.voteNeeded) { ejectedId = null; tie = false; }
    m.stage = 'results';
    m.endsAt = now + MEETING_RESULT_MS;
    m.result = {
      ejectedId,
      tie,
      drawn,                                   // eod: picked at random among the tied
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
      kind: m.kind,
      calledBy: m.calledBy,
      report: m.report,
      voteNeeded: m.voteNeeded,
      stage: m.stage,
      msLeft: Math.max(0, m.endsAt - now),
      voters: [...m.voters],
      voted: [...m.votes.keys()],
      result: m.result,
    };
  }
}
