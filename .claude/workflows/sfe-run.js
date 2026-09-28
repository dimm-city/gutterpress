export const meta = {
  name: 'sfe-run',
  description: 'One stage of a source-first-editor run: implementation/test lanes, adversarial batch review, report-only gate',
  whenToUse: 'Orchestrates runs from docs/plans/source-first-editor-enterprise-refactor.md. Invoke once per stage with args {runId, stage: "lanes"|"review"|"gate", ...}; the integrator commits between stages.',
  phases: [
    { title: 'Lanes', detail: 'parallel lane agents with disjoint write ownership' },
    { title: 'Scout', detail: 'partition the run diff into review batches' },
    { title: 'Review', detail: 'adversarial batch review of base..HEAD' },
    { title: 'Repair', detail: 'fix CONFIRMED findings, bounded rounds' },
    { title: 'Gate', detail: 'report-only verification' },
  ],
}

// ---------------------------------------------------------------------------
// args contract (all stages): {
//   runId:        "SFE-P0a"                       (required)
//   stage:        "lanes" | "review" | "gate"      (required)
//   specPath:     "docs/plans/source-first-editor/runs/SFE-P0a.md"
//   planPath:     defaults to "docs/plans/source-first-editor-enterprise-refactor.md"
//   commitScope:  "p0"  (conventional-commit scope for in-workflow fix commits)
// stage "lanes":
//   laneKind:     "test" | "implement"  (what discipline rules apply)
//   lanes:        [{ name, goal, writePaths: [], mustNotWrite: [], details }]
// stage "review":
//   baseSha:      recorded implementation base SHA (required)
//   reviewFocus:  [extra adversarial questions]
//   maxRepairRounds: default 3
//   commit:       true|false — whether repair rounds commit fixes (default true)
// stage "gate":
//   gateCommands: ["bun run typecheck", ...]
// ---------------------------------------------------------------------------

const LANE_SCHEMA = {
  type: 'object',
  required: ['lane', 'status', 'summary', 'filesChanged', 'verification'],
  properties: {
    lane: { type: 'string' },
    status: { type: 'string', enum: ['complete', 'blocked'] },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    verification: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'exitCode'],
        properties: {
          command: { type: 'string' },
          exitCode: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
    blockedReason: { type: 'string' },
    notes: { type: 'string' },
  },
}

