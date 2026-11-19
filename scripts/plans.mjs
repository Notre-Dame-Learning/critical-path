// Re-derives the Build the Plan baselines in content/plans/ and reports their checks and odds.
//   npm run plans            check the committed plan files: 8 checks, peak load, on-time odds
//   npm run plans -- --write rebuild the files from the engine, then check them
// Windows are the median start and finish weeks of 60 engine runs with every link in place and the
// standard touchpoints; gate, risks, backups, overtime and a few windows are hand-written below.
// See the "Build the Plan baselines" tab of the framework doc (v2).
import fs from 'node:fs';
import * as P from '../engine/plan.js';

const root = new URL('../', import.meta.url);
const load = (p) => JSON.parse(fs.readFileSync(new URL(p, root)));
const world = load('content/world.json');
const deck = load('content/scenarios/core-deck.json');
const projects = load('content/projects.json').projects.map((id) => load(`content/projects/${id}.json`));

const HAND = {
  'intro-psych-online': {
    gate: 10,
    backups: { distribution: 'ld', embed: 'mp' },
    // The doc's v2 Intro table, hand-checked (Nov 5): coursemap over 3 weeks keeps Li under 85%.
    windows: { analysis: [1, 1], brief: [1, 1], coursemap: [1, 3], branding: [1, 2], scripts: [3, 5], content: [4, 6], scriptreview: [5, 5], production: [5, 7], animations: [5, 7], post: [8, 10], distribution: [10, 11], mastersite: [7, 9], embed: [12, 12], qa: [12, 13], handoff: [13, 13] },
    risks: [
      { id: 'faculty-availability', text: 'Faculty partner falls behind on scripts during midterms', owner: 'PM', mitigation: 'Weekly 15-minute working sessions while faculty owns open work', trigger: 'Scripts not started by the end of week 3', contingency: 'Li drafts scripts from the course map for faculty to edit' },
      { id: 'studio-dates', text: 'Studio days lost to another project', owner: 'Perrick', mitigation: 'Block production days on the media calendar as soon as scripts are scheduled', trigger: 'Production days not blocked by week 4', contingency: 'Shoot the remaining modules as lightboard sessions' },
      { id: 'late-video', text: 'Post-production runs long and squeezes embedding and QA', owner: 'PM', mitigation: 'Li builds the master site with placeholders while post runs', trigger: 'Post not finished by the end of week 10', contingency: 'Embed and QA module by module as videos arrive; Perrick backs up embedding' },
    ],
  },
  'ai-ethics-documentary': {
    gate: 11,
    backups: { distribution: 'ld', embed: 'mp' },
    windows: { embed: [12, 13], qa: [13, 14], handoff: [14, 15] },
    risks: [
      { id: 'guest-cancels', text: 'An interview guest cancels', owner: 'Perrick', mitigation: 'Book a standby guest during logistics', trigger: 'Any guest unconfirmed one week before the shoot', contingency: 'Faculty-led host segment in place of the interview' },
      { id: 'releases', text: 'Location permits or release forms not signed', owner: 'Perrick', mitigation: 'Send release forms with the booking confirmation', trigger: 'Any release unsigned by the week before the shoot', contingency: 'Reshoot that scene as narration over animation' },
      { id: 'faculty-travel', text: 'Prof. Osei travels during script work', owner: 'PM', mitigation: 'Working sessions every week faculty owns open work, plus doc comments', trigger: 'No narration draft by the end of week 5', contingency: 'Li drafts narration from the course map for faculty to edit' },
    ],
  },
  'rescue-sustainable-business': {
    gate: 6,
    backups: { distribution: 'ld', embed: 'mp' },
    overtime: { 11: 'mp', 12: 'mp' },
    windows: { post: [11, 13] },
    risks: [
      { id: 'faculty-trust', text: 'Dr. Kowalczyk stays frustrated and slow to respond', owner: 'PM', mitigation: 'Re-baseline meeting in week 6, then weekly working sessions and Friday summaries', trigger: 'Scripts not finished by the end of week 8', contingency: 'Li drafts the remaining scripts from the course map for faculty to edit' },
      { id: 'hidden-rework', text: 'The previous PM left hidden rework in the course map', owner: 'Li', mitigation: 'Internal review in week 6 before building on the course map', trigger: 'Any reopened course-map item after week 7', contingency: 'Fix it before the master site build starts; move content later if needed' },
      { id: 'post-crunch', text: 'Post-production is the long pole into launch', owner: 'Perrick', mitigation: 'Targeted overtime for Perrick in weeks 11–12 only', trigger: 'Post not half done by the end of week 11', contingency: 'Cut the last module to a lecture capture and edit it after launch' },
    ],
  },
};

