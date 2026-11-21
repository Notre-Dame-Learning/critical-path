// Plan editor, step 3 (risk half): the risk register, the Risks tab of the Build the Plan screen.
// Design: "Plan editor screen" tab, Risk register. Each risk is a card with the risk itself, an owner,
// a mitigation, a trigger (a week and a condition to watch) and a contingency; a card missing any of
// them says which, which is what the Risk owners check reads. "Add from list" offers the project's own
// risks mixed with common ODL risks (content/risks.json); a prompt is only the risk, never its answers.
// Pure: the model and HTML run in Node; plan-screen.js wires the events.
import { runChecks } from '../engine/plan.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const RISK_PARTS = [
  { key: 'owner', label: 'Owner', help: 'Who watches for it and acts' },
  { key: 'mitigation', label: 'Mitigation', help: 'What you do now to make it less likely', placeholder: 'e.g. Agree review dates with the reviewer at kickoff' },
  { key: 'trigger', label: 'Trigger', help: 'A week and a condition that says it is happening', placeholder: 'e.g. No feedback three days after sending, from week 4' },
  { key: 'contingency', label: 'Contingency', help: 'What you do if the trigger fires', placeholder: 'e.g. Take the review into the next working session' },
];

const filled = (v) => String(v ?? '').trim().length > 0;
const norm = (s) => String(s ?? '').trim().toLowerCase();

// Who can own a risk: you (the PM) and the staff on this project. Owners are stored as the baseline
// plans store them: "PM" or a short name.
export function riskOwners(project, world) {
  const staff = ['ld', 'mp', 'gd']
    .filter((r) => project.team?.[r])
    .map((r) => world.people.find((p) => p.id === project.team[r]))
    .filter(Boolean)
    .map((p) => ({ value: p.short, label: p.short }));
  return [{ value: 'PM', label: 'You (PM)' }, ...staff];
}

// The Add from list choices not already in the plan: this project's risks first, then common ODL risks.
export function riskPrompts(prompts, project, plan) {
  const have = new Set((plan.risks ?? []).map((r) => norm(r.text)));
  const pick = (list) => (list ?? []).filter((x) => !have.has(norm(x.text)));
  return { project: pick(prompts?.projects?.[project.id]), common: pick(prompts?.common) };
}

// The register as the tab draws it: one card per risk with what it's missing.
export function riskModel(plan, project, world, prompts, { checks = null } = {}) {
  const check = (checks ?? runChecks(plan, project, world)).find((c) => c.id === 'risks');
  const owners = riskOwners(project, world);
  const cards = (plan.risks ?? []).map((r) => {
    const missing = [!filled(r.text) && 'the risk itself', ...RISK_PARTS.filter((p) => !filled(r[p.key])).map((p) => p.label.toLowerCase())].filter(Boolean);
    // An owner typed in another plan (or an old draft) still shows, so nothing silently changes.
    const ownerList = filled(r.owner) && !owners.some((o) => o.value === r.owner) ? [...owners, { value: r.owner, label: r.owner }] : owners;
    return { ...r, missing, complete: missing.length === 0, owners: ownerList };
  });
  return {
    cards,
    owners,
    prompts: riskPrompts(prompts, project, plan),
    check,
    complete: cards.filter((c) => c.complete).length,
  };
}

