# ECU 실시간 모니터링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `RUN_MODE` 설정만 변경해 DUMMY ECU 데이터와 실제 ECU 연동 Stub을 교체하고, 네 가지 ECU 값을 1초 주기로 대시보드에 표시한다.

**Architecture:** `EcuDataSource` 공통 인터페이스 뒤에 `DummyEcuSource`와 `RealEcuSource`를 분리한다. Factory가 `DUMMY` 또는 `REAL` 모드를 선택하며, React 화면은 공급원에서 받은 스냅샷을 장비별로 갱신한다. 현재는 브라우저 시연을 위해 DUMMY를 기본값으로 사용하고 REAL은 현장 연동 지점이 명확한 Stub으로 둔다.

**Tech Stack:** React 19, TypeScript, Vite/Vinext, Vitest 또는 Node 내장 테스트, `.env.example` 설정.

## Global Constraints

- 데이터 항목은 배터리 잔량(%), 냉각수 온도(°C), 엔진오일 온도(°C), 진동 RMS(G 또는 mm/s)로 고정한다.
- 모드는 `RUN_MODE=DUMMY` 또는 `RUN_MODE=REAL`만 허용한다.
- DUMMY 데이터는 1초 주기로 갱신하고 직전 값 기반의 완만한 노이즈를 사용한다.
- REAL 모드는 실제 ECU 연결을 가장하지 않고 명확한 Stub 오류와 연동 주석을 제공한다.
- 화면은 기존 P-01호~P-05호 지게차와 실시간 이벤트·운행기록 UI를 유지한다.
- 실제 센서가 아닌 시연용 데이터라는 안내 문구를 유지한다.

### Task 1: ECU 데이터 계약과 설정 정의

**Files:**
- Create: `website/lib/ecu/types.ts`
- Create: `website/lib/ecu/config.ts`
- Create: `website/.env.example`
- Test: `website/tests/ecu-source.test.mjs`

**Interfaces:**
- `EcuSnapshot`: `{ forkliftId, timestamp, battery, coolantTemperature, engineOilTemperature, vibrationRms, mode, connected }`.
- `EcuDataSource`: `read(forkliftId: string): Promise<EcuSnapshot>`.
- `getRunMode(): "DUMMY" | "REAL"`.

- [ ] **Step 1: Write failing contract tests**

```js
assert.deepEqual(Object.keys(await source.read("P-01호")).sort(), [
  "battery", "connected", "coolantTemperature", "engineOilTemperature",
  "forkliftId", "mode", "timestamp", "vibrationRms",
].sort());
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test tests/ecu-source.test.mjs`
Expected: FAIL because the ECU modules do not exist.

- [ ] **Step 3: Implement the shared types and mode parser**

Use `import.meta.env.VITE_RUN_MODE ?? process.env.RUN_MODE ?? "DUMMY"`; normalize uppercase and throw a clear error for any value other than `DUMMY` or `REAL`.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/ecu-source.test.mjs`
Expected: PASS for the type/config contract.

- [ ] **Step 5: Commit**

```bash
git add website/lib/ecu website/.env.example website/tests/ecu-source.test.mjs
git commit -m "feat: define ECU data contract and run mode"
```

### Task 2: DUMMY와 REAL 데이터 공급원 구현

**Files:**
- Create: `website/lib/ecu/dummy-source.ts`
- Create: `website/lib/ecu/real-source.ts`
- Create: `website/lib/ecu/factory.ts`
- Modify: `website/tests/ecu-source.test.mjs`

**Interfaces:**
- `DummyEcuSource.read(forkliftId)` returns a valid `EcuSnapshot` and keeps per-device state.
- `RealEcuSource.read(forkliftId)` throws `REAL_ECU_NOT_CONNECTED` with comments for CAN/MQTT/OPC-UA integration.
- `createEcuDataSource()` returns the source selected by `getRunMode()`.

- [ ] **Step 1: Add failing behavior tests**

```js
const first = await dummy.read("P-01호");
const second = await dummy.read("P-01호");
assert.ok(Math.abs(second.coolantTemperature - first.coolantTemperature) < 8);
assert.equal(first.mode, "DUMMY");
await assert.rejects(() => real.read("P-01호"), /REAL_ECU_NOT_CONNECTED/);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/ecu-source.test.mjs`
Expected: FAIL because source classes and factory are missing.

- [ ] **Step 3: Implement the dummy source**

Seed each device with realistic baseline values. On each read, apply bounded random noise plus a small sine-wave drift, clamp values to safe display ranges, and update `timestamp` with an ISO timestamp.

- [ ] **Step 4: Implement the real stub and factory**

Keep hardware parsing out of the UI. Add comments showing where a scanner client, MQTT subscription, CAN decoder, or OPC-UA reader will be injected.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/ecu-source.test.mjs`
Expected: PASS.

```bash
git add website/lib/ecu website/tests/ecu-source.test.mjs
git commit -m "feat: add dummy and real ECU data sources"
```

### Task 3: Dashboard ECU 실시간 연결

**Files:**
- Modify: `website/app/page.tsx`
- Modify: `website/app/real-site-background.css`
- Modify: `website/tests/rendered-html.test.mjs`

**Interfaces:**
- The page owns one ECU source per render and polls the selected source every 1000ms.
- ECU snapshots merge into the matching forklift by `forkliftId`.

- [ ] **Step 1: Add rendered HTML assertions**

```js
assert.match(html, /냉각수 온도/);
assert.match(html, /엔진오일 온도/);
assert.match(html, /진동 RMS/);
assert.match(html, /ECU 데이터 모드/);
```

- [ ] **Step 2: Run the test and confirm the new assertion fails**

Run: `npm test`
Expected: FAIL only on the new ECU mode assertion.

- [ ] **Step 3: Replace local sensor drift with ECU polling**

Use a single `setInterval(..., 1000)` and `Promise.all` for the five forklift IDs. Preserve position movement, fixed driving-record rows, and live event generation. In REAL mode, show disconnected state instead of silently generating dummy values.

- [ ] **Step 4: Add ECU mode and connection badges**

Display `DUMMY 시연 모드` or `REAL 현장 연동 모드`, last received time, and `연결됨/연결 대기` beside the live data. Keep the Korean simulation disclaimer.

- [ ] **Step 5: Run full tests**

Run: `npm test`
Expected: build and rendered HTML tests PASS with no `NaN`.

- [ ] **Step 6: Commit**

```bash
git add website/app/page.tsx website/app/real-site-background.css website/tests/rendered-html.test.mjs
git commit -m "feat: stream ECU values into dashboard"
```

### Task 4: Local mode verification and deployment

**Files:**
- Modify: `website/.env.example`
- Modify: `README.md`

- [ ] **Step 1: Verify DUMMY mode**

Run with `VITE_RUN_MODE=DUMMY`; confirm all five devices render four ECU values and values change once per second.

- [ ] **Step 2: Verify REAL mode Stub**

Run with `VITE_RUN_MODE=REAL`; confirm the dashboard shows `REAL 현장 연동 모드` and an explicit connection-waiting status without crashing.

- [ ] **Step 3: Document field mapping**

Add a README section listing ECU field names, units, expected ranges, polling interval, and the exact future integration points for CAN/MQTT/OPC-UA.

- [ ] **Step 4: Run final validation**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit and publish**

```bash
git add website/.env.example README.md
git commit -m "docs: document ECU run modes and integration"
git push github HEAD:agent/posco-forklift-live
```

Then build and publish the validated Sites version using the existing project ID.
