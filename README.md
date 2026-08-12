# 포스코퓨처엠 지게차 모니터링 프로젝트

## 사이트

- 실시간 모니터링 사이트: https://posco-forklift-live.workspace-428183.chatgpt.site
- 기능: FORK-A~E 5대 운용, 호버 상태 표시, 클릭 상세 데이터, 실시간 시뮬레이션

## 폴더 구성

## ECU 데이터 모드

대시보드는 공통 `EcuDataSource` 인터페이스를 통해 더미 데이터와 실제 ECU 연동 Stub을 분리합니다. 기본 실행 모드는 `DUMMY`이며, 코드 수정 없이 환경변수만 바꿔 모드를 선택할 수 있습니다.

```env
VITE_RUN_MODE=DUMMY
ECU_POLL_INTERVAL_MS=1000
```

수집 항목은 배터리 잔량(%), 냉각수 온도(°C), 엔진오일 온도(°C), 진동 RMS(mm/s)입니다. `DUMMY` 모드는 직전 값 기반의 완만한 노이즈를 1초마다 생성합니다. `REAL` 모드는 `website/lib/ecu/real-source.ts`의 Stub에서 `REAL_ECU_NOT_CONNECTED`를 반환하며, 현장에서는 CAN/OBD 스캐너, MQTT, OPC-UA 또는 IoT 게이트웨이 로직을 해당 위치에 연결합니다.

- `upload/`: 원본 업로드 이미지·PPT
- `generated_images/`: 시연용 3D·모니터링 이미지
- `work/`: 수정 발표자료, PDF, 렌더링·검수 산출물
- `tmpauj77bq0/`: 중간 변환 산출물
