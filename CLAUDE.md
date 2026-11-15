# 3D 숙제·할 일 플래너 (아이들용 태블릿 웹앱)

두 아들이 **같은 태블릿 하나**(Neotab Z11 Plus, 안드로이드 크롬)로 쓰는 3D 플래너 세 개를 한 저장소에서 관리한다.
GitHub Pages로 배포: https://lprince98.github.io/3D_Scheduler_toSon/ (푸시 후 1~2분 뒤 반영)

| 폴더 | 앱 | 대상 | 핵심 규칙 |
|---|---|---|---|
| `index.html` | 앱 선택 첫 화면 | — | 세 앱 링크 |
| `monster/` | 몬스터 키우기 3D | 초5 형 | 미션 1개 = 성장 1번, 주간 달성률(기본 80%)을 넘는 즉시 진화 (알→1차→2차→최종), 완성하면 바로 새 몬스터 |
| `tank/` | 전차 조립 | 초5 형 | 순서대로 4호→T-34→M4(초급 다 하면 중급). 미션 1개 = 부품 1개, 과목 모듈이 맞으면 정품·아니면 회색. **누적 진행**(주차 없음): 단계 부품을 다 붙이면 다음 단계 → 부품 44개 뒤 마감 4칸 → 완성 검수 즉시 완성 연출 |
| `dinosaurus/` | 공룡 뼈 조립 | 만 4세 동생 (**한글 못 읽음**) | 할 일 1개 = 뼈 1개 (8조각) → 깨어남 → 아기 공룡이 할 일마다 자람(기본 4번) → 다 크면 다음 할 일에 공원으로 |

각 폴더의 `PRD-*.md`가 기획서(규칙·변경 이력의 기준), `README*.md`가 사용 설명이다. 기능을 바꾸면 **PRD 변경 이력 표에 한 줄**을 추가하고 버전을 올린다.

## 반드시 지킬 것

- **서비스워커 VERSION 올리기**: 앱 파일을 고치면 그 폴더의 `sw.js`의 `VERSION`을 올린다. 안 올리면 태블릿이 옛 파일을 계속 쓴다.
  현재: `monster3d-v17`, `tank-v4.11`, `dino3d-v1.3`. 세 앱 모두 network-first + `cache: 'no-cache'`.
- **저장 공간 분리**: 세 앱이 같은 사이트(origin)라 localStorage를 함께 쓴다. 키는 `monsterPlanner3D`, `tankPlanner`, `dinoPlanner`(+IndexedDB `dinoPlannerVoice`). "모든 데이터 지우기"는 **자기 키만** 지워야 한다.
- **공룡 아이 화면에는 글자 없음**: 그림·소리(음성 합성·부모 녹음)·손가락 안내만. 글자는 부모 모드에서만.
- **부모 기능은 비밀번호(6자리) 뒤에**: 세 앱 모두 부모 모드 PIN. 공룡은 왼쪽 위 자물쇠 버튼(길게 누르기 아님 — 태블릿에서 안 됐음).
- **성능 예산**: 30fps, 픽셀비율 최대 1.5, 실시간 그림자 없음(그림자 이미지), MeshToonMaterial. 공룡 모델은 마리당 삼각형 3,000 이하.
- **줄바꿈**: `monster/index.html`은 CRLF. 다른 파일은 LF. 줄바꿈을 통째로 바꾸지 말 것.
- **커밋 메시지**: 한국어. 제목 `앱: 무엇을 했는지`, 본문은 `- ` 목록. 예: `공룡: 자라기 단계 — 아기 공룡이 할 일마다 쑥쑥 자람`

## 앱별 구조

### monster/ (파일 하나)
- `index.html` 안에 Three.js r186 IIFE 묶음(`window.THREE`) + 앱 스크립트. 앱 코드는 두 번째 `<script>`부터.
- 데이터: `template`(매주 반복), `plans`(날짜별), `days[날짜].missions`(그날 미션, 지난 날도 남음), `monster`(파츠·성장·단계), `focus`(집중 타이머).
- 진화: `checkEvolution()` — 주(월~일) 단위, `weekRatio ≥ settings.evolveRate`가 되는 즉시 한 단계(주말 대기 없음). 미달 주는 지난 날 기간(7일)이 지나야 `checkedWeeks`에 확정. 주 확정은 `applyEvolution()`(새 모습으로 바뀔 때).
- 학생이 "오늘 할 것(detail)"을 적어야 시작 (`settings.studentDetail`, 끄면 부모 분량 사용). 완료 후 수정 불가.
- 홈 "📅 지난 날": 최근 7일, 못 끝낸 것을 부모 PIN으로 완료 처리 (2분간 PIN 재사용).

