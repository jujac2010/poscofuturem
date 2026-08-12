import type { EcuDataSource, EcuSnapshot } from "./types";

export class RealEcuSource implements EcuDataSource {
  async read(_forkliftId: string): Promise<EcuSnapshot> {
    // 현장 구현 지점:
    // 1) CAN/OBD 스캐너 또는 IoT 게이트웨이에서 원시 ECU 프레임 수신
    // 2) MQTT, OPC-UA 또는 현장 API에서 장비별 메시지 구독
    // 3) 원시값을 배터리 %, °C, G 또는 mm/s 단위로 변환하고 유효성 검사
    throw new Error("REAL_ECU_NOT_CONNECTED");
  }
}
