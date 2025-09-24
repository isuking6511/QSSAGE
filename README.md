## Adminer를 이용한 Db관리 툴
### Postgrel 플러그인 사용하여 손쉽게 관리 가능
<img width="621" height="340" alt="image" src="https://github.com/user-attachments/assets/77685faa-a218-4257-934d-3f1ebc4672ce" />



## Postgix 보안 워크플로우
-1. 수집 (Data Collection)
	•	애플리케이션 로그
	•	FastAPI API 요청 로그, 관리자 라우트 접근 로그
	•	JWT/Token 인증 실패 로그
	•	DB 로그
	•	PostgreSQL 로그 + pgAudit 확장으로 SQL 이벤트 기록
	•	인프라 로그
	•	Docker / 컨테이너 로그
	•	시스템 리소스 메트릭 (CPU, RAM, Disk, 네트워크)

    도구: Promtail → Loki (로그), Prometheus (메트릭)


# ing~
