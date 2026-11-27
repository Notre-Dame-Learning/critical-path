// Spot the flaw screen (a Daily Mission kind for Planning, Risk and Capacity): a clean plan with one planted
// flaw, reviewed on the Critique screen (app/critique-screen.js, as a variant: one Score button instead of
// a verdict), then a result card: the score out of 20, the plan as written and with the fix played forward,
// what the flaw was, XP and the streak. Engine: engine/spot.js. Design: "Daily Mission" tab of the doc.
// The HTML builders are pure (esc passed in), so they can be tested in Node.
import * as C from '../engine/critique.js';
import * as Sp from '../engine/spot.js';
import { TRACK_LABEL, TRACKS } from '../engine/tracks.js';
import { mountCritique, debriefModel, flawsById } from './critique-screen.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const VERDICT = (s) => (!s.found ? ['poor', 'Missed'] : s.credit >= 0.9 ? ['best', 'Spotted and fixed'] : s.credit >= 0.6 ? ['ok', 'Spotted'] : ['partial', 'Partly right']);

export const kickerOf = (pick) => `${pick.practice ? 'Practice' : 'Daily mission'} · ${TRACK_LABEL[pick.track]} · Spot the flaw`;

// The brief: one problem in a plan built from ODL's usual timeline.
export function briefHtml(pick, round, project, world, esc, { fixMode = 'pick', canGrade = false } = {}) {
  const sup = world.supervisor;
  return `<section class="cq-brief card sp-brief">
    <span class="kicker">${esc(kickerOf(pick))}</span>
    <h2>One thing is wrong with this plan</h2>
    <p class="small muted">${esc(pick.reason)}.${pick.practice ? ' Practice earns no XP.' : ''}</p>
    <p>${esc(sup?.short ?? sup?.name ?? 'Your supervisor')} hands you a draft plan for ${esc(project.title)}, launching in week ${round.plan.launchWeek}. It follows ODL's usual timeline, except for one problem that will hurt the project. Find it before the plan goes to the faculty partner.</p>
    <ul class="how">
      <li>Look through the timeline, the meeting calendar, the risks and the team's load. Every task, link, calendar row, risk and person has a <strong>Flag</strong> button.</li>
      <li>Flag the problem: say what's wrong, how serious it is, and ${fixMode === 'write' ? `write your fix${canGrade ? ' (Claude grades it)' : ' (then pick the closest option, since AI grading isn\'t available here)'}` : 'pick a fix'}.</li>
      <li>There is exactly one. A flag on something that's fine costs 3 of the 20 points.</li>
      <li>Then the plan is played ${Sp.FORWARD.runs} times as written and ${Sp.FORWARD.runs} times with the fix, to show what it costs.</li>
    </ul>
    <div class="pd-actions"><button type="button" class="primary" data-cq="start">Start looking</button><button type="button" data-cq="exit">Back to your desk</button></div>
  </section>`;
}

// The result model: Critique's debrief cards for the one flaw, plus the spot score, the forward comparison
// (as written vs with the fix) and the mission record.
export function spotModel(pick, round, result, { flags = [], project, world, flawFiles, baseline, forward = null, xp = null }) {
  const base = debriefModel(round, result, { flags, project, world, flawFiles, baseline });
  const s = Sp.scoreSpot(round, result);
  const flaw = flawsById(flawFiles)[round.flaws[0].id] ?? {};
  const pct = (x) => Math.round(x * 100);
  const who = (role) => (role === 'faculty' ? 'faculty partner' : world.people.find((p) => p.id === project.team[role])?.short ?? role);
  const peakW = C.peakLoad(round.plan, project, world);
  const peakF = C.peakLoad(baseline, project, world);
  return {
    pick, project: { id: project.id, title: project.title }, score: s, card: base.cards[0], falsePositives: base.falsePositives,
    headline: Sp.spotHeadline(s, round.flaws[0].title), check: flaw.check ?? null, effect: flaw.sim_effect ?? '',
    forward: forward ? {
      written: { odds: pct(forward.written.onTime), rework: Math.round(forward.written.rework), peak: pct(peakW.share), peakWho: who(peakW.role) },
      fixed: { odds: pct(forward.fixed.onTime), rework: Math.round(forward.fixed.rework), peak: pct(peakF.share), peakWho: who(peakF.role) },
      runs: forward.runs, shows: Sp.showsInPlay(forward), effect: flaw.sim_effect ?? '',
    } : null,
    record: xp,
  };
}