export function risksHtml(model, { highlight = { risks: [] }, focus = null } = {}) {
  const hl = new Set(highlight?.risks ?? []);
  const { cards, prompts, check } = model;
  const field = (c, p) => {
    const id = `pe-risk-${c.id}-${p.key}`;
    const missing = !filled(c[p.key]);
    const control = p.key === 'owner'
      ? `<select id="${id}" data-pe-risk="${esc(c.id)}" data-field="owner"${missing ? ' aria-invalid="true"' : ''}><option value="">Pick an owner</option>${c.owners.map((o) => `<option value="${esc(o.value)}" ${o.value === c.owner ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
      : `<textarea id="${id}" rows="2" data-pe-risk="${esc(c.id)}" data-field="${p.key}" placeholder="${esc(p.placeholder)}"${missing ? ' aria-invalid="true"' : ''}>${esc(c[p.key])}</textarea>`;
    return `<label class="pe-risk-field${missing ? ' missing' : ''}" for="${id}"><span>${p.label}<small>${esc(p.help)}</small></span>${control}</label>`;
  };
  const card = (c, i) => `<li class="pe-risk card${c.complete ? ' complete' : ' incomplete'}${hl.has(c.id) ? ' hl' : ''}" data-risk="${esc(c.id)}">
      <div class="pe-risk-head"><span class="pe-icon" aria-hidden="true">${c.complete ? '✓' : '!'}</span>
        <label class="pe-risk-text" for="pe-risk-${esc(c.id)}-text"><span class="sr">Risk ${i + 1}</span>
          <textarea id="pe-risk-${esc(c.id)}-text" rows="1" data-pe-risk="${esc(c.id)}" data-field="text" placeholder="What could go wrong?"${filled(c.text) ? '' : ' aria-invalid="true"'}>${esc(c.text)}</textarea></label>
        <button type="button" class="pe-risk-remove" data-pe="risk-remove" data-id="${esc(c.id)}" aria-label="Remove risk ${i + 1}${filled(c.text) ? `: ${esc(c.text)}` : ''}">Remove</button></div>
      <p class="small ${c.complete ? 'pe-risk-ok' : 'pe-risk-missing'}">${c.complete ? 'Complete' : `Missing ${esc(listOf(c.missing))}`}</p>
      <div class="pe-risk-fields">${RISK_PARTS.map((p) => field(c, p)).join('')}</div>
    </li>`;
  const option = (x, group) => `<option value="${group}:${esc(x.id)}">${esc(x.text)}</option>`;
  const any = prompts.project.length + prompts.common.length;
  const adder = `<div class="pe-risk-add">
      <select id="pe-risk-pick" aria-label="Add a risk from the list"${any ? '' : ' disabled'}><option value="">${any ? 'Add from list…' : 'Every listed risk is in'}</option>
        ${prompts.project.length ? `<optgroup label="This project">${prompts.project.map((x) => option(x, 'project')).join('')}</optgroup>` : ''}
        ${prompts.common.length ? `<optgroup label="Common in ODL">${prompts.common.map((x) => option(x, 'common')).join('')}</optgroup>` : ''}
      </select>
      <button type="button" data-pe="risk-add-pick"${any ? '' : ' disabled'}>Add</button>
      <button type="button" data-pe="risk-add">Write your own</button>
    </div>`;
  const status = check
    ? `<p class="pe-risk-check ${check.status}"><span class="pe-icon" aria-hidden="true">${check.status === 'pass' ? '✓' : '✗'}</span>${esc(check.reason)}</p>`
    : '';
  return `<section class="pe-risks card" aria-label="Risk register" data-focus="${esc(focus ?? '')}">
    <h3>Risk register <span class="muted">${model.complete}/${cards.length} complete</span></h3>
    <p class="small muted">Name what could knock the plan off course. Each risk needs an owner, a mitigation, a trigger to watch for, and a contingency.</p>
    ${status}
    ${cards.length ? `<ol class="pe-risk-list">${cards.map(card).join('')}</ol>` : '<p class="pe-empty small muted">No risks yet. Add one from the list or write your own.</p>'}
    ${adder}
  </section>`;
}

// The risk a picked option adds: only its text; the player fills the rest.
export function promptFor(value, prompts, project) {
  const [group, id] = String(value ?? '').split(':');
  const list = group === 'project' ? prompts?.projects?.[project.id] : group === 'common' ? prompts?.common : null;
  const x = list?.find((r) => r.id === id);
  return x ? { text: x.text } : null;
}

function listOf(xs) {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}