const BATCHES_SCHEMA = {
  type: 'object',
  required: ['batches', 'totalFilesChanged', 'diffstat'],
  properties: {
    batches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'files'],
        properties: {
          label: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
      },
    },
    totalFilesChanged: { type: 'number' },
    diffstat: { type: 'string' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'summary'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['classification', 'title', 'detail'],
        properties: {
          classification: { type: 'string', enum: ['CONFIRMED', 'ADVISORY'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          detail: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const CONSOLIDATED_SCHEMA = {
  type: 'object',
  required: ['confirmed', 'advisories', 'verdict', 'summary'],
  properties: {
    confirmed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'detail'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
      },
    },
    advisories: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'detail'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    verdict: { type: 'string', enum: ['approve', 'needs-repair'] },
    summary: { type: 'string' },
  },
}

const REPAIR_SCHEMA = {
  type: 'object',
  required: ['status', 'addressed', 'verification'],
  properties: {
    status: { type: 'string', enum: ['complete', 'blocked'] },
    addressed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'action'],
        properties: {
          title: { type: 'string' },
          action: { type: 'string' },
          filesChanged: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    verification: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'exitCode'],
        properties: { command: { type: 'string' }, exitCode: { type: 'number' } },
      },
    },
    blockedReason: { type: 'string' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['passed', 'commands'],
  properties: {
    passed: { type: 'boolean' },
    commands: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'exitCode'],
        properties: {
          command: { type: 'string' },
          exitCode: { type: 'number' },
          durationNote: { type: 'string' },
          counts: { type: 'string' },
          failureSummary: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const COMMIT_SCHEMA = {
  type: 'object',
  required: ['committed'],
  properties: {
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    message: { type: 'string' },
    note: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------

if (!args || !args.runId || !args.stage) {
  throw new Error('sfe-run requires args {runId, stage}')
}

const runId = args.runId
const stage = args.stage
const planPath = args.planPath || 'docs/plans/source-first-editor-enterprise-refactor.md'
const specPath = args.specPath || null
const commitScope = args.commitScope || 'p0'

const COMMON_RULES = [
  `You are one actor in run ${runId} of the Gutterpress source-first editor plan.`,
  `Read the plan's binding decisions first: ${planPath} (sections "Binding design decisions" D1-D15 and "Lane rules").`,
  specPath ? `Read the run specification: ${specPath}. It is authoritative for this run.` : '',
  `Also honor the guardrails in docs/plans/source-first-editor/pr158-lessons.md (G-01..G-12, AP catalog).`,
  `Repository root: the current working directory. Work branch: the currently checked-out branch — never switch branches.`,
  `NEVER run "git commit", "git push", "git checkout", "git reset", or modify git state unless your role explicitly says so.`,
  `NEVER introduce prosemirror-family, tiptap, or milkdown dependencies or imports.`,
  `NEVER add a new desktop HTTP route (packages/desktop/src/routes/api/**) — the plan forbids it.`,
  `Do not mention agent or model names in any file you write.`,
].filter(Boolean).join('\n')

// ---------------------------------------------------------------------------
// stage: lanes
// ---------------------------------------------------------------------------

async function runLanes() {
  const lanes = args.lanes || []
  if (!lanes.length) throw new Error('stage "lanes" requires args.lanes')
  const laneKind = args.laneKind || 'implement'

  const discipline = laneKind === 'test'
    ? [
        'LANE DISCIPLINE (test authoring):',
        '- Characterization tests pin CURRENT behavior with exact assertions; a later unintended change must trip a pinned assertion.',
        '- Contract tests for intended-but-missing behavior must FAIL against a null implementation. State in a comment which implementation run turns them green, and keep them excluded from default test runs (e.g. .todo/.skip with a tracking note) only if the spec says so.',
        '- Every gate/test must include a liveness assertion: an empty target set is a fixture error, never a silent pass (lesson AP-21).',
        '- Committed fixtures are immutable inputs; tests operate on disposable copies (lesson AP-25).',
        '- Follow the existing test conventions of the package you write in (bun:test for packages/desktop/tests and packages/cli).',
      ].join('\n')
    : [
        'LANE DISCIPLINE (implementation):',
        '- You may NOT weaken, delete, or rewrite approved tests.',
        '- A signature change and all its production callers land in the same lane deliverable.',
        '- No new framework, compatibility path, public feature, or dependency not named in the run specification.',
        '- Prefer the smallest design that fully satisfies the specification (plan: clean-code guidance).',
      ].join('\n')

  phase('Lanes')
  log(`${runId}: ${lanes.length} ${laneKind} lane(s) fanning out`)

  const results = await parallel(lanes.map((lane) => () =>
    agent(
      [
        COMMON_RULES,
        '',
        `ROLE: ${laneKind === 'test' ? 'Test' : 'Implementation'} lane agent — Lane ${lane.name}.`,
        `GOAL: ${lane.goal}`,
        '',
        discipline,
        '',
        'WRITE OWNERSHIP (hard boundary — read anything, write ONLY these paths):',
        ...lane.writePaths.map((p) => `- ${p}`),
        lane.mustNotWrite && lane.mustNotWrite.length
          ? 'MUST NOT WRITE (other lanes own these):\n' + lane.mustNotWrite.map((p) => `- ${p}`).join('\n')
          : '',
        '',
        'DETAILS:',
        lane.details,
        '',
        'Before reporting, run targeted verification for the files you touched (typecheck of the owned package and the specific test files); record each command and exit code.',
        'Leave all changes uncommitted in the working tree. Return the structured lane report.',
      ].filter(Boolean).join('\n'),
      { label: `lane:${lane.name}`, phase: 'Lanes', schema: LANE_SCHEMA, model: lane.model || 'sonnet' },
    )
  ))

  const laneReports = results.filter(Boolean)
  const blocked = laneReports.filter((r) => r.status === 'blocked')
  const missing = lanes.length - laneReports.length
  return {
    status: blocked.length || missing ? 'blocked' : 'complete',
    stage, runId,
    lanes: laneReports,
    missingLaneResults: missing,
  }
}

// ---------------------------------------------------------------------------
// stage: review
// ---------------------------------------------------------------------------

async function runReview() {
  const baseSha = args.baseSha
  if (!baseSha) throw new Error('stage "review" requires args.baseSha')
  const maxRounds = args.maxRepairRounds ?? 3
  const doCommit = args.commit !== false
  const focus = (args.reviewFocus || []).map((q) => `- ${q}`).join('\n')

  phase('Scout')
  const partition = await agent(
    [
      COMMON_RULES,
      '',
      `ROLE: Review scout. Partition the run diff for batched review. Do not modify any file.`,
      `Run: git diff --stat ${baseSha}..HEAD  and  git diff --name-status ${baseSha}..HEAD`,
      'Group the changed files into 1-4 coherent review batches (by package/subsystem; keep a contract change and its consumers in ONE batch). Include every changed file in exactly one batch.',
      'Return the batches, total changed-file count, and the diffstat text.',
    ].join('\n'),
    { label: 'review:scout', phase: 'Scout', schema: BATCHES_SCHEMA, model: 'sonnet', effort: 'low' },
  )
  if (!partition) throw new Error('review scout failed')
  if (partition.totalFilesChanged === 0) {
    return { status: 'blocked', stage, runId, note: 'empty diff — nothing to review (liveness check)' }
  }
  log(`${runId}: reviewing ${partition.totalFilesChanged} files in ${partition.batches.length} batch(es)`)

  const REVIEW_DIMENSIONS = [
    'Does behavior match the run specification and binding decisions D1-D15?',
    'Hidden alternate paths that bypass source-version validation or fail open?',
    'Are all callers and consumers of changed contracts updated?',
    'Can source bytes change outside an explicit edit? Can generated or rendered HTML reach source?',
    'Can the tests pass without the intended implementation (vacuous tests, empty target sets, weak assertions)?',
    'Are deletion claims proven by search, dependency analysis, and test results?',
    'Was complexity added without current capability value (plan: abstraction rubric)?',
    'Does package import direction match D4? Any ProseMirror-family or new-HTTP-route violation?',
    'External edits, disposal, cancellation, race windows, and stale async results (G-11).',
  ]

  phase('Review')
  const batchFindings = await parallel(partition.batches.map((batch) => () =>
    agent(
      [
        COMMON_RULES,
        '',
        `ROLE: Senior adversarial code reviewer. Review ONE batch of run ${runId}. You never edit files.`,
        `Diff under review: git diff ${baseSha}..HEAD -- <file> for each file in your batch. Read full files for context, not just hunks.`,
        `BATCH "${batch.label}": ${batch.files.join(', ')}`,
        '',
        'Review dimensions:',
        ...REVIEW_DIMENSIONS.map((d) => `- ${d}`),
        focus ? 'Run-specific adversarial questions:\n' + focus : '',
        '',
        'Classify each finding CONFIRMED (must fix before the gate — a real defect, spec violation, or unproven deletion/claim) or ADVISORY (recorded, may defer).',
        'Verify a suspected defect against the actual code before confirming it; do not report speculation as CONFIRMED.',
      ].filter(Boolean).join('\n'),
      { label: `review:${batch.label}`, phase: 'Review', schema: FINDINGS_SCHEMA, model: 'opus', effort: 'high' },
    )
  ))

  const merged = batchFindings.filter(Boolean).flatMap((r) => r.findings)
  let consolidated = await agent(
    [
      COMMON_RULES,
      '',
      `ROLE: Lead reviewer for run ${runId}. Consolidate batch findings into one review verdict. You never edit files.`,
      `The whole-run diff is git diff ${baseSha}..HEAD. Spot-check the diff yourself for cross-batch coherence the per-batch reviewers could not see (contract co-updates, duplicated logic across lanes, lane-boundary violations).`,
      '',
      'Batch findings (verify, dedupe, drop anything the code disproves, add cross-batch findings):',
      JSON.stringify(merged, null, 2),
      '',
      'verdict "needs-repair" iff at least one CONFIRMED finding stands.',
    ].join('\n'),
    { label: 'review:lead', phase: 'Review', schema: CONSOLIDATED_SCHEMA, model: 'opus', effort: 'high' },
  )
  if (!consolidated) throw new Error('lead reviewer failed')

  const rounds = []
  let round = 0
  while (consolidated.verdict === 'needs-repair' && round < maxRounds) {
    round += 1
    phase('Repair')
    log(`${runId}: repair round ${round} — ${consolidated.confirmed.length} confirmed finding(s)`)

    const repair = await agent(
      [
        COMMON_RULES,
        '',
        `ROLE: Repair agent for run ${runId}, round ${round}. Fix every CONFIRMED finding below. Do not address advisories unless trivially co-located. Do not weaken or delete approved tests to make a finding disappear.`,
        '',
        'CONFIRMED findings:',
        JSON.stringify(consolidated.confirmed, null, 2),
        '',
        'After fixing, run the fast check (bun run typecheck) plus the targeted tests for the files you changed; record commands and exit codes. Leave changes uncommitted.',
      ].join('\n'),
      { label: `repair:round${round}`, phase: 'Repair', schema: REPAIR_SCHEMA, model: 'sonnet' },
    )
    let commitResult = null
    if (repair && repair.status === 'complete' && doCommit) {
      commitResult = await agent(
        [
          `ROLE: Integrator commit step for run ${runId}. The working tree contains review-fix changes that already passed the fast check.`,
          `Run: bun run typecheck — if it fails, do NOT commit; report committed:false with the failure note.`,
          `If it passes: git add -A && git commit -m "fix(${commitScope}): address review findings (round ${round})" — plain message, no other text, no model names. Do NOT push. Report the new SHA.`,
        ].join('\n'),
        { label: `commit:round${round}`, phase: 'Repair', schema: COMMIT_SCHEMA, model: 'sonnet', effort: 'low' },
      )
    }

    consolidated = await agent(
      [
        COMMON_RULES,
        '',
        `ROLE: Lead reviewer, re-review after repair round ${round} of run ${runId}. You never edit files.`,
        `Re-examine git diff ${baseSha}..HEAD. For each previously CONFIRMED finding below, verify in the code that it is actually fixed — do not accept the repair report's word for it. Keep any unfixed finding CONFIRMED; add new CONFIRMED findings only if the repair introduced a defect.`,
        '',
        'Previously confirmed:',
        JSON.stringify(consolidated.confirmed, null, 2),
        '',
        'Repair report:',
        JSON.stringify(repair, null, 2),
      ].join('\n'),
      { label: `re-review:round${round}`, phase: 'Repair', schema: CONSOLIDATED_SCHEMA, model: 'opus', effort: 'high' },
    )
    if (!consolidated) throw new Error(`re-review round ${round} failed`)
    rounds.push({ round, repair, commit: commitResult, verdict: consolidated.verdict, remaining: consolidated.confirmed.length })
  }

  const exhausted = consolidated.verdict === 'needs-repair'
  return {
    status: exhausted ? 'blocked' : 'complete',
    stage, runId, baseSha,
    batches: partition.batches.map((b) => b.label),
    rounds,
    confirmedFindings: consolidated.confirmed,
    advisories: consolidated.advisories,
    reviewSummary: consolidated.summary,
    note: exhausted ? `review exceeded ${maxRounds} repair rounds — stop and re-plan per the plan's stop conditions` : '',
  }
}

// ---------------------------------------------------------------------------
// stage: gate
// ---------------------------------------------------------------------------

async function runGate() {
  const gateCommands = args.gateCommands || []
  if (!gateCommands.length) throw new Error('stage "gate" requires args.gateCommands')

  phase('Gate')
  log(`${runId}: report-only gate — ${gateCommands.length} command(s)`)
  const gate = await agent(
    [
      COMMON_RULES,
      '',
      `ROLE: Report-only gate agent for run ${runId}. You NEVER edit files, never commit, never "fix" anything — you run the verification suite and report exactly what happened.`,
      'Run each command below from the repository root, sequentially, capturing exit code, a one-line duration note, and any test/assertion counts printed. If a command fails, capture the concise failure summary (the actual failing test names/errors, not the whole log).',
      'A command that cannot run in this environment is reported with its exact error — never summarized as passed. passed=true only if every command exited 0.',
      '',
      'GATE COMMANDS:',
      ...gateCommands.map((c) => `- ${c}`),
    ].join('\n'),
    { label: 'gate', phase: 'Gate', schema: GATE_SCHEMA, model: 'sonnet', effort: 'low' },
  )
  if (!gate) throw new Error('gate agent failed')
  return { status: gate.passed ? 'complete' : 'gate-failed', stage, runId, gate }
}

// ---------------------------------------------------------------------------

if (stage === 'lanes') return await runLanes()
if (stage === 'review') return await runReview()
if (stage === 'gate') return await runGate()
throw new Error(`unknown stage "${stage}"`)