function derive(project) {
  const ctx = { world, project, deck };
  const hand = HAND[project.id];
  const plan = P.emptyPlan(project, world);
  for (const t of project.tasks) {
    const p = plan.tasks[t.id];
    const left = 1 - (project.initial?.tasks?.[t.id]?.done ?? 0);
    p.est = left <= 0 ? [0, 0, 0] : P.estimateFor(t.effort).map((h) => Math.max(1, Math.round(h * left)));
    p.deps = [...t.dependsOn];
    if (!p.locked) Object.assign(p, { start: plan.joinWeek, end: plan.launchWeek - 1 });
  }
  plan.gate = hand.gate;
  plan.risks = hand.risks;
  // Two passes: touchpoints depend on the windows (faculty working sessions, reviews until QA), and back.
  // Planned starts bind in the engine (a task can't start before its week), so windows are measured on an
  // unbound copy: start = the early-quartile start, never before the tasks it waits for end; end = median finish.
  const unbound = () => {
    const u = structuredClone(plan);
    for (const [id, t] of Object.entries(u.tasks)) if (!t.locked && !(project.initial?.tasks?.[id]?.done > 0)) t.start = plan.joinWeek;
    return u;
  };
  for (let pass = 0; pass < 2; pass++) {
    plan.touchpoints = P.standardTouchpoints(plan, project, { overtime: hand.overtime });
    const med = P.medianWindows(unbound(), ctx, { startQuantile: 0.25 });
    for (const t of project.tasks) {
      const p = plan.tasks[t.id];
      if (p.locked) continue;
      const floor = Math.max(0, ...t.dependsOn.map((d) => plan.tasks[d].end));
      const start = Math.max(med[t.id].start, floor);
      Object.assign(p, { start, end: Math.max(start, med[t.id].end) });
    }
    for (const [id, [s, e]] of Object.entries(hand.windows ?? {})) Object.assign(plan.tasks[id], { start: s, end: e });
  }
  plan.touchpoints = P.standardTouchpoints(plan, project, { overtime: hand.overtime });
  for (const [id, who] of Object.entries(hand.backups)) plan.tasks[id].backup = who;
  return plan;
}

function report(project, plan) {
  const ctx = { world, project, deck };
  const checks = P.runChecks(plan, project, world);
  const block = P.blockers(plan, project);
  const peak = Object.entries(P.loadReport(plan, project, world)).map(([r, x]) => `${r} ${Math.round(x.peak.share * 100)}%`).join(', ');
  const planOnly = P.onTimeOdds(plan, ctx, { runs: 500, situations: false }).share;
  const withSit = P.onTimeOdds(plan, ctx, { runs: 500 }).share;
  console.log(`\n${project.title} (launch week ${plan.launchWeek}, gate ${plan.gate})`);
  for (const t of project.tasks) {
    const p = plan.tasks[t.id];
    console.log(`  ${t.id.padEnd(13)} ${String(p.start).padStart(2)}–${String(p.end).padEnd(2)} ${p.locked ? 'locked ' : ''}${p.backup ? `backup ${p.backup}` : ''}`);
  }
  console.log(`  checks: ${checks.map((c) => `${c.name} ${c.status}`).join(' · ')}`);
  for (const c of checks.filter((c) => c.status !== 'pass')) console.log(`    ${c.name}: ${c.reason}`);
  if (block.length) console.log(`  BLOCKERS: ${block.map((b) => b.reason).join('; ')}`);
  console.log(`  peak load: ${peak}`);
  console.log(`  on time, 500 runs: plan only ${Math.round(planOnly * 100)}%, with situations ${Math.round(withSit * 100)}%`);
  return { checks, block };
}

// One task, touchpoint week or risk per line, so a diff shows exactly what moved.
function format(plan) {
  const map = (o) => Object.entries(o).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return `{
  "project": ${JSON.stringify(plan.project)},
  "launchWeek": ${plan.launchWeek},
  "joinWeek": ${plan.joinWeek},
  "gate": ${plan.gate},
  "tasks": {
${map(plan.tasks)}
  },
  "touchpoints": {
${map(plan.touchpoints)}
  },
  "risks": [
${plan.risks.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}
  ]
}
`;
}

const write = process.argv.includes('--write');
let bad = 0;
for (const project of projects) {
  const file = new URL(`content/plans/${project.id}.json`, root);
  let plan;
  if (write) {
    plan = derive(project);
    fs.mkdirSync(new URL('content/plans/', root), { recursive: true });
    fs.writeFileSync(file, format(plan));
  } else {
    plan = JSON.parse(fs.readFileSync(file));
  }
  const { checks, block } = report(project, plan);
  if (block.length || checks.some((c) => c.status === 'fail')) bad++;
}
if (bad) { console.log(`\n${bad} baseline(s) fail a check.`); process.exitCode = 1; }