export function forwardHtml(f, progress = null, esc = (s) => s) {
  if (!f) {
    const pct = Math.round((progress?.share ?? 0) * 100);
    return `<section class="card cq-forward" aria-busy="true"><h3>Played forward</h3>
      <p class="small">Playing the plan as written and the plan with the fix, ${Sp.FORWARD.runs} times each, with this project's situations…</p>
      <div class="pd-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Playing both plans"><i style="width:${pct}%"></i></div></section>`;
  }
  const col = (label, x, cls) => `<div class="cq-fw ${cls}"><span class="kicker">${label}</span><b>${x.odds}%</b><small>on time</small>
    <dl><div><dt>Rework</dt><dd>${x.rework} h a run</dd></div><div><dt>Peak load</dt><dd>${x.peak}% (${esc(x.peakWho)})</dd></div></dl></div>`;
  const gain = f.fixed.odds - f.written.odds;
  const saved = f.written.rework - f.fixed.rework;
  const peakNote = f.written.peak - f.fixed.peak >= 10 ? ` The fix also takes ${esc(f.written.peakWho)}'s peak from ${f.written.peak}% to ${f.fixed.peak}% of usable hours.` : '';
  const line = f.shows
    ? `Fixing it is worth ${gain > 0 ? `${gain} points of on-time odds` : 'little in on-time odds'}${saved >= 10 ? `${gain > 0 ? ' and' : ', but'} about ${saved} hours of rework a run` : ''}.${peakNote}`
    : `In these runs this flaw barely moves the odds${peakNote ? '' : ' or the rework'}.${peakNote} It still fails the plan's check, and here is what it does when it bites: ${esc(f.effect)}`;
  return `<section class="card cq-forward"><h3>Played forward</h3>
    <div class="cq-fw-grid">${col('As written', f.written, 'written')}${col('With the fix', f.fixed, 'fixed')}</div>
    <p class="small">${line}</p>
    <p class="small muted">${f.runs} runs each on the same seeds, played by a steady PM with this project's situations.</p></section>`;
}

const xpHtml = (pick, record, esc) => {
  if (pick.practice) return '<p class="small muted">Practice: nothing recorded, no XP.</p>';
  if (!record) return '';
  const rows = TRACKS.filter((t) => (record.gained[t] ?? 0) > 0);
  return `<div class="xp-panel ms-xp">
    <h2>+${Math.round(record.total)} XP</h2>
    ${rows.length ? `<p class="small">${rows.map((t) => `${TRACK_LABEL[t]} +${Math.round(record.gained[t])}`).join(' · ')}${record.bonus ? ', including the 10 XP daily bonus' : ''}.</p>` : '<p class="small muted">No new XP: you have already spotted this one as well, so only a better review adds more.</p>'}
    ${record.promotion ? `<p class="promotion">Promoted to <strong>${esc(record.promotion)}</strong>.</p>` : ''}
    ${record.levelUps.length ? `<p>${record.levelUps.map((l) => `${TRACK_LABEL[l.track]} reached L${l.level}`).join(' · ')}</p>` : ''}
    <p class="small">${record.streak}-day streak. A new mission tomorrow.</p>
  </div>`;
};

