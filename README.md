# Critical Path

A project management simulator for Notre Dame's Office of Digital Learning (ODL). The player is a new PM taking an online course from kickoff to launch with a Learning Designer, a Media Producer and a faculty partner. Built first for ODL's PM Student Fellow.

Design source of truth: the "Project Management Simulator — Research & Game Framework" doc (Claude Docs).

## Play

```
npm start          # serves the repo at http://localhost:8080
```

Then open `http://localhost:8080/app/`. Type a **run code** (for example `fellow-1`) on the start screen, or add `?seed=anything` to the URL, to replay a specific run; the end screen shows the run's code. The game also works on GitHub Pages with no build step: the root `index.html` opens the game.

`npm run bundle` builds `dist/critical-path.html`, a single self-contained page (used for the version hosted in Claude).

## Projects and modes

- **Intro to Psychology online** (Standard, 14 weeks), **AI Ethics documentary micro-course** (media-heavy, 15 weeks) and **Rescue: Sustainable Business certificate** (hard; you take over in week 6). Projects live in `content/projects/` and are listed in `content/projects.json`.
- **Standard mode:** pick from 3-6 options; one is best.
- **Hard mode:** write your answer. When the game runs inside Claude, Claude grades it against the situation's options (the rubric); elsewhere, such as GitHub Pages, you pick the option closest to what you wrote.
- **Pace:** Story (one more Action Point a week, a week of buffer, a rested team) for a first run, or Standard, the real ODL pace. Set in `engine/difficulty.js`.
- **Schedule gauge:** compares finished work with the pace needed to launch on time (earned schedule), in weeks ahead or behind.

## How it works

- **One turn = one week.** Spend Action Points (check-ins, faculty updates, quality reviews, overtime), then end the week.
- **Situations** come up from the scenario deck. Every one offers an independent fix, a good escalation (with a recommendation), a bare escalation, and usually a wait-and-see option. Escalating is always allowed; the debrief explains what a PM could have done alone and when escalating is right.
- **Hidden rework.** Work done under pressure, overtime or low morale hides mistakes that surface later, fastest once QA starts. Check-ins and quality reviews find them early.
- **Fixed launch.** The course opens in the launch week whether it's finished or not.
- **Scoring:** course complete, quality, team health, faculty trust, and judgment (credit for how each situation was handled).

## Layout

```
engine/    simulation rules (sim.js), seeded random numbers (rng.js), Story pace (difficulty.js),
           Build the Plan checks, odds and scoring (plan.js), Critique the Plan scoring (critique.js),
           Monte Carlo odds by policy (montecarlo.js), Daily Mission (mission.js), skill tracks (tracks.js)
content/   world.json (people), projects/, scenarios/, plans/ (Build the Plan baselines), flaws/ and critique-samples.json (Critique the Plan)  — plain JSON, edit freely
app/       the browser game (no build step)
test/      engine tests: npm test
scripts/   bundle.mjs, missions.mjs (npm run missions: Daily Mission staging report), odds.mjs (npm run odds: on-time odds by project and policy), plans.mjs (npm run plans: baseline checks and odds; -- --write rebuilds them), grade-testset.mjs (hard-mode grading test set), pending.mjs (upload queue)
docs/      build notes
```

## Adding a scenario

Add an event to `content/scenarios/core-deck.json`:

- `trigger`: week window, task conditions (`taskStarted`, `taskDone`, `taskNotDone`) and a `chance`.
- `choices`: each with a `tier` (`resolve`, `escalate_plan`, `escalate`, `ignore`), optional `credit` (0–1), `effects`, and an `outcome` line.
- `debrief`: `concept`, `independent` (how to handle it without escalating) and `escalateWhen`.

Text can use `{ld}`, `{mp}`, `{gd}`, `{sup}`, `{faculty}` and faculty pronouns `{fsub}`, `{fobj}`, `{fpos}` (`{Fsub}` capitalized). Add `projects: ["id"]` to limit a situation to certain projects.

Effects: `trust`, `morale` (`who`), `responsiveness` (`weeks`), `capacity` (`who`, `weeks`), `addEffort` (`task`), `addHiddenRework` (`task`), `removeDependency` (`task`, `dep`).

`npm test` checks that every event has a full-credit independent answer and both debrief explanations.

## Status

v0.3 plus Story pace, run codes and Critique scoring (Nov 19): three projects, 33 situations grounded in the ODL SOPs, a team of five (Li Yu, Perrick Datrick, Sam Rivera, the faculty partner, and supervisor Dwayneah the Retriever Johnson), a schedule gauge, a compact phase view, targeted overtime, and an AI-graded hard mode. Build the Plan and Critique the Plan come next.
