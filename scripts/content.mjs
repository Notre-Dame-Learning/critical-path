// The content a bundled build inlines as window.CP_CONTENT (scripts/bundle.mjs), in the same shape
// app/app.js fetches in the dev build. Kept apart so a test can check it without running esbuild.
import fs from 'node:fs';
import path from 'node:path';
import { CHECKS } from '../engine/plan.js';

export function bundleContent(root) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const manifest = read('content/projects.json');
  return {
    world: read('content/world.json'),
    deck: read('content/scenarios/core-deck.json'),
    projects: manifest.projects.map((id) => read(`content/projects/${id}.json`)),
    conversations: read('content/conversations.json'),
    stakeholders: read('content/stakeholders.json'),
    risks: read('content/risks.json'),
    // Build the Plan: the model plan per project (scored against on Submit) and the flaw files by check,
    // whose concept, SOP step and explanation are the debrief's lessons.
    plans: Object.fromEntries(manifest.projects.filter((id) => fs.existsSync(path.join(root, `content/plans/${id}.json`))).map((id) => [id, read(`content/plans/${id}.json`)])),
    flaws: Object.fromEntries(CHECKS.map((c) => [c.id, read(`content/flaws/${c.flaw}.json`)])),
  };
}
