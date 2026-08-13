# Twin AI 실시간 분석 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 실시간 ECU·운행기록을 분석해 Twin AI 패널, 자연어 질문 답변, 이상 원인 분석, 운행기록 요약, 자동 상세 진단 리포트를 제공한다.

**Architecture:** 기존 `evaluateDiagnostic`을 센서 판정의 단일 기준으로 유지하고, `website/lib/twin-ai/analyzer.ts`가 장비별 판정·운행기록·이벤트를 받아 구조화된 AI 분석 결과를 만든다. React 화면은 1초 ECU polling 결과를 기준으로 분석 결과를 다시 계산하며, 자연어 질문은 로컬 키워드 분류로 처리한다.

**Tech Stack:** React 19, TypeScript, vinext, Node test runner, 기존 CSS 기반 반응형 UI.

## Global Constraints

- 외부 LLM API 없이 강의실 시연이 가능해야 한다.
- 분석 입력은 배터리, 냉각수 온도, 엔진오일 온도, 진동 RMS와 현재 운행기록만 사용한다.
- 실제 ML 학습으로 표현하지 않고 “더미 학습 프로필 기반 시연용 분석”으로 표시한다.
- 장비 이름은 P-01호부터 P-05호까지 기존 명칭을 유지한다.
- 위험도는 텍스트와 점수를 함께 표시해 색상에만 의존하지 않는다.
- 모바일에서 Twin AI 패널이 화면 밖으로 밀리지 않아야 한다.

---

### Task 1: 구조화된 Twin AI 분석 엔진

**Files:**
- Create: `website/lib/twin-ai/analyzer.ts`
- Test: `website/tests/twin-ai-analyzer.test.mjs`

**Interfaces:**
- Consumes: `EcuSnapshot`, `DiagnosticReport`, 지게차 목록, 운행기록 배열, 이벤트 배열
- Produces: `answerQuestion`, `analyzeIncident`, `summarizeDrivingRecords`, `buildFleetReport`

- [ ] **Step 1: Write the failing tests**

```js
test("finds the highest-risk forklift from live diagnostics", () => {
  const result = buildFleetReport(forklifts, snapshots, records, events);
  assert.equal(result.highestRiskForklift, "P-04호");
  assert.ok(result.highestRiskScore >= 0);
});

test("answers the highest-risk natural-language question", () => {
  const result = answerQuestion("현재 가장 위험한 장비는?", context);
  assert.match(result.answer, /P-04호/);
});

test("creates an incident cause analysis", () => {
  const result = analyzeIncident(forklift, urgentDiagnostic);
  assert.match(result.cause, /온도|진동|배터리/);
  assert.ok(result.actions.length > 0);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/twin-ai-analyzer.test.mjs`

Expected: FAIL because `website/lib/twin-ai/analyzer.ts` does not exist.

- [ ] **Step 3: Implement the analyzer**

Define these types and functions:

```ts
export type TwinAiContext = {
  forklifts: Array<{ id: string; zone: string; task: string; status: string }>;
  snapshots: Record<string, EcuSnapshot>;
  diagnostics: Record<string, DiagnosticReport>;
  records: string[][];
  events: Array<{ time: string; label: string; text: string; tone: string }>;
};

export type TwinAiResult = {
  title: string;
  answer: string;
  evidence: string[];
  actions: string[];
  targetId?: string;
};

export function answerQuestion(question: string, context: TwinAiContext): TwinAiResult;
export function analyzeIncident(forklift: TwinAiContext["forklifts"][number], diagnostic: DiagnosticReport): TwinAiResult;
export function summarizeDrivingRecords(records: string[][], forklifts: TwinAiContext["forklifts"], events: TwinAiContext["events"]): TwinAiResult;
export function buildFleetReport(forklifts: TwinAiContext["forklifts"], snapshots: TwinAiContext["snapshots"], records: string[][], events: TwinAiContext["events"]): TwinAiResult & { highestRiskForklift: string; highestRiskScore: number };
```