### tank/ (ES 모듈)
- `index.html` + `three.module.js`, `three.core.js`. 전차마다 부품 44개(`PZ4_PARTS`, `T34_PARTS`, `M4_PARTS`), 전차별 포탑 자리·포구·마킹은 `TANK_LAYOUT`, 단계 1~4, 마감 `FINISH_STEPS`.
- 해금은 순서대로(`tankOpen`, `nextTank`): 앞 전차를 완성하면 다음, 한 등급을 모두 완성하면 다음 등급. 부품을 추가·이동하면 포탑 360° 회전 중 겹침을 확인할 것.
- 단계는 `syncStage()`가 누적 진행으로 계산(다음 부품의 단계, 다 붙이면 4). 주간 판정 없음. 완성 검수 → `build.status = 'ceremony'` → `startCeremonySoon()`.
- 오늘 미션 `missions.items`, 지난 날 `history[날짜]`. 날짜 바뀜은 `ensureToday()`.
- 화면 위 빈 상자는 `pointer-events: none`이어야 캔버스 드래그 회전이 된다 (`#stage-area`, `.stage-hole`, `#cere-bottom`).
- 톡 치기: 조립 중엔 들썩+포탑 두리번, 최종 완성(완성 검수 통과 / 제원 카드 / 차고 목록의 완성 전차)이면 포탑이 보는 사람 쪽으로 조준 후 발사.

### dinosaurus/ (소스 → 빌드)
- **직접 `index.html`을 고치지 말 것.** 소스는 `dinosaurus/src/`:
  - `head.html`(CSS·DOM), `app.js`(앱 전체), `three_block.html`(Three.js 묶음, 건드리지 않음)
  - 빌드: `python dinosaurus/src/build.py` → `dinosaurus/index.html` 생성 (현재 저장소의 index.html과 동일하게 나오는 것 확인함)
- 공룡 6종 `DINOS = { trex, tricera, stego, brachio, ankylo, spino }`. 각 8조각, 조각마다 `bone()`/`skin()`. `head`·`tail` 조각 id는 필수(잠자기 표시·꼬리 흔들기). 새 공룡은 `DINO_NAME`, `DEFAULT_LOOK`, 필요하면 `KIND_FIT`(카메라 거리)에도 추가.
- 하루 할 일 최대 `MAX_PER_DAY = 5`. 카드 크기는 CSS 변수 `--n`으로 자동 축소.
- 자라기: `settings.growSteps`(기본 4, 0=끔), `dino.grow`. 예전에 저장된 깨어난 공룡(`grow` 없음)은 다 큰 것으로 처리.
- 부모 모드 탭: 할 일 / 지난 날 / 할 일 종류 / 달성 / 설정 / 테스트 / 데이터.
- 디버그 훅 `window.__dino` (테스트에서 사용).

## 테스트 (브라우저 자동화)

Playwright + 헤드리스 크로미움. WebGL은 소프트웨어 렌더링 옵션으로 돈다:

```js
chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
```

- 공룡: `python -m http.server 8765 -d dinosaurus` 후 `node dinosaurus/src/tests/tgrow.js` 등 (tflow: 마지막 뼈→깨어남→이름, tgrow: 자라기, tpick: 고르기 6장, tpast: 지난 날 탭, tnew: 새 공룡 렌더·삼각형 수, tbonus: 오늘 다 하면 보너스 뼈)
- 확인 화면 크기: 가로 1280×800, 세로 800×1280, 작은 화면 1024×600
- 펄스 애니메이션이 있는 버튼은 `click({ force: true })`
- 짧은 연출(불꽃 등)은 rAF 시간을 느리게 해서 캡처: `addInitScript`로 `requestAnimationFrame` 콜백의 시간에 0.25를 곱함

## 지금까지의 주요 결정 (2026-09-25 ~ 10-15)

- 세 앱: **오늘 다 하면 보너스** — 기준 시각(전차 23:00 / 몬스터 22:30 / 공룡 22:00, `settings.bonusMin` 분 단위) 전에 그날 미션을 다 하면 보상 1개 더(전차 부품 / 몬스터 성장 / 공룡 뼈·자라기), 하루 한 번, 지난 날 처리 제외. 부모 설정에서 켜기/끄기·시각 변경
- 공룡: 하루 최대 3→5개, 2차 공룡 3종 추가(브라키오·안킬로·스피노), 고르기 화면에 완성한 공룡 별 표시, 자라기 단계 추가(조각을 잘게 쪼개는 대신 — 만 4세가 작은 조각을 끌어다 놓기 어려움)
- 세 앱: 날짜가 바뀐 뒤에도 지난 날 미션을 보고 완료 처리 (몬스터·전차는 홈 버튼+부모 PIN, 공룡은 부모 모드 탭)
- 몬스터·전차: 세부사항은 학생이 직접 입력 (`PLAN-STUDENT-DETAIL.md`), "나중에 적기" 없음
- 세 앱 모두 화면에 "앱 선택" 버튼

## 남은 일·후보

- 공룡 후보: 파라사우롤로푸스, 프테라노돈
- 몬스터: 부모 모드에 "진화 연출 보기" 테스트 버튼 (제안만 함)
- 실기기 확인 목록: `dinosaurus/README-DINO.md` 끝 (아이 반응, 읽어주기, 발열 등). 새로 넣은 기능(아기 공룡 크기, 전차 발사 소리·진동)도 태블릿에서 아직 확인 전
