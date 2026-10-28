# FlashCount — 아파트 화재 골든타임 예측 AI (웹 데모)

2026 AI 라이프 솔루션 챌린지 출품작 · 강준혁 (충북대학교 안전공학과)

방마다 달린 천장 온도 센서 값(최근 60초)만 보고
① 방별 피난 가능 시간 ② 플래시오버까지 남은 시간 ③ 불이 난 방을 실시간으로 예측합니다.

- `index.html` — ① 시나리오 보기(FDS 228건 결과) ② 실시간 AI 예측(브라우저 안에서 GRU 직접 계산) ③ 방법·성능·한계
- `gru.js` — 학습된 GRU(PyTorch)와 같은 식으로 계산하는 순수 자바스크립트 구현
- `data/plans.json` — 평면 2개 기하 · `data/cases.json` — 시뮬레이션 228건 결과와 방별 천장 온도 · `data/model.json` — 학습된 가중치
- 데이터 생성: NIST FDS 6.11.1 · 학습: PyTorch · 자세한 방법은 제출 기술문서 참고

서버 없이 정적 파일만으로 동작합니다(GitHub Pages).
로컬에서 보려면 이 폴더에서 `python -m http.server 8765` 를 실행하고 http://localhost:8765 를 엽니다.