Use the existing diagnostic report score to rank equipment. Classify questions by `위험`, `상태`, `정비`, `운행`, `기록`, `요약`, `전체`, `리포트`, and matching `P-01호`–`P-05호`. Return a safe help response for empty or unsupported questions.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/twin-ai-analyzer.test.mjs`

Expected: PASS for risk ranking, natural-language answer, incident cause, record summary, and unsupported question handling.

- [ ] **Step 5: Commit the analyzer**

```bash
git add website/lib/twin-ai/analyzer.ts website/tests/twin-ai-analyzer.test.mjs
git commit -m "feat: add local Twin AI analyzer"
```

### Task 2: Real-time AI context in the dashboard

**Files:**
- Modify: `website/app/page.tsx`

**Interfaces:**
- Consumes: Task 1 analyzer functions and existing ECU polling state
- Produces: `aiContext`, selected diagnostic map, live AI result state, question submit handler

- [ ] **Step 1: Add derived diagnostics for all five forklifts**

Build a snapshot for every forklift using the live ECU snapshot when available and the forklift fallback values otherwise. Memoize a `Record<string, DiagnosticReport>` using `evaluateDiagnostic`.

- [ ] **Step 2: Add Twin AI state and handlers**

Add `aiQuestion`, `aiResult`, and `aiQuestionError` state. Initialize the panel with `buildFleetReport`. On submit, trim the question, reject an empty value with Korean guidance, and call `answerQuestion` with the current context. On incident generation, call `analyzeIncident` after state updates and prepend a diagnostic event describing the cause.

- [ ] **Step 3: Replace static AI messaging**

Use the structured result to update the existing map overlay and remove hardcoded incident-only sentences. The overlay should show the selected/highest-risk target and its current summary.

- [ ] **Step 4: Update the existing report modal**

Use `buildFleetReport` for the “전체 분석결과 생성” action and use the selected device’s `DiagnosticReport` plus `summarizeDrivingRecords` for the selected-device report. Include findings, causes, recommendations, priority, record summary, and analysis basis.

### Task 3: Twin AI panel and report UI

**Files:**
- Modify: `website/app/page.tsx`
- Modify: `website/app/globals.css`
- Modify: `website/tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: Task 2 `aiResult`, `diagnostics`, question state, and report handlers
- Produces: visible responsive panel and accessible question controls

- [ ] **Step 1: Add the right-side panel**

Place a `Twin AI 분석 결과` panel beside the detail panel on desktop and in normal document flow on mobile. Show highest-risk device, score, evidence, actions, and live update status.

- [ ] **Step 2: Add natural-language question controls**

Add a labeled text input, submit button, example question chips, and `aria-live="polite"` result region. Support Enter to submit and keyboard focus styles.

- [ ] **Step 3: Add operation summary and full report actions**

Show 운행기록 AI 요약 and add a `전체 분석결과 생성` button that opens the full fleet report. Keep the existing selected forklift report button and make its contents dynamic.

- [ ] **Step 4: Add responsive CSS**

Use grid layout for desktop and one-column layout below 1100px. Ensure the question input, result text, evidence list, and report modal fit below 680px without horizontal overflow.

- [ ] **Step 5: Update rendered HTML assertions**

Assert presence of `Twin AI 분석 결과`, `현재 가장 위험한 장비는?`, `운행기록 AI 요약`, `전체 분석결과 생성`, and `AI 종합 의견`.

### Task 4: Verification and deployment

**Files:**
- Modify: `README.md` if needed to document local Twin AI behavior

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: build succeeds and rendered dashboard assertions pass.

- [ ] **Step 2: Run all focused tests**

Run: `node --test tests/ecu-source.test.mjs tests/diagnostic-evaluator.test.mjs tests/twin-ai-analyzer.test.mjs`

Expected: all ECU, diagnostic, and AI analyzer tests pass.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check` and `git status --short`.

Confirm only requested source, test, plan, and documentation files are included; leave existing tarballs and logs unstaged.

- [ ] **Step 4: Deploy the validated build**

Build the Sites archive from the validated commit and publish the existing Sites project. Confirm the deployment status is `succeeded` and return the production URL.
