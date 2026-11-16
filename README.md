# dodgefont

브라우저에서 폰트를 만들고, 스타일과 웨이트 위계를 입혀 macOS·Windows용 OTF 패밀리로 바로 내보내는 정적 웹앱.

- **엔진** — 아웃라인(베이스 폰트 변형) · 모듈러(그리드 스냅) · 픽셀(격자 에디터, 원/사각/다이아 모듈)
- **스타일** — 굵기, 폭, 기울기, 라운드, 자간, 모서리 + 이펙트(아웃라인/인라인/스텐실/섀도)
- **위계** — 웨이트 패밀리(Thin–Black, wght 클래스), 이탤릭 세트, 타입 스케일 역할(Display–Caption)
- **내보내기** — 맥용/윈도우용 ZIP(OTF + 설치 스크립트), 단일 OTF, 프로젝트 JSON

빌드 없음: `python3 -m http.server` 후 `index.html`. 확인: `node check.mjs`.
라이브러리: opentype.js, clipper-lib, JSZip (`vendor/`).
