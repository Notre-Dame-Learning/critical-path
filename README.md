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

- **Full projects:** Intro to Psychology online (Standard, 14 weeks), AI Ethics documentary micro-course (media-heavy, 15 weeks), Global Health Ethics: case-based course (design-heavy, 12 weeks: branching cases and illustrations) and Rescue: Sustainable Business certificate (hard; you take over in week 6).
- **Sprints:** Accessibility sprint: Organic Chemistry I (4 weeks), Teaching with AI: faculty micro-course (5 weeks) and Course refresh: Intro to Statistics (6 weeks).
- Projects live in `content/projects/` and are listed in `content/projects.json`; each has a Build the Plan baseline in `content/plans/` (`npm run plans`).
- **Standard mode:** pick from 3-6 options; one is best.
- **Hard mode:** write your answer. When the game runs inside Claude, Claude grades it against the situation's options (the rubric); elsewhere, such as GitHub Pages, you pick the option closest to what you wrote. Six situations are talked through instead: Claude plays the stakeholder for up to four replies, then returns a verdict the engine checks and maps to one of the situation's options (`engine/conversation.js`, `content/conversations.json`, `content/stakeholders.json`).
- **Pace:** Story (one more Action Point a week, a week of buffer, a rested team) for a first run, or Standard, the real ODL pace. Set in `engine/difficulty.js`.
- **Progression:** every finished run adds XP on eight skill tracks, achievements and a rank (shown on the start screen and in Your profile). Ranks are recognition only; add `?locks=1` to the URL to lock projects and modes by rank.
- **Build the Plan (in progress):** on the start screen, *Build the plan for …* opens the plan editor for the selected project (`app/plan-screen.js`): a timeline of task bars (tap for the task sheet: weeks, estimate, links, backup; on a computer drag bars and ends or use ← →), an Unscheduled tray, a live checks panel with the eight checks, team load strips and what blocks Submit, a Risks tab (the risk register: add from the project's list or common ODL risks in `content/risks.json`, then give each an owner, mitigation, trigger and contingency; `app/plan-risks.js`), and an on-time odds meter in the header (a seeded 200-run simulation of the plan, recomputed in slices after each edit; `app/plan-odds.js`). Drafts save per project in the browser. **Submit** plays the plan and the project's model plan (`content/plans`) 500 times each, then shows the 100-point score, the odds side by side, a lesson for each failed check (from `content/flaws`), the plan's bars over the model plan's, and XP by check (`app/plan-submit.js`). The touchpoint calendar comes next; until then a plan is checked and played with a stand-in standard calendar fitted to its task weeks, labelled wherever it counts.
- **Daily Mission:** your desk on the start screen offers one situation a day, picked for your weakest skill track (`engine/mission.js`) and kept all day. It opens paused at the week it comes up in a project, with where the project stands; you answer (or write it yourself in Hard, graded by Claude, for 1.5× XP), then the same random future is played with your answer and the best one: three weeks on and to launch 60 times each. The result card leads with launch odds when they moved 10+ points, otherwise the three-week picture, then the debrief, XP (on improvement only, plus a 10 XP daily bonus for a strong answer) and your streak. Once done, *Play it again* is practice with no XP (`app/mission-screen.js`). When Estimating is your weakest track and you've seen its situations, the mission is an **Estimate drill** instead (`engine/estimate.js`, `app/estimate-screen.js`): one team task of 8+ hours from a project's task bank, the owner's quote (Perrick quotes about 25% low), and what the same work took on past courses; you give best, likely and worst hours, then the project is played 60 times by PMs of mixed experience and your range is scored on how many futures it caught (full marks at 80%) times how much wider it was than the 10th–90th percentile range. When Planning, Risk or Capacity is your weakest track and you've seen its situations, the mission is **Spot the flaw** (`engine/spot.js`, `app/spot-screen.js`): a clean plan for one of the three original projects with one flaw from `content/flaws` planted (flaws open at their rank), reviewed on the Critique screen with one *Score my flag* button instead of a verdict. It's scored out of 20 (found 10, severity 3, fix 7, −3 for each flag on something that was fine, at most −9), then the plan as written and with the fix are played 200 times each; XP goes to the flaw's track. Hard mode writes the fix and Claude grades it.
- **Critique the Plan:** on the start screen, *Critique a plan* offers three rounds (Coordinator, PM, Senior PM) on another PM's draft of the Intro to Psychology plan, with 2–4 flaws planted from `content/flaws` (`content/critique-samples.json`). The plan is read-only and no checks show; every task, link, calendar row, the director gate, each risk and each person has a **Flag** action (what's wrong, how serious, and a fix from three options for the category you picked). End with Approve or Send back. The score follows the Critique scoring table (`engine/critique.js`); then the plan as written and the plan with your fixes (only full fixes count) are each played 500 times and compared on on-time odds, rework hours and peak load, and each planted flaw gets a card with where it was, your flag, the best fix, the concept and the SOP step. XP goes to the flaws' skill tracks, best-of per round; a Senior PM round at 70+ meets the Program Manager gate (`app/critique-screen.js`). Standard mode only for now.
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
           Build the Plan checks, odds and scoring (plan.js), Critique the Plan scoring, planting and play-forward (critique.js),
           Monte Carlo odds by policy (montecarlo.js), Daily Mission (mission.js), Estimate drill (estimate.js), Spot the flaw (spot.js), skill tracks (tracks.js),
           progression: XP, ranks, achievements and profile codes (progression.js),
           the AI end-of-run debrief: replay and ranked moves (impact.js), packet, prompt and checks (debrief-gm.js)
content/   world.json (people), projects/, scenarios/, plans/ (Build the Plan baselines), flaws/ and critique-samples.json (Critique the Plan)  — plain JSON, edit freely
app/       the browser game (no build step); plan-edit.js, plan-layout.js, plan-screen.js, plan-risks.js, plan-odds.js and plan-submit.js are the Build the Plan editor; critique-screen.js is Critique the Plan; mission-screen.js is the Daily Mission, estimate-screen.js its Estimate drill and spot-screen.js its Spot the flaw
test/      engine tests: npm test
scripts/   bundle.mjs, talks.mjs (npm run talks: what talking it through is worth), missions.mjs (npm run missions: Daily Mission staging report), odds.mjs (npm run odds: on-time odds by project and policy), plans.mjs (npm run plans: baseline checks and odds; -- --write rebuilds them), grade-testset.mjs (hard-mode grading test set), pending.mjs (upload queue)
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

v0.3 plus Story pace, run codes and Critique scoring (Nov 19): seven projects, 42 situations grounded in the ODL SOPs, a team of five (Li Yu, Perrick Datrick, Sam Rivera, the faculty partner, and supervisor Dwayneah the Retriever Johnson), a schedule gauge, a compact phase view, targeted overtime, and an AI-graded hard mode. Build the Plan and Critique the Plan come next.
