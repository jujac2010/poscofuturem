# 포스코퓨처엠 지게차 디지털 트윈 프로젝트 정리

> 작성일: 2026-08-14  
> 기준 브랜치: `agent/posco-forklift-live`  
> 기준 커밋: `18a8c26 chore: redeploy dashboard from website root`

## 1. 한 줄 요약

이 프로젝트는 포스코퓨처엠 현장의 지게차 5대(P-01호~P-05호)를 디지털 트윈 화면으로 표현하고, 위치·운행·ECU 센서값·진단·Twin AI 분석 흐름을 시연하는 웹 기반 운영 관제 프로토타입이다.

현재 구현의 중심은 `website/`이며, 실시간처럼 보이는 데이터는 브라우저 메모리에서 실행되는 시뮬레이션이다. 실제 ECU, MQTT, OPC-UA, MES 또는 운영 DB와 연결된 상태는 아니다.

## 2. 현재 상태 판정

| 영역 | 상태 | 확인 내용 |
|---|---|---|
| 대시보드 화면 | 구현 완료(시연용) | 5대 장비, 현장 배치도, 상태 카드, 상세 패널, 진단, 이벤트 로그, 운행기록을 한 화면에 구성 |
| 지게차 이동 | 구현 완료(시뮬레이션) | 장비별 제한 구역 안에서 무한 이동하며 충돌 간격을 고려해 새 목적지를 생성 |
| ECU 데이터 | DUMMY 구현 | 기본 모드가 `DUMMY`; 1초 주기로 더미 ECU 값을 폴링 |
| REAL ECU | 연결 지점만 존재 | `RealEcuSource`는 `REAL_ECU_NOT_CONNECTED` 오류를 반환하며 현장 연동은 미구현 |
| 진단 판정 | 구현 완료(규칙 기반) | 배터리·냉각수·엔진오일·진동 RMS 4개 값으로 점수/등급/권고 생성 |
| Twin AI | 구현 완료(결정론적 분석) | 장비 상태, 이상 원인, 운행기록, 전체 리포트 질의를 로컬 분석 함수로 처리; 외부 LLM 호출 없음 |
| 이상상황 시연 | 구현 완료 | 랜덤 이상상황 버튼으로 장비를 `점검` 상태로 바꾸고 온도·진동·위험도를 상승 |
| 테스트/빌드 | 통과 | `npm test`: 빌드 성공, 렌더링 테스트 1건 통과 |
| 실제 운영 준비 | 미완료 | 센서 연결, 서버 저장, 인증/권한, 운영 로그, 알림, 배포 검증이 남아 있음 |

## 3. 구현 화면에서 확인되는 기능

### 상단 운영 요약

- `POSCO FUTURE M / 현장 운영 관제` 브랜딩
- Digital Twin Control Room 제목
- LIVE 시각 표시
- 운용 장비 수, 정상 운행 수, 주의 관찰 수, 점검 필요 수 집계
- Twin AI 실시간 무한 운행 상태와 랜덤 이상상황 버튼

### 중앙 현장 배치도

- 원료 야드, 저장동, 출하장, 정비구역, 대기 충전 구역 표현
- 5대 지게차의 실제 이미지 기반 마커
- 상태별 색상: 정상/주의/점검
- 마커 선택 시 상세 정보 확인
- 장비별 이동 동선과 충돌 회피를 포함한 화면 내 애니메이션

### 지게차 상세 패널

- 현재 위치와 작업
- ECU 데이터 모드 및 최근 수신 시각
- 배터리 잔량
- 냉각수 온도
- 엔진오일 온도
- 진동 RMS
- 누적 운행 시간, 위험도, 정비 권고
- 최근 센서 추이 차트
- 상세 진단 리포트 모달

### 진단 및 기록 영역

- 실시간 상세 진단 리포트
- 진단 등급, 점수, 신뢰도, 우선순위
- 감지된 이상 징후와 정비 권고
- 전체 지게차 현황
- 이벤트 로그
- 실시간 운행기록 테이블
- Twin AI 질의 패널 및 전체 리포트 모달

## 4. 데이터 흐름

