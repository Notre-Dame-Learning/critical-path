# Critical Path

A project management simulator for Notre Dame's Office of Digital Learning (ODL). The player is a new PM taking an online course from kickoff to launch with a Learning Designer, a Media Producer and a faculty partner. Built first for ODL's PM Student Fellow.

Design source of truth: the "Project Management Simulator — Research & Game Framework" doc (Claude Docs).

## Play

```
npm start          # serves the repo at http://localhost:8080
```

Then open `http://localhost:8080/app/`. Add `?seed=anything` to the URL to replay a specific run. The game also works on GitHub Pages with no build step.

## How it works

- **One turn = one week.** Spend Action Points (check-ins, faculty updates, quality reviews, overtime), then end the week.
- **Situations** come up from the scenario deck. Every one offers an independent fix, a good escalation (with a recommendation), a bare escalation, and usually a wait-and-see option. Escalating is always allowed; the debrief explains what a PM could have done alone and when escalating is right.
- **Hidden rework.** Work done under pressure, overtime or low morale hides mistakes that surface later, fastest once QA starts. Check-ins and quality reviews find them early.
- **Fixed launch.** The course opens in the launch week whether it's finished or not.
- **Scoring:** course complete, quality, team health, faculty trust, and judgment (credit for how each situation was handled).

## Layout

```
engine/    simulation rules (sim.js) and seeded random numbers (rng.js)
content/   world.json (people), projects/, scenarios/  — plain JSON, edit freely
app/       the browser game (no build step)
test/      engine tests: npm test
docs/      build notes
```

## Adding a scenario

Add an event to `content/scenarios/core-deck.json`:

- `trigger`: week window, task conditions (`taskStarted`, `taskDone`, `taskNotDone`) and a `chance`.
- `choices`: each with a `tier` (`resolve`, `escalate_plan`, `escalate`, `ignore`), optional `credit` (0–1), `effects`, and an `outcome` line.
- `debrief`: `concept`, `independent` (how to handle it without escalating) and `escalateWhen`.

Effects: `trust`, `morale` (`who`), `responsiveness` (`weeks`), `capacity` (`who`, `weeks`), `addEffort` (`task`), `addHiddenRework` (`task`), `removeDependency` (`task`, `dep`).

`npm test` checks that every event has a full-credit independent answer and both debrief explanations.

## Status

v0.2: Run a Project is playable with one course built on the ODL PM, Learning Design and Media SOPs, 21 situations (3–6 choices each, one best answer, SOP references), drawn portraits with five expressions, and a situation at least every other week. Build the Plan and Critique the Plan come next.