export function resultHtml(m, esc, { progress = null } = {}) {
  const s = m.score;
  const [cls, verdict] = VERDICT(s);
  const c = m.card;
  const grade = { accepted: 'a full fix', partial: 'a partial fix', none: 'not a fix for this' };
  const part = (label, points, max, detail) => `<li class="pd-part"><span class="pd-part-head"><strong>${label}</strong><span><b>${points}</b>/${max}</span></span>
    <span class="pd-meter" aria-hidden="true"><i style="width:${((Math.max(0, points) / max) * 100).toFixed(1)}%"></i></span><small class="muted">${detail}</small></li>`;
  const yours = c.yours
    ? `<p class="small"><strong>Your flag:</strong> ${esc(c.yours.at)}, ${esc(c.yours.category)}${c.yours.rightCategory ? '' : ' (right place, other category)'}, ${esc(c.yours.severity)}; ${c.yours.written ? `you wrote: “${esc(c.yours.fix)}”${c.yours.picked ? `, closest to “${esc(c.yours.picked)}”` : ''}` : `fix: ${esc(c.yours.fix || '—')}`} (${grade[c.yours.grade]}).</p>
      ${c.yours.feedback ? `<p class="small cq-feedback"><strong>${c.yours.by === 'claude' ? 'Claude' : 'Note'}:</strong> ${esc(c.yours.feedback)}</p>` : ''}`
    : '';
  return `<div class="pd cq-debrief sp-result">
    <section class="pd-score card">
      <div class="pd-total"><span class="kicker">${esc(kickerOf(m.pick))}</span><span class="grade">${Math.max(0, s.raw)}</span><span class="small muted">out of ${s.max}</span></div>
      <div class="pd-summary"><div class="verdict ${cls}"><strong>${esc(verdict)} · ${Math.round(s.credit * 100)}%.</strong> ${esc(m.headline)}</div>${xpHtml(m.pick, m.record, esc)}</div>
      <ul class="pd-parts">
        ${part('Found', s.points.found, 10, s.found ? (s.rightCategory ? 'Right place, right problem' : 'Right place, other problem: 5') : 'Not flagged')}
        ${part('Severity', s.points.severity, 3, 'Exact 3, one level off 1')}
        ${part('Fix', s.points.fix, 7, 'A full fix 7, a partial fix 3')}
        <li class="pd-part"><span class="pd-part-head"><strong>Extra flags</strong><span><b>${s.falsePositivePoints ? `−${-s.falsePositivePoints}` : '0'}</b></span></span>
          <small class="muted">${s.falsePositives ? `${plural(s.falsePositives, 'flag')} on things that were fine` : 'None on things that were fine'}: −3 each, at most −9</small></li>
      </ul>
    </section>
    ${forwardHtml(m.forward, progress, esc)}
    <section class="pd-lessons card"><h3>The problem in this plan</h3><ul>
      <li class="pd-lesson ${c.found ? 'pass' : 'fail'}">
        <h4><span class="pe-icon" aria-hidden="true">${c.found ? '✓' : '✗'}</span><span>${esc(c.title)} <span class="muted">· ${esc(TRACK_LABEL[m.pick.track] ?? c.track)} · severity ${esc(c.severity)}</span></span></h4>
        ${c.where ? `<p class="small"><strong>Where:</strong> ${esc(c.where)}.</p>` : ''}
        ${yours}
        <p class="small"><strong>Best fix:</strong> ${esc(c.bestFix)}.</p>
        ${c.explanation ? `<p class="small">${c.concept ? `<strong>${esc(c.concept)}.</strong> ` : ''}${esc(c.explanation)}</p>` : ''}
        ${c.sop ? `<p class="small muted">SOP: ${esc(c.sop)}</p>` : ''}
      </li></ul>
      ${m.falsePositives.length ? `<h4>Flags on things that were fine</h4><ul class="cq-fps">${m.falsePositives.map((f) => `<li class="small"><strong>${esc(f.at)}:</strong> ${esc(f.why ?? 'this part of the plan is as ODL usually plans it')}</li>`).join('')}</ul>` : ''}
    </section>
    <div class="pd-actions"><button type="button" class="primary" data-cq="exit">Back to your desk</button></div>
  </div>`;
}

// Mount the mission in `root`. Same contract as mission-screen's mountMission: onRecord(pick, result, event)
// returns recordResult's value (not called for practice). grader as the Critique screen takes it (hard mode).
export function mountSpot(root, { pick, world, deck, projects, plans, flaws, esc, grader = null, onRecord = () => null, onExit = () => {}, forwardOptions = {} }) {
  const project = projects.find((p) => p.id === pick.projectId);
  const baseline = plans?.[pick.projectId];
  if (!project || !baseline) { onExit(); return { unmount() {} }; }
  const round = Sp.spotRound(pick, { flaws, plans, projects, world });
  const fixMode = pick.mode === 'hard' ? 'write' : 'pick';
  let recorded = null;
  let scored = false;
  const view = mountCritique(root, {
    round, project, world, deck, flawFiles: flaws, baseline, onExit, grader, fixMode,
    forwardOptions: { ...Sp.FORWARD, ...forwardOptions },
    onScored: (r, result) => {
      // One record per mission: the first score counts; nothing is recorded for practice.
      if (scored || pick.practice) return recorded;
      scored = true;
      const s = Sp.scoreSpot(r, result);
      recorded = onRecord(pick, { kind: 'spot', eventId: pick.eventId, credit: s.credit, score: s }, Sp.spotEvent(pick)) ?? null;
      return recorded;
    },
    variant: {
      kicker: kickerOf(pick),
      subline: 'A draft with one problem',
      submitLabel: 'Score my flag',
      briefHtml: (ui) => briefHtml(pick, round, project, world, esc, { fixMode: ui.fixMode, canGrade: Boolean(grader) }),
      debriefModel: (rd, result, args) => spotModel(pick, rd, result, args),
      debriefHtml: (m, { progress } = {}) => resultHtml(m, esc, { progress }),
      forwardHtml: (f, progress) => forwardHtml(f, progress, esc),
      forwardPlans: () => ({ written: round.plan, fixed: baseline, same: false }),
    },
  });
  return { unmount() { view.unmount(); }, get view() { return view; }, round };
}