```text
브라우저 시작
  -> initialForklifts 5대 초기화
  -> DummyEcuSource가 1초마다 ECU 스냅샷 생성
  -> evaluateDiagnostic()가 센서값을 규칙 기반 진단으로 변환
  -> React 상태가 배치도/상세 패널/리포트/로그에 반영
  -> Twin AI analyzer가 현재 상태·진단·운행기록을 종합해 답변 생성
```

주요 상태는 `website/app/page.tsx`의 클라이언트 컴포넌트에 모여 있다. 따라서 현재 앱은 다중 사용자 서버 애플리케이션이라기보다, 발표·검증용 단일 브라우저 시뮬레이터에 가깝다.

## 5. 저장소 구조

```text
website/
  app/page.tsx                 화면과 시뮬레이션 상태의 중심
  app/twin-ai-components.tsx   Twin AI 패널 및 리포트 UI
  app/globals.css              전체 대시보드 스타일
  app/twin-scene.css           3D 현장 장면 스타일
  lib/ecu/                     ECU 데이터 소스 추상화
  lib/diagnostics/evaluator.ts 규칙 기반 진단 엔진
  lib/twin-ai/analyzer.ts      Twin AI 로컬 분석 함수
  public/                      지게차·현장 이미지와 정적 자원
  tests/                       빌드/렌더링/ECU/진단/Twin AI 테스트
  worker/index.ts              Sites/Worker 실행 진입점
  db/                          Drizzle/D1 확장용 기본 구조

docs/
  project-plan.html            초기 프로젝트 계획 화면
  superpowers/specs/           기능별 설계 문서
  superpowers/plans/           기능별 실행 계획

outputs/
  forklift-motion/             지게차 모션 영상·GIF·콘택트시트

노란사과_전체자료/
  노란사과/                    발표자료, 이미지, PPTX/PDF 작업 산출물
```

루트에 있는 여러 `*.tar.gz`와 `*.zip`은 과거 구현본/산출물 보관본이다. 재현 가능한 현재 소스의 기준은 압축본이 아니라 `website/`와 Git 커밋이다.

## 6. 기술 및 실행 정보

- 프론트엔드: React + TypeScript
- 실행 기반: vinext/Vite
- 기본 실행 모드: `VITE_RUN_MODE=DUMMY`
- Node 요구 버전: `>=22.13.0`
- 개발 서버: `npm run dev`
- 빌드: `npm run build`
- 테스트: `npm test`
- 린트: `npm run lint`
- DB 마이그레이션 기반: Drizzle/D1 골격만 존재

ECU 인터페이스는 `EcuDataSource`로 분리되어 있어 향후 실제 연동 시 `DummyEcuSource`를 `RealEcuSource`로 교체하는 방향은 잡혀 있다. 그러나 현재 `RealEcuSource` 내부에는 현장 프로토콜 처리 코드가 없으므로, 환경변수만 바꾼다고 실제 데이터가 연결되지는 않는다.

## 7. GitHub 및 브랜치 현황

현재 체크아웃 브랜치는 `agent/posco-forklift-live`이며 GitHub 원격은 `jujac2010/poscofuturem`이다. 최신 커밋 흐름은 다음과 같다.

1. `2c68bd9` — 운용 지게차를 5대로 고정
2. `3d46d70` — 5대 경로와 모션 시각 개선
3. `6d7bcd2` — 제한된 랜덤 실시간 경로 추가
4. `661b62c` — 무한 랜덤 주행 활성화
5. `194241d` — 차선 제한과 장비 겹침 방지
6. `c986d2b` — 지게차 방향 유지 및 구역 표지판 표시
7. `c17a9ed` — 최신 대시보드 배포 트리거
8. `18a8c26` — `website` 루트 기준 재배포

작업 트리에는 아직 추적되지 않은 파일이 많다. 특히 `.agents/`, `outputs/`, 여러 압축본, `website/dev-server*.log`, 설계/계획 문서가 커밋되지 않은 상태이므로, 다음 커밋 전에는 소스·문서·산출물·로그를 분리하는 것이 좋다.

## 8. 기존 문서와 산출물의 역할

| 문서/폴더 | 역할 |
|---|---|
| `README.md` | 프로젝트 소개, 배포 주소, ECU 모드 설명 |
| `docs/project-plan.html` | 초기 전체 프로젝트 로드맵과 발표자료 계획 |
| `docs/superpowers/specs/2026-08-11-ai-forklift-life-dashboard-design.md` | 초기 대시보드 설계 |
| `docs/superpowers/specs/2026-08-13-twin-ai-analysis-design.md` | Twin AI 분석 기능 설계 |
| `docs/superpowers/plans/2026-08-12-ecu-monitoring.md` | ECU 모니터링 실행 계획 |
| `docs/superpowers/plans/2026-08-13-twin-ai-analysis.md` | Twin AI 실행 계획 |
| `docs/superpowers/specs/2026-08-13-forklift-motion-video-design.md` | 지게차 모션 영상 설계 |
| `docs/superpowers/plans/2026-08-13-forklift-motion-video.md` | 지게차 모션 영상 실행 계획 |
| `outputs/forklift-motion/` | 모션 검토용 MP4/GIF/콘택트시트 |
| `노란사과_전체자료/` | 발표자료와 원본·중간·최종 산출물 |

## 9. 현재 프로젝트의 정확한 성격

현재 결과물은 “실제 공장 관제 시스템”이 아니라 “실제 운영 시스템으로 확장 가능한 시연 프로토타입”으로 표현하는 것이 정확하다.

구현되어 있는 것은 입력값이 들어왔을 때의 화면 흐름과 판단 흐름이다.

```text
센서값
  -> 상태 표시
  -> 이상 기준 판정
  -> 정비 권고
  -> Twin AI 설명
  -> 리포트/이벤트 기록
```

아직 구현되지 않은 것은 실제 현장 데이터의 취득·저장·보안·운영이다.

## 10. 다음 개발 우선순위

### 1순위: 실제 데이터 경계 확정

- 실제 ECU에서 받을 원시 데이터 항목과 단위 확정
- CAN/OBD, MQTT, OPC-UA, REST 중 1차 연동 방식 선택
- 장비 ID와 현장 자산 ID 매핑
- 센서값 유효성, 누락, 지연, 재연결 정책 정의

### 2순위: 서버 상태 계층 추가

- 브라우저 메모리 상태와 서버 수집 상태 분리
- 최근 스냅샷 및 이벤트 저장
- WebSocket/SSE 또는 주기적 API로 대시보드 갱신
- 운행기록·진단 결과 조회 API 추가

### 3순위: 운영 권한과 감사성

- 사용자 인증 및 역할별 권한
- 이상상황 확인/조치 이력
- 알림 채널과 담당자 배정
- 운영 로그와 데이터 보존 기간

### 4순위: 진단 신뢰도 고도화

- 현재 규칙 기반 점수를 기준선으로 유지
- 실제 고장 이력과 정상 운행 데이터를 별도 수집
- 모델 학습 여부를 규칙 기반 판정과 구분
- 오탐/미탐 평가 지표와 승인 절차 마련

## 11. 확인 및 주의 사항

- 화면의 `LIVE`, `Twin AI`, `ECU` 표시는 시연 흐름을 의미하며 실제 외부 데이터 연결을 보증하지 않는다.
- 진단의 `신뢰도`는 학습된 운영 모델의 통계적 신뢰도가 아니라, 현재 규칙/프로필 매칭을 바탕으로 계산한 시연용 값이다.
- `REAL` 모드는 연결 어댑터가 구현되지 않아 현재 사용할 수 없다.
- 루트 `README.md`와 일부 HTML 문서는 인코딩이 깨져 보일 수 있으므로, 배포용 문서로 사용할 때 UTF-8 재저장이 필요하다.
- 저장소에는 이전 구현 압축본과 작업 로그가 함께 있어 “현재 소스”와 “참고 산출물”을 구분해야 한다.

## 12. 이번 확인의 근거

- 소스: `website/app/page.tsx`, `website/app/twin-ai-components.tsx`
- 데이터/진단: `website/lib/ecu/*`, `website/lib/diagnostics/evaluator.ts`, `website/lib/twin-ai/analyzer.ts`
- 테스트: `website/tests/*`
- Git: 현재 브랜치·원격·최근 커밋·작업 트리 상태
- 실행 검증: 2026-08-14 `npm test` 성공
- 화면 검증 제한: 이 작업 환경에서 배포 URL 및 새 로컬 서버 포트에 직접 접속하지 못했으므로, 화면 기능 평가는 현재 소스와 렌더링 테스트를 기준으로 작성

