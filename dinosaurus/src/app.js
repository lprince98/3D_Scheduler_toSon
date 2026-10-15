(() => {
const THREE = window.THREE;

/* ==========================================================
   공룡 뼈 조립 — 0~5단계 (PRD-DINO.md 0.2, 8절)
   티라노 1종: 뼈대 ↔ 깨어난 상태, 대기 동작, 좌우 회전,
   바위 두드려 뼈 캐내기 → 끌어다 붙이기, 깨어남 연출, 음성 합성 테스트
   ========================================================== */

const KEY = 'dinoPlanner';          // 몬스터·전차와 완전 분리. 다른 키는 읽지도 쓰지도 않음
const TARGET_FPS = 30;
const TRI_BUDGET = 3000;
const TAP_LIMIT = 30;               // 하루 탭 반응 (임시값)
const AUTO_MS = 5000;               // 5초 동안 못 하면 자동 완료 (좌절 방지)
const PIECE_COUNT = 8;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const MAX_PER_DAY = 5;
const DINO_NAME = { trex: '티라노사우루스', tricera: '트리케라톱스', stego: '스테고사우루스', brachio: '브라키오사우루스', ankylo: '안킬로사우루스', spino: '스피노사우루스' };

/* ---------- 할 일 아이콘 (4.1절). 글자 모양 아이콘은 넣지 않음 ---------- */
const DEFAULT_SUBJECTS = [
  { id: 'brush',  name: '양치하기',     icon: 'brush',  color: '#4FA3E0', noTimer: true,  confirm: true  },
  { id: 'tidy',   name: '정리하기',     icon: 'tidy',   color: '#F0913F', noTimer: false, confirm: true  },
  { id: 'book',   name: '책 읽기',      icon: 'book',   color: '#E0655A', noTimer: false, confirm: false },
  { id: 'draw',   name: '그림 그리기',  icon: 'draw',   color: '#9B6FD6', noTimer: false, confirm: false },
  { id: 'line',   name: '선 긋기',      icon: 'line',   color: '#E2B21C', noTimer: false, confirm: false },
  { id: 'puzzle', name: '퍼즐 놀이',    icon: 'puzzle', color: '#2DB3A6', noTimer: false, confirm: false },
  { id: 'dress',  name: '혼자 옷 입기', icon: 'dress',  color: '#EF7FA8', noTimer: true,  confirm: false },
  { id: 'meal',   name: '밥 잘 먹기',   icon: 'meal',   color: '#D98A4A', noTimer: true,  confirm: false },
  { id: 'play',   name: '몸 놀이',      icon: 'play',   color: '#56B35C', noTimer: false, confirm: false },
  { id: 'etc',    name: '다른 할 일',   icon: 'etc',    color: '#E8B830', noTimer: false, confirm: false },
];

/* ---------- 저장 ----------
state = {
  version, settings, dino:{kind, placed, awake, pending, inPlay, giftGiven, color},
  subjects:[{id,name,icon,color,noTimer,confirm}],
  weekly:{0..6:[{sid}]}  (0=일요일) — 3단계 부모 모드에서 요일별 편집
  overrides:{'YYYY-MM-DD':[{sid}]}   — 날짜별 수정 (3단계)
  days:{'YYYY-MM-DD':{missions:[{id,sid,status:'todo'|'done',doneAt}], cheered}}
  park:[{kind, doneAt}]              — 완성한 공룡 (4단계 공룡 공원)
} */
function defaultState() {
  return {
    version: 1,
    settings: { quality: 'low', showStats: false, sound: true, voice: true, placeMode: 'drag', sleep: true, sleepMin: 3,
      defaultMin: 10, confirmMode: 'math', skipAwaken: false, growSteps: 4, pinHash: null, names: ['쿵쿵이', '초롱이', '방울이', '튼튼이', '콩콩이', '뿌뿌'] },
    dino: { kind: 'trex', placed: 0, awake: false, pending: 0, inPlay: false, giftGiven: false, color: null, name: '', look: null, chosen: false, doneAt: '', thumb: '' },
    focus: null,
    subjects: DEFAULT_SUBJECTS.map(s => ({ ...s })),
    weekly: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
    overrides: {},
    days: {},
    park: [],
    taps: { date: '', n: 0 },
    log: { rockSelf: 0, rockAuto: 0, placeSelf: 0, placeAuto: 0, streak: 0 },
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.dino) {
      const d = defaultState();
      if (s.dino.chosen === undefined) s.dino.chosen = s.dino.placed > 0 || !!s.dino.awake;   // 예전 저장: 이미 시작한 공룡은 고른 것으로
      return { ...d, ...s, version: 1, settings: { ...d.settings, ...s.settings }, dino: { ...d.dino, ...s.dino },
        weekly: { ...d.weekly, ...s.weekly }, taps: { ...d.taps, ...s.taps }, log: { ...d.log, ...s.log } };
    }
  } catch {}
  return defaultState();
}
let state = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
if (location.hash.includes('test')) document.body.classList.add('dev');

/* ---------- 렌더러 / 씬 ---------- */
const quality = state.settings.quality;
const SEG = quality === 'high' ? 0.85 : 0.7;   // 도형 분할 수 배율 (공룡 1마리 3,000 삼각형 이하)
const stageEl = $('stage'), sideEl = $('side');
const renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'low-power', alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1.0));
renderer.shadowMap.enabled = false;          // 실시간 그림자 없음
renderer.localClippingEnabled = true;        // 깨어날 때 피부가 아래에서 위로 차오르는 연출용
stageEl.appendChild(renderer.domElement);
const cv = renderer.domElement;

const SAND_BG = new THREE.Color('#F6E6C4'), SAND_GROUND = new THREE.Color('#E6CC98');
const GRASS_BG = new THREE.Color('#D9F0CF'), GRASS_GROUND = new THREE.Color('#9CD27C');
const scene = new THREE.Scene();
scene.background = SAND_BG.clone();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
scene.add(new THREE.HemisphereLight(0xffffff, 0xa89a80, 1.7));                     // 환경광
const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(3, 7, 5); scene.add(sun);   // 주광

const gradientMap = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter; gradientMap.needsUpdate = true;
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);   // y <= constant 부분만 보임
const toon = (color, clip = false) => {
  const m = new THREE.MeshToonMaterial({ color, gradientMap });
  if (clip) m.clippingPlanes = [clipPlane];
  return m;
};

// 바닥 + 배경 바위 (발굴 현장)
const groundMat = new THREE.MeshBasicMaterial({ color: SAND_GROUND.clone() });
const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 40), groundMat);
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const decoMat = toon('#CDB48A');
[[-4.2, -3.2, 0.55], [4.6, -3.2, 0.45], [-3.6, 2.2, 0.3], [3.8, 1.2, 0.25], [-6.5, -6, 0.7]].forEach(([x, z, s]) => {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), decoMat);
  m.position.set(x, s * 0.55, z); m.rotation.set(x, z, 0.3); scene.add(m);
});

// 둥근 그림자 이미지 한 장
function radialTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d'); const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const root = new THREE.Group(); scene.add(root);      // 사용자 회전
root.rotation.y = -0.45;
const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ map: radialTex('rgba(60,40,20,0.35)', 'rgba(60,40,20,0)'), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.set(-0.4, 0.01, 0); shadow.scale.set(3.2, 1.3, 1); root.add(shadow);
const rig = new THREE.Group(); root.add(rig);          // 점프·흔들기

/* ---------- 재질 ---------- */
const M = {
  skin: toon('#7ED36B', true), belly: toon('#FFE08A', true), spot: toon('#4FAE5C', true),
  jaw: toon('#A9E596', true), white: toon('#FFFFFF', true), black: toon('#2B2622', true), cheek: toon('#FFA3B5', true),
  plate: toon('#F2A65A', true), horn: toon('#FFF1C9', true),
  bone: toon('#F3E9D2'), boneDark: toon('#6E5A45'),
};
// 빈자리 실루엣: 반투명 대신 점무늬(alphaTest로 구멍) — 보급형 GPU에서 가벼움
const dotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 4);
  t.magFilter = THREE.NearestFilter; return t;
})();
const ghostMat = new THREE.MeshBasicMaterial({ color: '#B09470', alphaMap: dotTex, alphaTest: 0.5, side: THREE.DoubleSide });
const ghostNextMat = ghostMat.clone();

/* ---------- 기본 도형 도우미 (공룡 좌표로 적고, 조각 기준점 기준으로 붙임) ---------- */
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
let PV = V(0, 0, 0), CUR = null;
const seg = n => Math.max(3, Math.round(n * SEG));
function put(obj, pos) { obj.position.copy(pos).sub(PV); CUR.add(obj); return obj; }
function ell(mat, c, r, rot = [0, 0, 0], s = [12, 8]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg(s[0]), seg(s[1])), mat);
  m.scale.set(r[0], r[1], r[2]); m.rotation.set(rot[0], rot[1], rot[2]); return put(m, V(...c));
}
const ball = (mat, c, r, s = [8, 6]) => ell(mat, c, [r, r, r], [0, 0, 0], s);
function between(m, a, b) { m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize()); return put(m, a.clone().add(b).multiplyScalar(0.5)); }
function capsule(mat, a, b, r, radial = 8) {
  a = V(...a); b = V(...b);
  return between(new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, a.distanceTo(b)), 2, seg(radial)), mat), a, b);
}
function cyl(mat, a, b, ra, rb, radial = 8) {
  a = V(...a); b = V(...b);
  return between(new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, a.distanceTo(b), seg(radial), 1), mat), a, b);
}
function tube(mat, pts, r, n = 12) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => V(...p)));
  put(new THREE.Mesh(new THREE.TubeGeometry(curve, seg(n), r, 5, false), mat), V(0, 0, 0));
  return curve;
}
function rib(x, y, r) {
  const outer = new THREE.Group(); outer.rotation.y = Math.PI / 2;
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 4, seg(10), Math.PI), M.bone); t.rotation.x = Math.PI;
  outer.add(t); put(outer, V(x, y, 0));
}
let eyeSink = [];
function eye(c, side, r = 0.17) {
  const g = new THREE.Group(); put(g, V(...c));
  const pc = CUR, pp = PV; CUR = g; PV = V(...c); const k = r / 0.17;
  ball(M.white, c, r, [12, 9]);
  ball(M.black, [c[0] + 0.05 * k, c[1] + 0.01 * k, c[2] + side * 0.1 * k], 0.095 * k, [8, 6]);
  ball(M.white, [c[0] + 0.09 * k, c[1] + 0.06 * k, c[2] + side * 0.17 * k], 0.032 * k, [6, 4]);
  CUR = pc; PV = pp; eyeSink.push(g);
}
// 줄무늬: 몸통 단면(타원)을 따라 등 위로 걸친 반원 띠. 점무늬와 바꿔 가며 보임
function stripes(c, r, xs) {
  xs.forEach(x => {
    const f = Math.sqrt(Math.max(0, 1 - (x / r[0]) ** 2));
    const outer = new THREE.Group(); outer.rotation.y = Math.PI / 2; outer.scale.y = r[1] / r[2];
    const t = new THREE.Mesh(new THREE.TorusGeometry(r[2] * f + 0.012, 0.05, 4, seg(12), Math.PI), M.spot);
    t.userData.pat = 'stripes'; outer.add(t); put(outer, V(x, c[1], 0));
  });
}

/* ---------- 티라노사우루스: 8조각 (순서 = 붙이는 순서) ---------- */
const TREX = [
  { id: 'torso', pivot: [0, 1.5, 0],
    bone() {
      const c = tube(M.bone, [[-0.95, 1.95, 0], [-0.4, 2.08, 0], [0.2, 2.08, 0], [0.75, 1.98, 0]], 0.07);
      for (let i = 0; i <= 6; i++) { const p = c.getPoint(i / 6); ball(M.bone, [p.x, p.y + 0.06, 0], 0.085, [6, 4]); }
      [[-0.55, 0.46], [-0.25, 0.55], [0.05, 0.58], [0.35, 0.54], [0.62, 0.44]].forEach(([x, r]) => rib(x, 2.03, r));
    },
    skin() {
      ell(M.skin, [0, 1.5, 0], [1.05, 0.78, 0.64], [0, 0, 0.12], [14, 10]);
      [[-0.45, 2.1, 0.2], [0, 2.21, -0.2], [0.45, 2.19, 0.18], [-0.15, 2.15, 0.32]].forEach(p => ell(M.spot, p, [0.17, 0.07, 0.17], [0, 0, 0], [8, 5]));
      stripes([0, 1.5, 0], [1.05, 0.78, 0.64], [-0.55, -0.2, 0.15, 0.5]);
    } },
  { id: 'pelvis', pivot: [-0.6, 1.45, 0],
    bone() {
      ell(M.bone, [-0.62, 1.8, 0], [0.4, 0.17, 0.3], [0, 0, 0.15], [10, 6]);
      for (const s of [1, -1]) {
        ell(M.bone, [-0.52, 1.52, s * 0.3], [0.2, 0.26, 0.06], [0, 0, -0.2], [8, 6]);
        ball(M.bone, [-0.47, 1.3, s * 0.42], 0.1, [8, 6]);
      }
    },
    skin() { ell(M.skin, [-0.6, 1.42, 0], [0.64, 0.62, 0.6], [0, 0, 0], [12, 8]); } },
  ...[0.42, -0.42].map((z, i) => ({ id: i ? 'legB' : 'legA', pivot: [-0.45, 1.25, z],
    bone() {
      capsule(M.bone, [-0.47, 1.3, z], [-0.22, 0.72, z], 0.085, 6);
      ball(M.bone, [-0.22, 0.72, z], 0.11);
      capsule(M.bone, [-0.22, 0.72, z], [-0.42, 0.2, z], 0.075, 6);
      ball(M.bone, [-0.42, 0.18, z], 0.085);
      [-0.12, 0, 0.12].forEach(dz => capsule(M.bone, [-0.4, 0.1, z], [dz ? 0.02 : 0.08, 0.06, z + dz], 0.045, 5));
    },
    skin() {
      ell(M.skin, [-0.42, 1.02, z], [0.4, 0.55, 0.27], [0, 0, -0.35], [12, 8]);
      capsule(M.skin, [-0.25, 0.7, z], [-0.42, 0.22, z], 0.15, 8);
      ell(M.skin, [-0.25, 0.1, z], [0.34, 0.11, 0.2], [0, 0, 0], [10, 6]);
      [-0.1, 0, 0.1].forEach(dz => ball(M.white, [dz ? 0.06 : 0.09, 0.09, z + dz], 0.05, [6, 4]));
    } })),
  { id: 'arms', pivot: [0.72, 1.35, 0],
    bone() {
      for (const s of [1, -1]) {
        capsule(M.bone, [0.72, 1.38, s * 0.4], [0.95, 1.12, s * 0.44], 0.045, 5);
        [-0.03, 0.03].forEach(dz => capsule(M.bone, [0.96, 1.1, s * 0.44], [1.06, 1.02, s * 0.44 + dz], 0.025, 4));
      }
    },
    skin() {
      for (const s of [1, -1]) { capsule(M.skin, [0.72, 1.38, s * 0.42], [0.98, 1.12, s * 0.46], 0.085, 6); ball(M.skin, [1.0, 1.1, s * 0.46], 0.1); }
    } },
  { id: 'head', pivot: [0.75, 1.9, 0],
    bone() {
      capsule(M.bone, [0.72, 1.95, 0], [1.1, 2.3, 0], 0.055, 5);
      [[0.78, 2.02], [0.92, 2.14], [1.05, 2.26]].forEach(([x, y]) => ball(M.bone, [x, y, 0], 0.09, [6, 4]));
      ell(M.bone, [1.45, 2.47, 0], [0.56, 0.4, 0.38], [0, 0, 0.05], [12, 8]);
      ell(M.bone, [1.85, 2.4, 0], [0.36, 0.24, 0.3], [0, 0, -0.05], [10, 6]);
      for (const s of [1, -1]) {
        ell(M.boneDark, [1.58, 2.6, s * 0.31], [0.15, 0.15, 0.06], [0, 0, 0], [10, 6]);
        ball(M.boneDark, [2.18, 2.5, s * 0.1], 0.04, [6, 4]);
      }
    },
    skin() {
      capsule(M.skin, [0.7, 1.85, 0], [1.1, 2.28, 0], 0.3, 10);
      ell(M.skin, [1.45, 2.47, 0], [0.62, 0.46, 0.45], [0, 0, 0.05], [14, 10]);
      ell(M.skin, [1.88, 2.38, 0], [0.4, 0.3, 0.37], [0, 0, -0.05], [12, 8]);
      for (const s of [1, -1]) {
        ball(M.black, [2.22, 2.5, s * 0.12], 0.035, [6, 4]);
        ell(M.cheek, [1.8, 2.3, s * 0.34], [0.11, 0.07, 0.04], [0, 0, 0], [8, 5]);
        eye([1.58, 2.62, s * 0.32], s);
      }
    } },
  { id: 'jaw', pivot: [1.2, 2.16, 0],
    bone() {
      ell(M.bone, [1.66, 2.14, 0], [0.55, 0.08, 0.3], [0, 0, -0.06], [10, 6]);
      [[1.9, 0.16], [2.06, 0.1], [1.9, -0.16], [2.06, -0.1]].forEach(([x, z]) => cyl(M.bone, [x, 2.19, z], [x, 2.27, z], 0.035, 0.008, 5));
    },
    skin() { ell(M.jaw, [1.68, 2.13, 0], [0.58, 0.15, 0.34], [0, 0, -0.06], [12, 8]); } },
  { id: 'tail', pivot: [-0.95, 1.52, 0],
    bone() {
      const c = tube(M.bone, [[-0.95, 1.8, 0], [-1.65, 1.52, 0], [-2.3, 1.32, 0], [-2.82, 1.32, 0]], 0.04);
      for (let i = 0; i < 10; i++) { const p = c.getPoint(i / 9); ball(M.bone, [p.x, p.y, 0], 0.12 - i * 0.008, [6, 4]); }
    },
    skin() {
      const A = [-0.9, 1.52, 0], B = [-1.65, 1.36, 0], C = [-2.3, 1.22, 0], D = [-2.85, 1.3, 0];
      cyl(M.skin, A, B, 0.42, 0.3, 10); ball(M.skin, B, 0.3, [10, 6]);
      cyl(M.skin, B, C, 0.3, 0.18, 8); ball(M.skin, C, 0.18);
      cyl(M.skin, C, D, 0.18, 0.06, 8); ball(M.skin, D, 0.065, [6, 4]);
      ell(M.spot, [-1.5, 1.68, 0.1], [0.14, 0.06, 0.14], [0, 0, -0.2], [8, 5]);
      ell(M.spot, [-2.05, 1.48, -0.05], [0.11, 0.05, 0.11], [0, 0, -0.2], [8, 5]);
    } },
];

/* ---------- 트리케라톱스: 8조각 ---------- */
const TRICERA = [
  { id: 'torso', pivot: [0, 1.3, 0],
    bone() {
      const c = tube(M.bone, [[-1.0, 1.85, 0], [-0.4, 1.98, 0], [0.3, 1.95, 0], [0.95, 1.75, 0]], 0.07);
      for (let i = 0; i <= 6; i++) { const p = c.getPoint(i / 6); ball(M.bone, [p.x, p.y + 0.06, 0], 0.085, [6, 4]); }
      [[-0.55, 0.55], [-0.25, 0.6], [0.05, 0.62], [0.35, 0.58], [0.62, 0.5]].forEach(([x, r]) => rib(x, 1.93, r));
    },
    skin() {
      ell(M.skin, [0, 1.35, 0], [1.1, 0.72, 0.72], [0, 0, 0.05], [14, 10]);
      [[-0.45, 2.0, 0.22], [0.05, 2.05, -0.2], [0.5, 1.97, 0.25], [-0.1, 1.96, 0.33]].forEach(p => ell(M.spot, p, [0.17, 0.07, 0.17], [0, 0, 0], [8, 5]));
      stripes([0, 1.35, 0], [1.1, 0.72, 0.72], [-0.6, -0.2, 0.2, 0.6]);
    } },
  { id: 'pelvis', pivot: [-0.8, 1.35, 0],
    bone() {
      ell(M.bone, [-0.82, 1.75, 0], [0.38, 0.17, 0.32], [0, 0, 0.1], [10, 6]);
      for (const s of [1, -1]) { ell(M.bone, [-0.72, 1.5, s * 0.32], [0.2, 0.25, 0.06], [0, 0, -0.2], [8, 6]); ball(M.bone, [-0.72, 1.25, s * 0.45], 0.1); }
    },
    skin() { ell(M.skin, [-0.8, 1.38, 0], [0.6, 0.62, 0.66], [0, 0, 0], [12, 8]); } },
  { id: 'frontLegs', pivot: [0.65, 1.1, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        capsule(M.bone, [0.62, 1.2, z], [0.66, 0.65, z], 0.075, 6); ball(M.bone, [0.66, 0.65, z], 0.1);
        capsule(M.bone, [0.66, 0.65, z], [0.7, 0.18, z], 0.07, 6);
        [-0.1, 0, 0.1].forEach(dz => capsule(M.bone, [0.7, 0.1, z], [0.95, 0.06, z + dz], 0.04, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        capsule(M.skin, [0.62, 1.15, z], [0.7, 0.25, z], 0.2, 8);
        ell(M.skin, [0.75, 0.1, z], [0.26, 0.12, 0.22], [0, 0, 0], [10, 6]);
        [-0.09, 0, 0.09].forEach(dz => ball(M.white, [0.98, 0.09, z + dz], 0.045, [6, 4]));
      }
    } },
  { id: 'hindLegs', pivot: [-0.75, 1.1, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        capsule(M.bone, [-0.72, 1.25, z], [-0.58, 0.68, z], 0.085, 6); ball(M.bone, [-0.58, 0.68, z], 0.11);
        capsule(M.bone, [-0.58, 0.68, z], [-0.72, 0.18, z], 0.075, 6);
        [-0.1, 0, 0.1].forEach(dz => capsule(M.bone, [-0.7, 0.1, z], [-0.4, 0.06, z + dz], 0.04, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        ell(M.skin, [-0.72, 0.95, z], [0.36, 0.52, 0.26], [0, 0, -0.2], [12, 8]);
        capsule(M.skin, [-0.62, 0.6, z], [-0.74, 0.22, z], 0.18, 8);
        ell(M.skin, [-0.6, 0.1, z], [0.3, 0.12, 0.22], [0, 0, 0], [10, 6]);
        [-0.09, 0, 0.09].forEach(dz => ball(M.white, [-0.33, 0.09, z + dz], 0.045, [6, 4]));
      }
    } },
  { id: 'tail', pivot: [-1.1, 1.4, 0],
    bone() {
      const c = tube(M.bone, [[-1.05, 1.7, 0], [-1.75, 1.35, 0], [-2.35, 1.05, 0], [-2.8, 0.92, 0]], 0.04);
      for (let i = 0; i < 9; i++) { const p = c.getPoint(i / 8); ball(M.bone, [p.x, p.y, 0], 0.12 - i * 0.009, [6, 4]); }
    },
    skin() {
      const A = [-1.05, 1.4, 0], B = [-1.75, 1.18, 0], C = [-2.35, 0.98, 0], D = [-2.8, 0.9, 0];
      cyl(M.skin, A, B, 0.4, 0.28, 10); ball(M.skin, B, 0.28, [10, 6]);
      cyl(M.skin, B, C, 0.28, 0.16, 8); ball(M.skin, C, 0.16);
      cyl(M.skin, C, D, 0.16, 0.05, 8); ball(M.skin, D, 0.055, [6, 4]);
      ell(M.spot, [-1.6, 1.47, 0.08], [0.13, 0.06, 0.13], [0, 0, -0.3], [8, 5]);
    } },
  { id: 'head', pivot: [1.0, 1.55, 0],
    bone() {
      [[0.95, 1.62], [1.12, 1.56]].forEach(([x, y]) => ball(M.bone, [x, y, 0], 0.1, [6, 4]));
      ell(M.bone, [1.55, 1.45, 0], [0.5, 0.38, 0.38], [0, 0, -0.1], [12, 8]);
      ell(M.bone, [2.03, 1.3, 0], [0.28, 0.2, 0.22], [0, 0, -0.3], [10, 6]);
      for (const s of [1, -1]) { ell(M.boneDark, [1.62, 1.6, s * 0.32], [0.13, 0.13, 0.06], [0, 0, 0], [10, 6]); ball(M.boneDark, [2.22, 1.4, s * 0.09], 0.035, [6, 4]); }
    },
    skin() {
      ell(M.skin, [1.02, 1.5, 0], [0.35, 0.45, 0.45], [0, 0, 0], [10, 8]);
      ell(M.skin, [1.55, 1.45, 0], [0.55, 0.42, 0.42], [0, 0, -0.1], [14, 10]);
      ell(M.jaw, [2.05, 1.28, 0], [0.32, 0.24, 0.26], [0, 0, -0.3], [12, 8]);
      for (const s of [1, -1]) {
        ball(M.black, [2.28, 1.38, s * 0.1], 0.03, [6, 4]);
        ell(M.cheek, [1.85, 1.4, s * 0.31], [0.1, 0.06, 0.04], [0, 0, 0], [8, 5]);
        eye([1.62, 1.62, s * 0.34], s);
      }
    } },
  { id: 'frill', pivot: [1.0, 1.55, 0],
    bone() { frill(M.bone, 0.05, true); },
    skin() { frill(M.skin, 0.08, false); } },
  { id: 'horns', pivot: [1.0, 1.55, 0],
    bone() { horns(M.bone); },
    skin() { horns(M.horn); } },
];
function frill(mat, th, holes) {
  const a = 0.6, c = V(1.18, 2.05, 0), n = V(Math.cos(a), Math.sin(a), 0), v = V(-Math.sin(a), Math.cos(a), 0), u = V(0, 0, 1);
  const d = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, th, seg(18), 1), mat);
  d.rotation.z = -(Math.PI / 2 - a); put(d, c);
  if (holes) [-1, 1].forEach(s => ell(M.boneDark, c.clone().addScaledVector(u, s * 0.33).addScaledVector(v, 0.22).addScaledVector(n, 0.03).toArray(), [0.05, 0.13, 0.13], [0, 0, 0.6], [8, 6]));
  else for (let i = 0; i < 9; i++) { const f = -1.5 + i * 0.375; ball(M.plate, c.clone().addScaledVector(v, Math.cos(f) * 0.8).addScaledVector(u, Math.sin(f) * 0.8).toArray(), 0.1, [6, 5]); }
}
function horns(mat) {
  for (const s of [1, -1]) cyl(mat, [1.6, 1.82, s * 0.2], [2.05, 2.35, s * 0.26], 0.09, 0.015, 6);
  cyl(mat, [2.15, 1.5, 0], [2.3, 1.72, 0], 0.07, 0.012, 6);
}

/* ---------- 스테고사우루스: 8조각 ---------- */
const STEGO_TOP = { 0.75: 1.99, 0.45: 2.13, 0.15: 2.2, [-0.15]: 2.22, [-0.45]: 2.18, [-0.75]: 2.15, [-1.0]: 2.05 };
function plates(mat, list) {
  list.forEach(([x, h], i) => ell(mat, [x, STEGO_TOP[x] + h * 0.72, i % 2 ? 0.07 : -0.07], [h * 0.62, h, 0.05], [0, 0, 0.1], [10, 6]));
}
const STEGO = [
  { id: 'torso', pivot: [0, 1.4, 0],
    bone() {
      const c = tube(M.bone, [[-1.0, 1.95, 0], [-0.4, 2.12, 0], [0.3, 2.08, 0], [0.95, 1.72, 0]], 0.07);
      for (let i = 0; i <= 6; i++) { const p = c.getPoint(i / 6); ball(M.bone, [p.x, p.y + 0.06, 0], 0.085, [6, 4]); }
      [[-0.55, 0.55], [-0.25, 0.6], [0.05, 0.6], [0.35, 0.56], [0.62, 0.48]].forEach(([x, r]) => rib(x, 2.02, r));
    },
    skin() {
      ell(M.skin, [0, 1.42, 0], [1.15, 0.8, 0.7], [0, 0, -0.05], [14, 10]);
      [[-0.5, 2.05, 0.3], [0.05, 2.1, -0.32], [0.55, 1.98, 0.3], [-0.2, 2.08, -0.3]].forEach(p => ell(M.spot, p, [0.16, 0.07, 0.16], [0, 0, 0], [8, 5]));
      stripes([0, 1.42, 0], [1.15, 0.8, 0.7], [-0.65, -0.25, 0.15, 0.55]);
    } },
  { id: 'pelvis', pivot: [-0.7, 1.45, 0],
    bone() {
      ell(M.bone, [-0.72, 1.85, 0], [0.38, 0.17, 0.32], [0, 0, 0.1], [10, 6]);
      for (const s of [1, -1]) { ell(M.bone, [-0.62, 1.55, s * 0.32], [0.2, 0.26, 0.06], [0, 0, -0.2], [8, 6]); ball(M.bone, [-0.62, 1.28, s * 0.44], 0.1); }
    },
    skin() { ell(M.skin, [-0.7, 1.45, 0], [0.62, 0.7, 0.66], [0, 0, 0], [12, 8]); } },
  { id: 'frontLegs', pivot: [0.7, 1.0, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.42;
        capsule(M.bone, [0.68, 1.1, z], [0.7, 0.6, z], 0.07, 6); ball(M.bone, [0.7, 0.6, z], 0.09);
        capsule(M.bone, [0.7, 0.6, z], [0.74, 0.18, z], 0.065, 6);
        [-0.09, 0, 0.09].forEach(dz => capsule(M.bone, [0.74, 0.1, z], [0.98, 0.06, z + dz], 0.035, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.42;
        capsule(M.skin, [0.7, 1.05, z], [0.74, 0.22, z], 0.17, 8);
        ell(M.skin, [0.8, 0.1, z], [0.24, 0.11, 0.2], [0, 0, 0], [10, 6]);
        [-0.08, 0, 0.08].forEach(dz => ball(M.white, [1.0, 0.09, z + dz], 0.04, [6, 4]));
      }
    } },
  { id: 'hindLegs', pivot: [-0.65, 1.1, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.44;
        capsule(M.bone, [-0.62, 1.28, z], [-0.48, 0.68, z], 0.085, 6); ball(M.bone, [-0.48, 0.68, z], 0.11);
        capsule(M.bone, [-0.48, 0.68, z], [-0.64, 0.18, z], 0.075, 6);
        [-0.1, 0, 0.1].forEach(dz => capsule(M.bone, [-0.62, 0.1, z], [-0.32, 0.06, z + dz], 0.04, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.44;
        ell(M.skin, [-0.62, 0.98, z], [0.38, 0.55, 0.27], [0, 0, -0.15], [12, 8]);
        capsule(M.skin, [-0.55, 0.62, z], [-0.66, 0.22, z], 0.19, 8);
        ell(M.skin, [-0.52, 0.1, z], [0.3, 0.12, 0.22], [0, 0, 0], [10, 6]);
        [-0.09, 0, 0.09].forEach(dz => ball(M.white, [-0.25, 0.09, z + dz], 0.045, [6, 4]));
      }
    } },
  { id: 'head', pivot: [0.95, 1.5, 0],
    bone() {
      tube(M.bone, [[0.9, 1.6, 0], [1.2, 1.45, 0], [1.55, 1.25, 0]], 0.05, 6);
      [[0.95, 1.58], [1.18, 1.46], [1.4, 1.34]].forEach(([x, y]) => ball(M.bone, [x, y, 0], 0.08, [6, 4]));
      ell(M.bone, [1.78, 1.18, 0], [0.32, 0.2, 0.22], [0, 0, -0.2], [10, 6]);
      for (const s of [1, -1]) ell(M.boneDark, [1.8, 1.26, s * 0.18], [0.09, 0.09, 0.05], [0, 0, 0], [8, 5]);
    },
    skin() {
      capsule(M.skin, [0.9, 1.55, 0], [1.5, 1.25, 0], 0.24, 10);
      ell(M.skin, [1.78, 1.18, 0], [0.36, 0.24, 0.26], [0, 0, -0.2], [12, 8]);
      ell(M.jaw, [1.95, 1.06, 0], [0.2, 0.08, 0.18], [0, 0, -0.2], [8, 6]);
      for (const s of [1, -1]) {
        ball(M.black, [2.1, 1.14, s * 0.08], 0.025, [6, 4]);
        ell(M.cheek, [1.9, 1.1, s * 0.2], [0.07, 0.045, 0.03], [0, 0, 0], [8, 5]);
        eye([1.8, 1.28, s * 0.2], s, 0.12);
      }
    } },
  { id: 'platesF', pivot: [0.35, 2.15, 0],
    bone() { plates(M.bone, [[0.75, 0.26], [0.45, 0.36], [0.15, 0.44]]); },
    skin() { plates(M.plate, [[0.75, 0.26], [0.45, 0.36], [0.15, 0.44]]); } },
  { id: 'platesB', pivot: [-0.55, 2.15, 0],
    bone() { plates(M.bone, [[-0.15, 0.48], [-0.45, 0.48], [-0.75, 0.4], [-1.0, 0.3]]); },
    skin() { plates(M.plate, [[-0.15, 0.48], [-0.45, 0.48], [-0.75, 0.4], [-1.0, 0.3]]); } },
  { id: 'tail', pivot: [-1.15, 1.5, 0],
    bone() {
      const c = tube(M.bone, [[-1.1, 1.8, 0], [-1.8, 1.42, 0], [-2.45, 1.12, 0], [-2.9, 1.04, 0]], 0.04);
      for (let i = 0; i < 9; i++) { const p = c.getPoint(i / 8); ball(M.bone, [p.x, p.y, 0], 0.12 - i * 0.009, [6, 4]); }
      tailSpikes(M.bone);
    },
    skin() {
      const A = [-1.1, 1.5, 0], B = [-1.8, 1.3, 0], C = [-2.45, 1.08, 0], D = [-2.9, 1.02, 0];
      cyl(M.skin, A, B, 0.42, 0.28, 10); ball(M.skin, B, 0.28, [10, 6]);
      cyl(M.skin, B, C, 0.28, 0.15, 8); ball(M.skin, C, 0.15);
      cyl(M.skin, C, D, 0.15, 0.05, 8); ball(M.skin, D, 0.055, [6, 4]);
      tailSpikes(M.horn);
    } },
];
function tailSpikes(mat) {
  for (const s of [1, -1]) {
    cyl(mat, [-2.5, 1.15, s * 0.08], [-2.68, 1.5, s * 0.42], 0.07, 0.012, 6);
    cyl(mat, [-2.78, 1.1, s * 0.05], [-2.98, 1.4, s * 0.36], 0.06, 0.012, 6);
  }
}

/* ---------- 브라키오사우루스: 8조각 (긴 목, 앞다리가 긴 네 발) ---------- */
const BRACHIO = [
  { id: 'torso', pivot: [0, 1.75, 0],
    bone() {
      const c = tube(M.bone, [[-1.0, 2.25, 0], [-0.4, 2.42, 0], [0.3, 2.46, 0], [0.95, 2.38, 0]], 0.07);
      for (let i = 0; i <= 6; i++) { const p = c.getPoint(i / 6); ball(M.bone, [p.x, p.y + 0.06, 0], 0.085, [6, 4]); }
      [[-0.55, 0.56], [-0.25, 0.62], [0.05, 0.64], [0.35, 0.62], [0.62, 0.54]].forEach(([x, r]) => rib(x, 2.38, r));
    },
    skin() {
      ell(M.skin, [0, 1.78, 0], [1.12, 0.78, 0.72], [0, 0, 0.08], [14, 10]);
      [[-0.45, 2.45, 0.22], [0.05, 2.55, -0.2], [0.5, 2.52, 0.24], [-0.1, 2.5, 0.34]].forEach(p => ell(M.spot, p, [0.17, 0.07, 0.17], [0, 0, 0], [8, 5]));
      stripes([0, 1.78, 0], [1.12, 0.78, 0.72], [-0.6, -0.2, 0.2, 0.6]);
    } },
  { id: 'pelvis', pivot: [-0.75, 1.75, 0],
    bone() {
      ell(M.bone, [-0.78, 2.15, 0], [0.38, 0.17, 0.32], [0, 0, 0.05], [10, 6]);
      for (const s of [1, -1]) { ell(M.bone, [-0.7, 1.86, s * 0.32], [0.2, 0.26, 0.06], [0, 0, -0.2], [8, 6]); ball(M.bone, [-0.72, 1.58, s * 0.45], 0.1); }
    },
    skin() { ell(M.skin, [-0.75, 1.72, 0], [0.6, 0.66, 0.66], [0, 0, 0], [12, 8]); } },
  { id: 'frontLegs', pivot: [0.65, 1.3, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        capsule(M.bone, [0.62, 1.6, z], [0.66, 0.88, z], 0.08, 6); ball(M.bone, [0.66, 0.88, z], 0.1);
        capsule(M.bone, [0.66, 0.88, z], [0.68, 0.18, z], 0.07, 6);
        [-0.1, 0, 0.1].forEach(dz => capsule(M.bone, [0.68, 0.1, z], [0.92, 0.06, z + dz], 0.04, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        capsule(M.skin, [0.62, 1.55, z], [0.68, 0.25, z], 0.21, 8);
        ell(M.skin, [0.72, 0.1, z], [0.27, 0.12, 0.24], [0, 0, 0], [10, 6]);
        [-0.09, 0, 0.09].forEach(dz => ball(M.white, [0.95, 0.09, z + dz], 0.045, [6, 4]));
      }
    } },
  { id: 'hindLegs', pivot: [-0.75, 1.2, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        capsule(M.bone, [-0.72, 1.58, z], [-0.62, 0.82, z], 0.085, 6); ball(M.bone, [-0.62, 0.82, z], 0.11);
        capsule(M.bone, [-0.62, 0.82, z], [-0.72, 0.18, z], 0.075, 6);
        [-0.1, 0, 0.1].forEach(dz => capsule(M.bone, [-0.7, 0.1, z], [-0.42, 0.06, z + dz], 0.04, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.45;
        ell(M.skin, [-0.72, 1.15, z], [0.38, 0.6, 0.28], [0, 0, -0.15], [12, 8]);
        capsule(M.skin, [-0.65, 0.75, z], [-0.72, 0.22, z], 0.2, 8);
        ell(M.skin, [-0.6, 0.1, z], [0.3, 0.12, 0.23], [0, 0, 0], [10, 6]);
        [-0.09, 0, 0.09].forEach(dz => ball(M.white, [-0.34, 0.09, z + dz], 0.045, [6, 4]));
      }
    } },
  { id: 'neck', pivot: [0.95, 2.2, 0],
    bone() {
      const c = tube(M.bone, [[0.9, 2.3, 0], [1.1, 2.47, 0], [1.32, 2.6, 0]], 0.05, 6);
      for (let i = 0; i <= 3; i++) { const p = c.getPoint(i / 3); ball(M.bone, [p.x, p.y, 0], 0.09, [6, 4]); }
    },
    skin() { capsule(M.skin, [0.85, 2.15, 0], [1.32, 2.6, 0], 0.3, 10); } },
  { id: 'neckTop', pivot: [1.32, 2.6, 0],
    bone() {
      const c = tube(M.bone, [[1.32, 2.6, 0], [1.5, 2.75, 0], [1.68, 2.86, 0]], 0.045, 6);
      for (let i = 0; i <= 3; i++) { const p = c.getPoint(i / 3); ball(M.bone, [p.x, p.y, 0], 0.075, [6, 4]); }
    },
    skin() {
      capsule(M.skin, [1.32, 2.6, 0], [1.7, 2.87, 0], 0.22, 10);
      ell(M.spot, [1.45, 2.78, 0.12], [0.08, 0.05, 0.08], [0, 0, 0.8], [6, 4]);
    } },
  { id: 'head', pivot: [1.72, 2.88, 0],
    bone() {
      ell(M.bone, [1.95, 2.9, 0], [0.32, 0.22, 0.24], [0, 0, 0], [10, 6]);
      ell(M.bone, [2.22, 2.83, 0], [0.2, 0.13, 0.17], [0, 0, -0.1], [8, 6]);
      ball(M.bone, [2.05, 3.07, 0], 0.09, [6, 4]);
      for (const s of [1, -1]) ell(M.boneDark, [1.96, 2.97, s * 0.2], [0.09, 0.09, 0.05], [0, 0, 0], [8, 5]);
    },
    skin() {
      ell(M.skin, [1.95, 2.9, 0], [0.36, 0.26, 0.28], [0, 0, 0], [12, 8]);
      ell(M.jaw, [2.22, 2.81, 0], [0.22, 0.14, 0.2], [0, 0, -0.1], [10, 6]);
      ell(M.skin, [2.05, 3.09, 0], [0.13, 0.09, 0.12], [0, 0, 0], [8, 5]);
      for (const s of [1, -1]) {
        ball(M.black, [2.4, 2.85, s * 0.08], 0.025, [6, 4]);
        ell(M.cheek, [2.17, 2.79, s * 0.2], [0.07, 0.045, 0.03], [0, 0, 0], [8, 5]);
        eye([1.96, 2.99, s * 0.22], s, 0.12);
      }
    } },
  { id: 'tail', pivot: [-1.1, 1.9, 0],
    bone() {
      const c = tube(M.bone, [[-1.05, 2.15, 0], [-1.75, 1.8, 0], [-2.35, 1.42, 0], [-2.85, 1.22, 0]], 0.04);
      for (let i = 0; i < 9; i++) { const p = c.getPoint(i / 8); ball(M.bone, [p.x, p.y, 0], 0.12 - i * 0.009, [6, 4]); }
    },
    skin() {
      const A = [-1.05, 1.85, 0], B = [-1.75, 1.6, 0], C = [-2.35, 1.32, 0], D = [-2.85, 1.17, 0];
      cyl(M.skin, A, B, 0.42, 0.28, 10); ball(M.skin, B, 0.28, [10, 6]);
      cyl(M.skin, B, C, 0.28, 0.16, 8); ball(M.skin, C, 0.16);
      cyl(M.skin, C, D, 0.16, 0.05, 8); ball(M.skin, D, 0.055, [6, 4]);
      ell(M.spot, [-1.6, 1.9, 0.08], [0.13, 0.06, 0.13], [0, 0, -0.4], [8, 5]);
    } },
];

/* ---------- 안킬로사우루스: 8조각 (낮고 넓은 몸, 등 갑옷, 꼬리 곤봉) ---------- */
const ANKY_BODY = { c: [0, 1.05, 0], r: [1.15, 0.6, 0.85] };
const ankyTop = (x, z) => ANKY_BODY.c[1] + ANKY_BODY.r[1] * Math.sqrt(Math.max(0, 1 - (x / ANKY_BODY.r[0]) ** 2 - (z / ANKY_BODY.r[2]) ** 2));
function ankyArmor(mat, spikeMat, xs) {
  for (const x of xs) for (const z of [-0.45, 0, 0.45]) {
    const y = ankyTop(x, z) - 0.03;
    cyl(mat, [x, y, z], [x, y + 0.2, z + z * 0.15], 0.12, 0.03, 6);
  }
  for (const x of xs) for (const s of [1, -1]) cyl(spikeMat, [x, 1.0, s * 0.78], [x - 0.05, 1.04, s * 1.08], 0.08, 0.012, 6);   // 옆구리 가시
}
const ANKYLO = [
  { id: 'torso', pivot: [0, 1.05, 0],
    bone() {
      const c = tube(M.bone, [[-1.0, 1.45, 0], [-0.4, 1.56, 0], [0.3, 1.56, 0], [0.95, 1.42, 0]], 0.07);
      for (let i = 0; i <= 6; i++) { const p = c.getPoint(i / 6); ball(M.bone, [p.x, p.y + 0.06, 0], 0.085, [6, 4]); }
      [[-0.55, 0.62], [-0.25, 0.7], [0.05, 0.72], [0.35, 0.68], [0.62, 0.58]].forEach(([x, r]) => rib(x, 1.5, r));
    },
    skin() {
      ell(M.skin, ANKY_BODY.c, ANKY_BODY.r, [0, 0, 0], [14, 10]);
      [[-0.6, 1.45, 0.62], [0.2, 1.48, -0.66], [0.65, 1.38, 0.6], [-0.2, 1.4, -0.7]].forEach(p => ell(M.spot, p, [0.14, 0.06, 0.14], [0, 0, 0], [8, 5]));
      stripes(ANKY_BODY.c, ANKY_BODY.r, [-0.7, -0.35, 0.3, 0.7]);
    } },
  { id: 'pelvis', pivot: [-0.75, 1.05, 0],
    bone() {
      ell(M.bone, [-0.78, 1.42, 0], [0.38, 0.15, 0.38], [0, 0, 0.05], [10, 6]);
      for (const s of [1, -1]) { ell(M.bone, [-0.7, 1.15, s * 0.38], [0.2, 0.22, 0.06], [0, 0, -0.2], [8, 6]); ball(M.bone, [-0.72, 0.92, s * 0.58], 0.1); }
    },
    skin() { ell(M.skin, [-0.75, 1.0, 0], [0.55, 0.5, 0.78], [0, 0, 0], [12, 8]); } },
  { id: 'frontLegs', pivot: [0.65, 0.7, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.6;
        capsule(M.bone, [0.62, 0.88, z], [0.66, 0.48, z], 0.07, 6); ball(M.bone, [0.66, 0.48, z], 0.09);
        capsule(M.bone, [0.66, 0.48, z], [0.68, 0.16, z], 0.065, 6);
        [-0.09, 0, 0.09].forEach(dz => capsule(M.bone, [0.68, 0.09, z], [0.9, 0.06, z + dz], 0.035, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.6;
        capsule(M.skin, [0.62, 0.85, z], [0.68, 0.2, z], 0.18, 8);
        ell(M.skin, [0.72, 0.09, z], [0.24, 0.1, 0.2], [0, 0, 0], [10, 6]);
        [-0.08, 0, 0.08].forEach(dz => ball(M.white, [0.93, 0.08, z + dz], 0.04, [6, 4]));
      }
    } },
  { id: 'hindLegs', pivot: [-0.75, 0.75, 0],
    bone() {
      for (const s of [1, -1]) {
        const z = s * 0.6;
        capsule(M.bone, [-0.72, 0.95, z], [-0.62, 0.5, z], 0.08, 6); ball(M.bone, [-0.62, 0.5, z], 0.1);
        capsule(M.bone, [-0.62, 0.5, z], [-0.72, 0.16, z], 0.07, 6);
        [-0.09, 0, 0.09].forEach(dz => capsule(M.bone, [-0.7, 0.09, z], [-0.45, 0.06, z + dz], 0.035, 5));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        const z = s * 0.6;
        ell(M.skin, [-0.72, 0.7, z], [0.32, 0.4, 0.24], [0, 0, -0.15], [12, 8]);
        capsule(M.skin, [-0.66, 0.5, z], [-0.72, 0.2, z], 0.18, 8);
        ell(M.skin, [-0.62, 0.09, z], [0.27, 0.1, 0.2], [0, 0, 0], [10, 6]);
        [-0.08, 0, 0.08].forEach(dz => ball(M.white, [-0.38, 0.08, z + dz], 0.04, [6, 4]));
      }
    } },
  { id: 'armorF', pivot: [0.45, 1.55, 0],
    bone() { ankyArmor(M.bone, M.bone, [0.75, 0.4, 0.05]); },
    skin() { ankyArmor(M.plate, M.horn, [0.75, 0.4, 0.05]); } },
  { id: 'armorB', pivot: [-0.55, 1.55, 0],
    bone() { ankyArmor(M.bone, M.bone, [-0.3, -0.65, -0.95]); },
    skin() { ankyArmor(M.plate, M.horn, [-0.3, -0.65, -0.95]); } },
  { id: 'head', pivot: [1.0, 1.1, 0],
    bone() {
      [[0.95, 1.2], [1.1, 1.16]].forEach(([x, y]) => ball(M.bone, [x, y, 0], 0.1, [6, 4]));
      ell(M.bone, [1.45, 1.1, 0], [0.36, 0.26, 0.36], [0, 0, -0.05], [10, 8]);
      ell(M.bone, [1.78, 1.0, 0], [0.2, 0.15, 0.24], [0, 0, -0.1], [8, 6]);
      for (const s of [1, -1]) { cyl(M.bone, [1.3, 1.25, s * 0.28], [1.16, 1.36, s * 0.44], 0.07, 0.012, 5); ell(M.boneDark, [1.52, 1.2, s * 0.3], [0.09, 0.09, 0.05], [0, 0, 0], [8, 5]); }
    },
    skin() {
      ell(M.skin, [1.02, 1.12, 0], [0.32, 0.36, 0.42], [0, 0, 0], [10, 8]);
      ell(M.skin, [1.45, 1.1, 0], [0.42, 0.32, 0.42], [0, 0, -0.05], [12, 8]);
      ell(M.jaw, [1.8, 0.98, 0], [0.22, 0.16, 0.28], [0, 0, -0.1], [10, 6]);
      for (const s of [1, -1]) {
        cyl(M.horn, [1.3, 1.27, s * 0.3], [1.16, 1.38, s * 0.46], 0.08, 0.012, 6);
        ball(M.black, [1.99, 1.02, s * 0.1], 0.028, [6, 4]);
        ell(M.cheek, [1.75, 0.98, s * 0.27], [0.08, 0.05, 0.03], [0, 0, 0], [8, 5]);
        eye([1.54, 1.22, s * 0.33], s, 0.13);
      }
    } },
  { id: 'tail', pivot: [-1.1, 1.0, 0],
    bone() {
      const c = tube(M.bone, [[-1.05, 1.3, 0], [-1.7, 1.1, 0], [-2.3, 0.95, 0], [-2.62, 0.92, 0]], 0.04);
      for (let i = 0; i < 8; i++) { const p = c.getPoint(i / 7); ball(M.bone, [p.x, p.y, 0], 0.11 - i * 0.008, [6, 4]); }
      ell(M.bone, [-2.8, 0.92, 0], [0.26, 0.18, 0.3], [0, 0, 0], [10, 6]);
    },
    skin() {
      const A = [-1.05, 1.0, 0], B = [-1.7, 0.95, 0], C = [-2.3, 0.9, 0], D = [-2.62, 0.9, 0];
      cyl(M.skin, A, B, 0.38, 0.24, 10); ball(M.skin, B, 0.24, [10, 6]);
      cyl(M.skin, B, C, 0.24, 0.12, 8); ball(M.skin, C, 0.12);
      cyl(M.skin, C, D, 0.12, 0.1, 8);
      ell(M.plate, [-2.8, 0.92, 0], [0.3, 0.22, 0.34], [0, 0, 0], [12, 8]);                // 꼬리 곤봉
      for (const s of [1, -1]) ball(M.plate, [-2.76, 0.92, s * 0.3], 0.15, [8, 6]);
    } },
];

/* ---------- 스피노사우루스: 8조각 (등 돛, 긴 주둥이) ---------- */
const SPINO_SAIL = [[-0.85, 0.45], [-0.55, 0.75], [-0.25, 0.95], [0.05, 1.0], [0.35, 0.88], [0.62, 0.6]];
const SPINO = [
  { id: 'torso', pivot: [0, 1.55, 0],
    bone() {
      const c = tube(M.bone, [[-0.95, 1.98, 0], [-0.4, 2.1, 0], [0.2, 2.1, 0], [0.75, 2.0, 0]], 0.07);
      for (let i = 0; i <= 6; i++) { const p = c.getPoint(i / 6); ball(M.bone, [p.x, p.y + 0.06, 0], 0.085, [6, 4]); }
      [[-0.55, 0.44], [-0.25, 0.52], [0.05, 0.55], [0.35, 0.52], [0.62, 0.42]].forEach(([x, r]) => rib(x, 2.05, r));
    },
    skin() {
      ell(M.skin, [0, 1.55, 0], [1.05, 0.74, 0.6], [0, 0, 0.1], [14, 10]);
      [[-0.45, 2.12, 0.22], [0.1, 2.2, -0.22], [0.5, 2.15, 0.2]].forEach(p => ell(M.spot, p, [0.15, 0.06, 0.15], [0, 0, 0], [8, 5]));
      stripes([0, 1.55, 0], [1.05, 0.74, 0.6], [-0.55, -0.2, 0.15, 0.5]);
    } },
  { id: 'pelvis', pivot: [-0.6, 1.45, 0],
    bone() {
      ell(M.bone, [-0.62, 1.8, 0], [0.4, 0.17, 0.3], [0, 0, 0.15], [10, 6]);
      for (const s of [1, -1]) { ell(M.bone, [-0.52, 1.52, s * 0.3], [0.2, 0.26, 0.06], [0, 0, -0.2], [8, 6]); ball(M.bone, [-0.47, 1.3, s * 0.42], 0.1, [8, 6]); }
    },
    skin() { ell(M.skin, [-0.6, 1.42, 0], [0.62, 0.6, 0.58], [0, 0, 0], [12, 8]); } },
  ...[0.4, -0.4].map((z, i) => ({ id: i ? 'legB' : 'legA', pivot: [-0.45, 1.25, z],
    bone() {
      capsule(M.bone, [-0.47, 1.3, z], [-0.25, 0.72, z], 0.085, 6); ball(M.bone, [-0.25, 0.72, z], 0.11);
      capsule(M.bone, [-0.25, 0.72, z], [-0.42, 0.2, z], 0.075, 6); ball(M.bone, [-0.42, 0.18, z], 0.085);
      [-0.12, 0, 0.12].forEach(dz => capsule(M.bone, [-0.4, 0.1, z], [dz ? 0.02 : 0.08, 0.06, z + dz], 0.045, 5));
    },
    skin() {
      ell(M.skin, [-0.42, 1.0, z], [0.38, 0.52, 0.26], [0, 0, -0.35], [12, 8]);
      capsule(M.skin, [-0.27, 0.7, z], [-0.42, 0.22, z], 0.15, 8);
      ell(M.skin, [-0.25, 0.1, z], [0.34, 0.11, 0.2], [0, 0, 0], [10, 6]);
      [-0.1, 0, 0.1].forEach(dz => ball(M.white, [dz ? 0.06 : 0.09, 0.09, z + dz], 0.05, [6, 4]));
    } })),
  { id: 'arms', pivot: [0.7, 1.35, 0],
    bone() {
      for (const s of [1, -1]) {
        capsule(M.bone, [0.7, 1.4, s * 0.38], [0.98, 1.08, s * 0.44], 0.05, 5);
        [-0.04, 0, 0.04].forEach(dz => capsule(M.bone, [1.0, 1.06, s * 0.44], [1.12, 0.96, s * 0.44 + dz], 0.025, 4));
      }
    },
    skin() {
      for (const s of [1, -1]) {
        capsule(M.skin, [0.7, 1.4, s * 0.4], [1.0, 1.08, s * 0.46], 0.095, 6); ball(M.skin, [1.02, 1.06, s * 0.46], 0.11);
        [-0.05, 0.05].forEach(dz => ball(M.white, [1.12, 0.98, s * 0.46 + dz], 0.035, [6, 4]));
      }
    } },
  { id: 'head', pivot: [0.75, 1.9, 0],
    bone() {
      capsule(M.bone, [0.72, 1.95, 0], [1.05, 2.25, 0], 0.055, 5);
      [[0.78, 2.02], [0.92, 2.14]].forEach(([x, y]) => ball(M.bone, [x, y, 0], 0.09, [6, 4]));
      ell(M.bone, [1.35, 2.36, 0], [0.34, 0.26, 0.28], [0, 0, 0], [10, 8]);
      ell(M.bone, [1.88, 2.24, 0], [0.55, 0.12, 0.16], [0, 0, -0.08], [10, 6]);
      ball(M.bone, [2.36, 2.22, 0], 0.1, [6, 4]);
      for (const s of [1, -1]) ell(M.boneDark, [1.4, 2.46, s * 0.22], [0.1, 0.1, 0.05], [0, 0, 0], [8, 5]);
    },
    skin() {
      capsule(M.skin, [0.7, 1.85, 0], [1.05, 2.25, 0], 0.28, 10);
      ell(M.skin, [1.35, 2.36, 0], [0.38, 0.3, 0.32], [0, 0, 0], [12, 8]);
      ell(M.jaw, [1.9, 2.22, 0], [0.58, 0.14, 0.19], [0, 0, -0.08], [12, 6]);
      ell(M.skin, [2.38, 2.22, 0], [0.13, 0.12, 0.17], [0, 0, 0], [8, 6]);
      ell(M.plate, [1.42, 2.62, 0], [0.16, 0.08, 0.05], [0, 0, 0.2], [8, 5]);                 // 머리 볏
      for (const s of [1, -1]) {
        ball(M.black, [2.44, 2.28, s * 0.07], 0.025, [6, 4]);
        ell(M.cheek, [1.62, 2.24, s * 0.24], [0.08, 0.05, 0.03], [0, 0, 0], [8, 5]);
        eye([1.4, 2.48, s * 0.25], s, 0.14);
      }
    } },
  { id: 'sail', pivot: [-0.1, 2.3, 0],
    bone() { SPINO_SAIL.forEach(([x, h]) => cyl(M.bone, [x, 2.05, 0], [x, 2.05 + h, 0], 0.035, 0.015, 5)); },
    skin() {
      ell(M.plate, [-0.1, 2.35, 0], [0.92, 0.72, 0.05], [0, 0, 0], [16, 8]);
      SPINO_SAIL.forEach(([x, h]) => cyl(M.spot, [x, 2.2, 0], [x, 2.05 + h * 0.95, 0], 0.06, 0.03, 5));
    } },
  { id: 'tail', pivot: [-0.95, 1.52, 0],
    bone() {
      const c = tube(M.bone, [[-0.95, 1.8, 0], [-1.65, 1.52, 0], [-2.3, 1.32, 0], [-2.85, 1.3, 0]], 0.04);
      for (let i = 0; i < 10; i++) { const p = c.getPoint(i / 9); ball(M.bone, [p.x, p.y, 0], 0.12 - i * 0.008, [6, 4]); }
    },
    skin() {
      const A = [-0.9, 1.52, 0], B = [-1.65, 1.36, 0], C = [-2.3, 1.22, 0], D = [-2.85, 1.28, 0];
      cyl(M.skin, A, B, 0.42, 0.3, 10); ball(M.skin, B, 0.3, [10, 6]);
      cyl(M.skin, B, C, 0.3, 0.18, 8); ball(M.skin, C, 0.18);
      cyl(M.skin, C, D, 0.18, 0.06, 8); ball(M.skin, D, 0.065, [6, 4]);
      ell(M.plate, [-2.2, 1.42, 0], [0.55, 0.2, 0.04], [0, 0, -0.15], [10, 6]);              // 노 같은 꼬리 지느러미
    } },
];

/* ---------- 공룡들을 미리 만들어 두고 지금 공룡만 보이게 ---------- */
const DINOS = { trex: TREX, tricera: TRICERA, stego: STEGO, brachio: BRACHIO, ankylo: ANKYLO, spino: SPINO };
const KINDS = Object.keys(DINOS);
const DEFAULT_LOOK = {
  trex: { body: '#7ED36B', spot: '#4FAE5C', pattern: 'dots' },
  tricera: { body: '#F0A35E', spot: '#C9703A', pattern: 'dots' },
  stego: { body: '#7FB8E8', spot: '#F2A65A', pattern: 'stripes' },
  brachio: { body: '#B79CE6', spot: '#8D6CCB', pattern: 'dots' },
  ankylo: { body: '#E9C45A', spot: '#B98A2E', pattern: 'dots' },
  spino: { body: '#5FC7BE', spot: '#F07C6A', pattern: 'stripes' },
};
const models = {};
for (const kind of KINDS) {
  const group = new THREE.Group(); group.visible = false; rig.add(group);
  eyeSink = [];
  const ps = DINOS[kind].map(def => {
    PV = V(...def.pivot);
    const holder = new THREE.Group(); holder.position.copy(PV); group.add(holder);
    const bone = new THREE.Group(); CUR = bone; def.bone();
    const skin = new THREE.Group(); CUR = skin; def.skin();
    skin.traverse(o => { if (o.isMesh && o.material === M.spot && !o.userData.pat) o.userData.pat = 'dots'; });
    const ghost = bone.clone(); ghost.traverse(o => { if (o.isMesh) o.material = ghostMat; });
    holder.add(bone, skin, ghost);
    bone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(bone);
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    return { id: def.id, holder, bone, skin, ghost, center, size: Math.max(size.x, size.y, size.z) };
  });
  models[kind] = { group, pieces: ps, eyes: eyeSink };
}
let pieces = null, eyes = null, curKind = null;
function useKind(kind) {
  if (!models[kind]) kind = 'trex';
  KINDS.forEach(k => { models[k].group.visible = k === kind; });
  curKind = kind; pieces = models[kind].pieces; eyes = models[kind].eyes;
}
const P = id => pieces.find(p => p.id === id);
const lookOf = d => ({ ...DEFAULT_LOOK[d.kind] || DEFAULT_LOOK.trex, ...(d.look || {}) });
const WHITE = new THREE.Color('#ffffff');
function applyLook(kind, look) {
  M.skin.color.set(look.body); M.jaw.color.set(look.body).lerp(WHITE, 0.35);
  M.spot.color.set(look.spot); M.plate.color.set(look.spot).lerp(WHITE, 0.12);
  models[kind].group.traverse(o => { if (o.userData.pat) o.visible = o.userData.pat === look.pattern; });
}
useKind(state.dino.kind);

/* ---------- 자라기: 깨어나면 아기 공룡 → 할 일마다 쑥 자라서 다 큰 공룡 ---------- */
const BABY = 0.6;                                             // 아기 크기 (다 큰 공룡 = 1)
const growSteps = () => state.settings.growSteps ?? 4;        // 0이면 자라기 없음 (예전처럼)
const growOf = d => d.grow ?? Infinity;                       // 자라기 전에 저장된 공룡은 다 큰 것으로
const sizeOf = d => { const n = growSteps(); return !d.awake || !n ? 1 : BABY + (1 - BABY) * Math.min(1, growOf(d) / n); };
let growAnim = null;                                          // { from, to, t, done }
const setSize = (sz, kind = curKind) => models[kind].group.scale.setScalar(sz);

function setGhostMat(p, mat) { p.ghost.traverse(o => { if (o.isMesh) o.material = mat; }); }
function applyVisibility() {
  useKind(state.dino.kind); applyLook(curKind, lookOf(state.dino));
  if (!growAnim && phase !== 'awaken') setSize(sizeOf(state.dino));
  const { placed, awake } = state.dino;
  pieces.forEach((p, i) => {
    p.bone.visible = !awake && i < placed;
    p.ghost.visible = !awake && i >= placed;
    p.skin.visible = awake;
    setGhostMat(p, i === placed ? ghostNextMat : ghostMat);
  });
  const bg = awake ? GRASS_BG : SAND_BG, gr = awake ? GRASS_GROUND : SAND_GROUND;
  scene.background.copy(bg); groundMat.color.copy(gr);
  document.body.classList.toggle('awake', awake);
  clipPlane.constant = 100;
  updateBar();
  if (fitKind !== null && fitKind !== curKind) resize();   // 공룡이 바뀌면 화면 맞춤도 다시
}

function visibleTris(o) {
  if (!o.visible) return 0;
  let n = o.isMesh ? (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 : 0;
  for (const c of o.children) n += visibleTris(c);
  return n;
}

/* ---------- 뼈 칸 (아래 막대) ---------- */
const BONE_PATH = 'M20.93 28 H43.07 A8 8 0 1 1 50 32 A8 8 0 1 1 43.07 36 H20.93 A8 8 0 1 1 14 32 A8 8 0 1 1 20.93 28 Z';
$('bar').innerHTML = Array.from({ length: PIECE_COUNT }, () =>
  `<div class="slot"><svg viewBox="0 0 64 64"><path d="${BONE_PATH}" transform="rotate(-35 32 32)"/></svg></div>`).join('');
const slotEls = [...document.querySelectorAll('.slot')];
$('bar').insertAdjacentHTML('beforeend', '<div class="grow" id="growRow"></div>');   // 깨어난 뒤: 작은 공룡 → 큰 공룡 칸
function updateBar(popIdx = -1, growPop = -1) {
  const { placed, awake } = state.dino;
  const n = growSteps(), showGrow = awake && n > 0, g = Math.min(growOf(state.dino), n);
  document.body.classList.toggle('growing', showGrow);
  if (showGrow) {
    const c = lookOf(state.dino).body;
    $('growRow').innerHTML = Array.from({ length: n }, (_, i) =>
      `<span class="gs${i < g ? ' on' : ''}${i === growPop ? ' pop' : ''}" style="--s:${(0.5 + 0.5 * (i + 1) / n).toFixed(2)}">${SVG.dino(i < g ? c : '#d9cbb0')}</span>`).join('');
  }
  slotEls.forEach((el, i) => {
    el.classList.toggle('on', awake || i < placed);
    el.classList.toggle('next', !awake && i === placed);
    if (i === popIdx) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  });
}

/* ---------- 효과음 (Web Audio, 외부 파일 없음) ---------- */
let ac = null;
function unlock() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
  if (ac.state === 'suspended') ac.resume();
}
document.addEventListener('pointerdown', unlock, { passive: true });
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(type, f0, f1, dur, vol = 0.2, delay = 0) {
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.01, vol, dur); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function noise(dur, vol, f0, f1, delay = 0) {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.005, vol, dur); s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + dur + 0.05);
}
function roar(small = false) {
  const t = ac.currentTime, dur = small ? 0.35 : 0.7;
  const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(), l = ac.createOscillator(), lg = ac.createGain();
  o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = small ? 1800 : 1300;
  const base = small ? 380 : 260;
  o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 2.1, t + dur * 0.2); o.frequency.linearRampToValueAtTime(base * 1.2, t + dur);
  l.frequency.value = 26; lg.gain.value = small ? 25 : 18; l.connect(lg).connect(o.frequency);
  env(g, t, 0.03, small ? 0.16 : 0.24, dur); o.connect(f).connect(g).connect(ac.destination);
  o.start(t); l.start(t); o.stop(t + dur + 0.1); l.stop(t + dur + 0.1);
}
function sfx(name) {
  if (!state.settings.sound || !ac) return;
  switch (name) {
    case 'appear': tone('sine', 300, 700, 0.18, 0.15); break;
    case 'knock': tone('sine', 190, 90, 0.12, 0.35); noise(0.08, 0.25, 1200, 500); break;
    case 'crack': noise(0.35, 0.4, 2500, 300); tone('triangle', 520, 1040, 0.15, 0.12, 0.05); break;
    case 'click': tone('square', 1300, 1250, 0.04, 0.12); tone('square', 1750, 1700, 0.05, 0.1, 0.07); break;
    case 'rattle': for (let i = 0; i < 3; i++) tone('square', 900 + Math.random() * 500, 800, 0.03, 0.06, i * 0.07); break;
    case 'sparkle': [660, 880, 1175, 1568].forEach((f, i) => tone('sine', f, f, 0.25, 0.1, i * 0.12)); break;
    case 'roar': roar(false); break;
    case 'roarSmall': roar(true); break;
    case 'snore': tone('sine', 220, 150, 0.6, 0.08); break;
    case 'chime': [784, 988, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.4, 0.14, i * 0.18)); break;
    case 'stamp': noise(0.08, 0.35, 900, 300); tone('sine', 160, 80, 0.15, 0.3); [1047, 1319].forEach((f, i) => tone('sine', f, f, 0.2, 0.1, 0.15 + i * 0.1)); break;
  }
}
const buzz = ms => { try { navigator.vibrate?.(ms); } catch {} };

/* ---------- 읽어주기 (음성 합성) ---------- */
const hasTTS = 'speechSynthesis' in window;
let koVoice = null, voiceInfo = { all: 0, ko: [] };
function pickVoice() {
  if (!hasTTS) return;
  const vs = speechSynthesis.getVoices(), ko = vs.filter(v => /^ko/i.test(v.lang));
  koVoice = ko.find(v => v.localService) || ko[0] || null;
  voiceInfo = { all: vs.length, ko };
}
if (hasTTS) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, cb) {
  if (!hasTTS) { cb?.('unsupported'); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR'; if (koVoice) u.voice = koVoice; u.rate = 0.95; u.pitch = 1.15;
  if (cb) { u.onstart = () => cb('start'); u.onerror = e => cb('error:' + (e.error || '?')); u.onend = () => cb('end'); }
  try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { cb?.('error:' + e.message); }
}
const guide = text => { if (state.settings.voice) say(text); };

/* ---------- 바위·파편·떠 있는 뼈 ---------- */
const ROCK_POS = V(1.45, 0.55, 2.2);
const rockMat = toon('#A58E74');
const rock = { mesh: new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), rockMat), taps: 0, squash: 0, pop: 0 };
rock.mesh.position.copy(ROCK_POS); rock.mesh.visible = false; scene.add(rock.mesh);
const rockShadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), shadow.material);
rockShadow.rotation.x = -Math.PI / 2; rockShadow.position.set(ROCK_POS.x, 0.012, ROCK_POS.z); rockShadow.visible = false; scene.add(rockShadow);
const frags = Array.from({ length: 10 }, () => {
  const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.14, 0), rockMat); m.visible = false; scene.add(m);
  return { m, v: V(0, 0, 0), life: 0 };
});
function burst(n, speed) {
  let k = 0;
  for (const f of frags) {
    if (f.life > 0 || k >= n) continue; k++;
    f.m.position.copy(ROCK_POS); f.m.visible = true; f.life = 0.9; f.m.scale.setScalar(0.6 + Math.random() * 0.8);
    const a = Math.random() * Math.PI * 2;
    f.v.set(Math.cos(a) * speed, 2 + Math.random() * 2.5, Math.sin(a) * speed);
  }
}

let phase = 'idle';          // idle | rock | bone | snap | awaken | view
let viewing = null;          // 공원에서 3D로 보는 중인 공룡
let decoOn = false;          // 꾸미기 중
let lastAct = 0;
const fl = { obj: null, piece: null, base: V(0, 0, 0), scale: 1, s: 0, dragging: false, self: false, snapT: 0, from: null, fromQ: null, fromS: 1, appearT: 0 };

function currentPiece() { return pieces[state.dino.placed]; }
const ROCK_GREY = new THREE.Color('#9A8A78');
function spawnRock(color) {
  if (phase !== 'idle' || state.dino.awake || state.dino.placed >= PIECE_COUNT) return false;
  if (color) state.dino.color = color;
  wake(); poke();
  phase = 'rock'; rock.taps = 0; rock.squash = 0; rock.pop = 0; bodyBusy();
  // 바위 색 = 할 일 아이콘 색
  rockMat.color.set(state.dino.color || '#A58E74').lerp(ROCK_GREY, 0.35);
  rock.mesh.visible = true; rockShadow.visible = true; rock.mesh.scale.setScalar(0.01);
  state.dino.inPlay = true; save();
  lastAct = performance.now(); sfx('appear'); guide('톡톡톡 두드려 봐!');
  handFor('tap-rock');
  return true;
}
function knock() {
  rock.taps++; rock.squash = 1; lastAct = performance.now(); sfx('knock'); burst(1, 1.2); buzz(15);
  rockMat.color.offsetHSL(0, 0, -0.06);
  hideHand();
  if (rock.taps >= 3) setTimeout(() => breakRock(true), 120);
}
function breakRock(self) {
  if (phase !== 'rock') return;
  state.log[self ? 'rockSelf' : 'rockAuto']++; save();
  rock.mesh.visible = false; rockShadow.visible = false; burst(8, 2.2); sfx('crack'); buzz(40);
  const p = currentPiece();
  const obj = p.bone.clone(); obj.visible = true; scene.add(obj);   // 아직 안 붙인 조각은 숨김 상태라 복제본은 다시 보이게
  fl.obj = obj; fl.piece = p; fl.scale = Math.min(1.25, 1.3 / p.size); fl.s = 0; fl.appearT = 0; fl.dragging = false;
  p.holder.getWorldQuaternion(obj.quaternion);
  fl.base.copy(ROCK_POS).add(V(0, 0.35, 0)); placeFloatCenterAt(fl.base, 0.01);
  phase = 'bone'; lastAct = performance.now();
  guide('뼈를 찾았어! 반짝이는 곳에 붙여 줘!');
  handFor(state.settings.placeMode === 'drag' ? 'drag' : 'tap-bone');
}
// 뼈의 "눈에 보이는 가운데"가 pos에 오도록 배치
function placeFloatCenterAt(pos, s) {
  fl.obj.scale.setScalar(s);
  const off = fl.piece.center.clone().multiplyScalar(s).applyQuaternion(fl.obj.quaternion);
  fl.obj.position.copy(pos).sub(off);
}
function floatCenterWorld() { return fl.piece.center.clone().multiplyScalar(fl.obj.scale.x).applyQuaternion(fl.obj.quaternion).add(fl.obj.position); }
function slotCenterWorld(p = currentPiece()) { return p.holder.localToWorld(p.center.clone()); }

function snap(self) {
  if (phase !== 'bone') return;
  phase = 'snap'; fl.self = self; fl.dragging = false; fl.snapT = 0;
  fl.from = fl.obj.position.clone(); fl.fromQ = fl.obj.quaternion.clone(); fl.fromS = fl.obj.scale.x;
  hideHand(true);
}
function place() {
  const p = fl.piece, i = state.dino.placed;
  scene.remove(fl.obj); fl.obj = null;
  state.dino.placed++; state.dino.inPlay = false;
  const L = state.log;
  if (fl.self) { L.placeSelf++; L.streak++; } else { L.placeAuto++; L.streak = 0; }
  save();
  p.bone.visible = true; p.ghost.visible = false;
  flash = 1; sfx('click'); buzz(30); updateBar(i);
  if (state.dino.placed < PIECE_COUNT) setGhostMat(pieces[state.dino.placed], ghostNextMat);
  phase = 'idle';
  poke();
  if (state.dino.placed >= PIECE_COUNT) setTimeout(startAwaken, 900);
  else if (state.dino.pending > 0) { state.dino.pending--; save(); setTimeout(() => spawnRock(), 800); }
  else { bodyBusy(); setTimeout(maybeCheer, 700); }
}
let flash = 0;

/* ---------- 손가락 안내 ---------- */
const handEl = $('hand');
const hand = { mode: null, at: Infinity, t: 0 };
function handFor(mode) { hand.mode = mode; hand.t = 0; hand.at = performance.now() + (state.log.streak >= 3 ? 2000 : 400); }
function hideHand(forGood = false) { handEl.classList.remove('on', 'tap'); hand.at = forGood ? Infinity : performance.now() + 2500; if (forGood) hand.mode = null; }
function updateHand(dt, now) {
  // 할 일 시작 안내: 한가할 때 30초마다 6초씩 첫 번째 ▶를 가리킴
  const idle = now - lastBusy, startBtn = phase === 'idle' && !decoOn && !sleeping && !doingOpen && !panelOpen() && document.querySelector('.card:not(.done) .go');
  if (startBtn && idle > 8000 && (idle - 8000) % 30000 < 6000) {
    const r = startBtn.getBoundingClientRect();
    handEl.classList.add('on', 'tap'); handEl.style.opacity = '1';
    handEl.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
    return;
  }
  const want = hand.mode && now >= hand.at && (phase === 'rock' || phase === 'bone') && !fl.dragging;
  if (!want) { handEl.classList.remove('on'); return; }
  handEl.classList.add('on');
  let x, y;
  if (hand.mode === 'tap-rock' || hand.mode === 'tap-bone') {
    handEl.classList.add('tap');
    ({ x, y } = toScreen(hand.mode === 'tap-rock' ? ROCK_POS : floatCenterWorld()));
  } else {
    handEl.classList.remove('tap');
    hand.t = (hand.t + dt) % 1.8;
    const a = toScreen(floatCenterWorld()), b = toScreen(slotCenterWorld());
    const k = ease(clamp((hand.t - 0.3) / 1.1, 0, 1));
    x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k;
    handEl.style.opacity = hand.t > 1.55 ? String(1 - (hand.t - 1.55) / 0.25) : '1';
  }
  handEl.style.transform = `translate(${x}px, ${y}px)`;
}

/* ---------- 좌표 변환 ---------- */
const _v = new THREE.Vector3();
let stageRect = { left: 0, top: 0 };   // 3D 영역의 화면상 위치 (가로: 왼쪽, 세로: 위쪽)
function toScreen(w) { _v.copy(w).project(camera); return { x: stageRect.left + (_v.x + 1) / 2 * stageEl.clientWidth, y: stageRect.top + (1 - _v.y) / 2 * stageEl.clientHeight }; }
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const hitR = () => Math.max(110, Math.min(stageEl.clientWidth, stageEl.clientHeight) * 0.13);
const raycaster = new THREE.Raycaster(), dragPlane = new THREE.Plane(), _n = new THREE.Vector3();
function pointerWorld(x, y, through) {
  const ndc = new THREE.Vector2((x - stageRect.left) / stageEl.clientWidth * 2 - 1, -((y - stageRect.top) / stageEl.clientHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  camera.getWorldDirection(_n).negate(); dragPlane.setFromNormalAndCoplanarPoint(_n, through);
  return raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
}
const LIFT = 55;   // 손가락에 가리지 않게 뼈를 손가락보다 조금 위에
function dragBoneTo(x, y) {
  const target = slotCenterWorld();
  const hit = pointerWorld(x, y - LIFT, target); if (!hit) return;
  const d = dist2d({ x, y: y - LIFT }, toScreen(target));
  const close = clamp(1 - d / (stageEl.clientWidth * 0.6), 0, 1);
  fl.piece.holder.getWorldQuaternion(fl.obj.quaternion);
  placeFloatCenterAt(hit, fl.scale + (1 - fl.scale) * close);
}

/* ---------- 터치: 첫 손가락만. 바위 두드리기 / 뼈 끌기 / 좌우 회전 / 공룡 탭 ---------- */
let userYaw = -0.45, spinVel = 0;
const ptr = { id: null, x0: 0, y0: 0, lastX: 0, lastT: 0, t0: 0, moved: false, mode: null };
cv.addEventListener('pointerdown', e => {
  if (ptr.id !== null) return;                                   // 두 번째 손가락·손바닥 무시
  unlock();
  Object.assign(ptr, { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: performance.now(), t0: performance.now(), moved: false, mode: 'rotate' });
  try { cv.setPointerCapture(e.pointerId); } catch {}
  const p = { x: e.clientX, y: e.clientY };
  if (phase === 'rock' && dist2d(p, toScreen(ROCK_POS)) < hitR()) { ptr.mode = 'rock'; knock(); return; }
  if (phase === 'bone' && dist2d(p, toScreen(floatCenterWorld())) < hitR() * 1.25) {
    ptr.mode = 'bone'; hideHand(); lastAct = performance.now();
    if (state.settings.placeMode === 'drag') { fl.dragging = true; dragBoneTo(e.clientX, e.clientY); }
    return;
  }
  spinVel = 0;
});
cv.addEventListener('pointermove', e => {
  if (e.pointerId !== ptr.id) return;
  if (Math.abs(e.clientX - ptr.x0) > 10 || Math.abs(e.clientY - ptr.y0) > 10) ptr.moved = true;
  if (ptr.mode === 'bone' && fl.dragging && phase === 'bone') { dragBoneTo(e.clientX, e.clientY); lastAct = performance.now(); return; }
  if (ptr.mode === 'rotate') {
    const now = performance.now(), dx = e.clientX - ptr.lastX;
    userYaw += dx * 0.011; spinVel = dx * 0.011 / Math.max(0.016, (now - ptr.lastT) / 1000) * 0.5;
    ptr.lastX = e.clientX; ptr.lastT = now;
  }
});
function release(e) {
  if (e.pointerId !== ptr.id) return;
  const mode = ptr.mode; ptr.id = null; ptr.mode = null;
  if (mode === 'bone' && phase === 'bone') {
    if (state.settings.placeMode === 'tap') { snap(true); return; }
    fl.dragging = false;
    const d = dist2d(toScreen(floatCenterWorld()), toScreen(slotCenterWorld()));
    if (d < stageEl.clientWidth / 4) snap(true);                 // 자석: 화면 폭의 1/4 안이면 착
    else { fl.base.copy(floatCenterWorld()); fl.scale = fl.obj.scale.x; lastAct = performance.now(); hideHand(); }
    return;
  }
  if (mode === 'rotate' && !ptr.moved && performance.now() - ptr.t0 < 350) tapDino();
}
cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

const anim = { jump: 0, jumps: 0, wobble: 0, blinkAt: 2, blink: 0, sleepy: 0, jaw: 0 };
let lastSnore = 0;
function tapDino() {
  if (phase === 'awaken') return;
  if (sleeping) { if (performance.now() - lastSnore > 2500) { lastSnore = performance.now(); sfx('snore'); } return; }   // 자는 중엔 반응 안 함
  const t = state.taps; if (t.date !== todayKey()) { t.date = todayKey(); t.n = 0; }
  if (t.n >= TAP_LIMIT) { if (state.dino.awake) { anim.sleepy = 2.5; sfx('snore'); } return; }
  t.n++; save();
  if (state.dino.awake || viewing) {
    anim.jump = 0.001; anim.jumps = 0; anim.jaw = 0.4; sfx('roarSmall');
    const nm = viewing ? viewing.name : state.dino.name;
    if (nm && t.n % 4 === 1) setTimeout(() => say(`나는 ${iya(nm)}!`), 350);
  }
  else { anim.wobble = 1; sfx('rattle'); }
}

/* ---------- 깨어남 연출 (약 6초) ---------- */
const pillarTex = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c);
})();
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 5, 20, 1, true),
  new THREE.MeshBasicMaterial({ color: '#FFF3B0', map: pillarTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide }));
pillar.position.set(-0.3, 2.5, 0); pillar.visible = false; root.add(pillar);
const aw = { t: 0 };
function startAwaken() {
  if (phase === 'awaken' || state.dino.awake) return;
  if (fl.obj) { scene.remove(fl.obj); fl.obj = null; } rock.mesh.visible = false; rockShadow.visible = false;
  phase = 'awaken'; aw.t = 0; aw.roared = false; aw.skinOn = false;
  hideHand(true);
  pieces.forEach(p => { p.bone.visible = true; p.ghost.visible = false; });
  pillar.visible = true; sfx('sparkle'); bodyBusy();
}
function updateAwaken(dt) {
  aw.t += dt * (state.settings.skipAwaken ? 2.5 : 1); const t = aw.t;
  pillar.material.opacity = t < 1 ? t * 0.45 : t < 3.2 ? 0.45 : Math.max(0, 0.45 - (t - 3.2) * 0.45);
  pillar.rotation.y += dt * 0.6;
  M.bone.emissive.setScalar(t < 1.2 ? t / 1.2 * 0.5 : Math.max(0, 0.5 - (t - 1.2)));
  if (t >= 1.2 && !aw.skinOn) { aw.skinOn = true; pieces.forEach(p => { p.skin.visible = true; }); }
  if (aw.skinOn) clipPlane.constant = t < 3.2 ? (t - 1.2) / 2 * 3.2 : 100;   // 피부가 아래→위
  if (growSteps()) setSize(1 - (1 - BABY) * clamp((t - 2.2) / 1.0, 0, 1));   // 빛 속에서 아기 공룡으로
  if (t >= 3.2) pieces.forEach(p => { p.bone.visible = false; });
  if (t >= 3.4 && t < 3.6) anim.blink = 0.15;
  const st = clamp((t - 3.7) / 0.6, 0, 1); rig.scale.y = 1 + Math.sin(st * Math.PI) * 0.08;   // 기지개
  if (t >= 4.3 && !aw.roared) { aw.roared = true; anim.jaw = 0.8; sfx('roar'); guide('공룡이 깨어났어!'); buzz(80); }
  if (t >= 4.9 && anim.jump === 0 && !aw.jumped) { aw.jumped = true; anim.jump = 0.001; anim.jumps = 1; }
  const k = clamp((t - 4.3) / 1.3, 0, 1);
  scene.background.copy(SAND_BG).lerp(GRASS_BG, k); groundMat.color.copy(SAND_GROUND).lerp(GRASS_GROUND, k);
  if (t >= 6.2) {
    pillar.visible = false; M.bone.emissive.setScalar(0); rig.scale.y = 1;
    state.dino.awake = true; state.dino.grow = 0; state.dino.inPlay = false; state.dino.doneAt = todayKey(); save();
    phase = 'idle'; aw.jumped = false; applyVisibility(); poke(); bodyBusy();
    setTimeout(openDeco, 1200);                      // 꾸미기 → 이름 → (오늘 다 했으면) 축하
  }
}

/* ---------- 매 프레임 ---------- */
let time = 0;
function update(dt, now) {
  time += dt;
  stepGrow(dt);
  if (!ptr.id || ptr.mode !== 'rotate') { userYaw += spinVel * dt; spinVel *= Math.pow(0.02, dt); }
  root.rotation.y = userYaw;

  // 다음 빈자리 반짝임
  const pulse = (Math.sin(time * (phase === 'bone' ? 7 : 3)) + 1) / 2;
  ghostNextMat.color.set('#B09470').lerp(new THREE.Color('#FFB300'), phase === 'bone' || phase === 'snap' ? 0.4 + pulse * 0.6 : pulse * 0.5);

  // 바위
  if (phase === 'rock') {
    rock.pop = Math.min(1, rock.pop + dt * 4);
    const pop = rock.pop < 1 ? 1 + Math.sin(rock.pop * Math.PI) * 0.25 : 1;
    rock.squash = Math.max(0, rock.squash - dt * 5);
    rock.mesh.scale.set(pop * (1 + rock.squash * 0.15), pop * (1 - rock.squash * 0.25), pop * (1 + rock.squash * 0.15));
    rock.mesh.rotation.y = Math.sin(time * 1.5) * 0.2 + rock.squash * 0.3; rock.mesh.rotation.z = Math.sin(time * 40) * 0.06 * rock.squash;
    if (now - lastAct > AUTO_MS) breakRock(false);
  }
  for (const f of frags) {
    if (f.life <= 0) continue;
    f.life -= dt; f.v.y -= 9 * dt; f.m.position.addScaledVector(f.v, dt); f.m.rotation.x += dt * 8; f.m.rotation.y += dt * 6;
    if (f.m.position.y < 0.05) { f.m.position.y = 0.05; f.v.multiplyScalar(0.4); f.v.y = Math.abs(f.v.y); }
    if (f.life <= 0) f.m.visible = false; else if (f.life < 0.3) f.m.scale.multiplyScalar(0.85);
  }

  // 떠 있는 뼈
  if (phase === 'bone' && fl.obj) {
    fl.appearT = Math.min(1, fl.appearT + dt * 3.5);
    if (!fl.dragging) {
      const a = fl.appearT, over = a < 1 ? 1 + Math.sin(a * Math.PI) * 0.3 : 1;
      fl.piece.holder.getWorldQuaternion(fl.obj.quaternion);
      placeFloatCenterAt(fl.base.clone().add(V(0, Math.sin(time * 3) * 0.06, 0)), fl.scale * a * over);
      if (now - lastAct > AUTO_MS) snap(false);
    }
  }
  if (phase === 'snap' && fl.obj) {
    fl.snapT += dt; const k = ease(clamp(fl.snapT / (fl.self ? 0.3 : 0.7), 0, 1));
    const tp = fl.piece.holder.getWorldPosition(new THREE.Vector3()), tq = fl.piece.holder.getWorldQuaternion(new THREE.Quaternion());
    const arc = fl.self ? 0 : Math.sin(k * Math.PI) * 0.8;                            // 자동은 포물선으로 날아감
    fl.obj.position.copy(fl.from).lerp(tp, k).add(V(0, arc, 0));
    fl.obj.quaternion.copy(fl.fromQ).slerp(tq, k);
    fl.obj.scale.setScalar(fl.fromS + (1 - fl.fromS) * k);
    if (k >= 1) place();
  }

  if (flash > 0) { flash = Math.max(0, flash - dt * 2.5); if (phase !== 'awaken') M.bone.emissive.setScalar(flash * 0.45); }
  if (phase === 'awaken') updateAwaken(dt);

  // 점프 / 흔들기 / 대기 동작
  let y = 0;
  if (anim.jump > 0) {
    anim.jump += dt / 0.45; y = Math.sin(Math.min(1, anim.jump) * Math.PI) * 0.45;
    if (anim.jump >= 1) { if (anim.jumps > 0) { anim.jumps--; anim.jump = 0.001; } else anim.jump = 0; }
  }
  anim.wobble = Math.max(0, anim.wobble - dt * 2.5);
  const awake = state.dino.awake;
  rig.position.y = y + (awake || viewing ? Math.abs(Math.sin(time * 2.2)) * 0.025 : 0);
  rig.rotation.z = awake || viewing ? Math.sin(time * 1.1) * 0.02 : Math.sin(time * 30) * 0.03 * anim.wobble;
  const live = awake || viewing;
  const tl = P('tail'); if (tl) tl.holder.rotation.y = live ? Math.sin(time * 2.2) * 0.22 : 0;
  const nod = live ? Math.sin(time * 1.3) * 0.04 : 0;
  ['head', 'frill', 'horns'].forEach(id => { const h = P(id); if (h) h.holder.rotation.z = nod; });
  anim.jaw = Math.max(0, anim.jaw - dt);
  const jw = P('jaw'); if (jw) jw.holder.rotation.z = -Math.sin(clamp(anim.jaw / 0.4, 0, 1) * Math.PI / 2) * 0.28 * (anim.jaw > 0 ? 1 : 0);

  // 눈 깜빡임 (3~5초마다), 졸림
  anim.blinkAt -= dt; if (anim.blinkAt <= 0) { anim.blink = 0.14; anim.blinkAt = 3 + Math.random() * 2; }
  anim.blink = Math.max(0, anim.blink - dt); anim.sleepy = Math.max(0, anim.sleepy - dt);
  const ey = sleeping ? 0.1 : anim.blink > 0 ? 0.12 : anim.sleepy > 0 ? 0.4 : 1;
  eyes.forEach(g => { g.scale.y = ey; });

  // 잠자기: 홈에서 할 일을 시작하지 않고 3분
  if (!sleeping && state.settings.sleep && phase === 'idle' && !doingOpen && !panelOpen() && now - lastBusy > state.settings.sleepMin * 60000) goSleep();
  if (sleeping) { const z = toScreen(slotCenterWorld(P('head'))); zzzEl.style.transform = `translate(${z.x + 30}px, ${z.y - 90}px)`; }

  updateHand(dt, now);
}

/* ---------- 크기 조정 ---------- */
const KIND_FIT = { base: { h: 5.3, w: 5.0 }, brachio: { h: 6.1, w: 5.5 } };
let fitKind = null;
function resize() {
  fitKind = curKind;
  const W = stageEl.clientWidth, H = stageEl.clientHeight; if (!W || !H) return;
  // 카드 영역을 뺀 빈 공간 가운데에 공룡이 오도록: 가상 화면을 카드만큼 넓혀 그 일부만 그림
  const sr = (decoOn ? $('deco') : sideEl).getBoundingClientRect(), portrait = matchMedia('(orientation: portrait)').matches;
  const offX = portrait ? 0 : Math.round(sr.width), offY = portrait ? Math.round(sr.height) : 0;
  const fw = W + offX, fh = H + offY, freeW = W - offX, freeH = H - offY;
  stageRect = { left: 0, top: 0 };
  renderer.setSize(W, H, false);
  camera.aspect = fw / fh;
  const fit = KIND_FIT[curKind] || KIND_FIT.base;          // 목이 긴 공룡은 조금 멀리서 (머리가 위쪽 버튼에 가리지 않게)
  const dist = Math.max(fit.h * fh / (0.63 * freeH), fit.w * fh / (0.63 * freeW));   // 높이·폭이 빈 공간에 들어오게
  camera.position.set(0, 2.3, dist); camera.lookAt(-0.1, 1.05, 0);
  camera.setViewOffset(fw, fh, offX, offY, W, H); camera.updateProjectionMatrix();
  const pb = $('parkBtn'); pb.style.right = `${offX + 16}px`; $('appsBtn').style.right = `${offX + 16 + 76 + 14}px`;
  const bar = $('bar'); bar.style.left = `${freeW / 2}px`; bar.style.bottom = `calc(${offY + 14}px + env(safe-area-inset-bottom))`;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 150));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

/* ---------- 30fps 루프 + 안 보이면 정지 ---------- */
let FRAME_MS = 1000 / TARGET_FPS;   // 잠잘 때는 초당 6장으로 낮춤
let running = false, rafId = 0, lastFrame = 0, fpsCount = 0, fpsTime = 0;
const startedAt = performance.now(), statsEl = $('stats');
function loop(now) {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  if (now - lastFrame < FRAME_MS - 1) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now;
  update(dt, now); renderer.render(scene, camera);
  fpsCount++;
  if (now - fpsTime > 1000) {
    const fps = Math.round(fpsCount * 1000 / (now - fpsTime)); fpsCount = 0; fpsTime = now;
    if (state.settings.showStats) {
      const el = (now - startedAt) / 1000, tris = Math.round(visibleTris(rig)), over = tris > TRI_BUDGET;
      statsEl.textContent = `${fps} fps (목표 ${TARGET_FPS}) · 켜둔 시간 ${Math.floor(el / 60)}:${pad(Math.floor(el) % 60)}\n` +
        `공룡 ${tris} 삼각형${over ? ' ⚠ 초과' : ''} / 화면 ${renderer.info.render.triangles} · 픽셀비 ${renderer.getPixelRatio().toFixed(2)}`;
      statsEl.classList.toggle('warn', fps < TARGET_FPS - 5 || (over && phase !== 'awaken'));
    }
  }
}
function start() { if (running) return; running = true; lastFrame = performance.now(); fpsTime = lastFrame; fpsCount = 0; rafId = requestAnimationFrame(loop); }
function stop() { running = false; cancelAnimationFrame(rafId); }
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else { if (!doingOpen) start(); ensureToday(); renderHome(); } });
window.addEventListener('pagehide', stop);

/* ==========================================================
   1단계: 할 일 · 홈 · 하는 중 화면 · 잠자기
   ========================================================== */

/* ---------- 그림 (SVG). 아이 화면에는 글자 없음 ---------- */
const OUT = 'stroke="#3b2f25" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
const ICON = {
  brush: c => `<svg viewBox="0 0 64 64"><g transform="rotate(-40 32 32)" ${OUT}><rect x="27" y="24" width="10" height="36" rx="5" fill="${c}"/><rect x="25" y="5" width="14" height="21" rx="5" fill="#fff"/><rect x="38" y="7" width="9" height="17" rx="2" fill="#BFE3FF"/></g><circle cx="16" cy="14" r="4" fill="#BFE3FF"/><circle cx="10" cy="24" r="3" fill="#BFE3FF"/></svg>`,
  tidy: c => `<svg viewBox="0 0 64 64"><circle cx="22" cy="22" r="9" fill="#FF6B6B" ${OUT}/><rect x="33" y="10" width="15" height="15" rx="2" fill="#6BC5FF" transform="rotate(12 40 17)" ${OUT}/><rect x="8" y="30" width="48" height="26" rx="4" fill="${c}" ${OUT}/><rect x="5" y="25" width="54" height="9" rx="3" fill="#fff" ${OUT}/></svg>`,
  book: c => `<svg viewBox="0 0 64 64"><path d="M5 16 V54 H59 V16 Z" fill="${c}" ${OUT}/><path d="M32 17 C24 12 15 12 9 14 V49 C15 47 24 47 32 51 Z" fill="#fff" ${OUT}/><path d="M32 17 C40 12 49 12 55 14 V49 C49 47 40 47 32 51 Z" fill="#fff" ${OUT}/><path d="M14 23 C19 22 24 22 28 24 M14 30 C19 29 24 29 28 31 M36 24 C40 22 45 22 50 23 M36 31 C40 29 45 29 50 30" fill="none" stroke="#c9b9a0" stroke-width="3" stroke-linecap="round"/></svg>`,
  draw: c => `<svg viewBox="0 0 64 64"><path d="M6 54 C14 44 20 58 28 50 S40 46 44 54" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/><g transform="rotate(40 36 28)" ${OUT}><rect x="29" y="16" width="16" height="34" rx="3" fill="${c}"/><rect x="29" y="28" width="16" height="10" fill="#fff"/><path d="M29 16 L37 3 L45 16 Z" fill="${c}"/></g></svg>`,
  line: c => `<svg viewBox="0 0 64 64"><path d="M5 50 q7 -12 14 0 t14 0 t14 0" fill="none" stroke="#3b82c4" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 9"/><g transform="rotate(35 40 26)" ${OUT}><rect x="34" y="4" width="12" height="34" rx="2" fill="${c}"/><rect x="34" y="4" width="12" height="7" rx="2" fill="#F59DB0"/><path d="M34 38 L40 51 L46 38 Z" fill="#F2D6A8"/><path d="M38.5 47 L40 51 L41.5 47 Z" fill="#3b2f25"/></g></svg>`,
  puzzle: c => `<svg viewBox="0 0 64 64"><path d="M12 22 H25 a7 7 0 1 1 14 0 H52 V33 a7 7 0 1 1 0 14 V54 H12 Z" fill="${c}" ${OUT}/></svg>`,
  dress: c => `<svg viewBox="0 0 64 64"><path d="M21 9 L9 16 L3 29 L14 34 L17 27 V57 H47 V27 L50 34 L61 29 L55 16 L43 9 C41 16 23 16 21 9 Z" fill="${c}" ${OUT}/><circle cx="32" cy="36" r="5" fill="#fff" ${OUT}/></svg>`,
  meal: c => `<svg viewBox="0 0 64 64"><g transform="rotate(30 50 20)" ${OUT}><ellipse cx="50" cy="10" rx="6" ry="8" fill="#ddd"/><rect x="48" y="17" width="4" height="20" rx="2" fill="#ddd"/></g><ellipse cx="30" cy="32" rx="22" ry="7" fill="#fff" ${OUT}/><circle cx="22" cy="29" r="4" fill="#fff" ${OUT}/><circle cx="30" cy="27" r="4" fill="#fff" ${OUT}/><circle cx="38" cy="29" r="4" fill="#fff" ${OUT}/><path d="M6 33 H54 C54 47 44 56 30 56 C16 56 6 47 6 33 Z" fill="${c}" ${OUT}/></svg>`,
  play: c => `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="25" fill="${c}" ${OUT}/><path d="M9 24 C22 31 42 31 55 24 M11 43 C24 36 40 36 53 43" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`,
  etc: c => `<svg viewBox="0 0 64 64"><path d="M32 5 L39.6 22.3 L58.5 24.2 L44.3 36.7 L48.4 55.3 L32 45.7 L15.6 55.3 L19.7 36.7 L5.5 24.2 L24.4 22.3 Z" fill="${c}" ${OUT}/></svg>`,
};
const SVG = {
  play: '<svg viewBox="0 0 64 64"><path d="M22 14 L50 32 L22 50 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 64 64"><path d="M14 34 L27 47 L51 19" fill="none" stroke="#5a3f00" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  house: '<svg viewBox="0 0 64 64"><path d="M10 32 L32 12 L54 32 M17 27 V52 H47 V27" fill="none" stroke="#6b5536" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><rect x="27" y="36" width="10" height="16" rx="2" fill="#6b5536"/></svg>',
  speak: '<svg viewBox="0 0 64 64"><path d="M10 25 H20 L34 13 V51 L20 39 H10 Z" fill="#6b5536" stroke="#6b5536" stroke-width="3" stroke-linejoin="round"/><path d="M42 24 C46 28 46 36 42 40 M48 18 C55 25 55 39 48 46" fill="none" stroke="#6b5536" stroke-width="5" stroke-linecap="round"/></svg>',
  moon: '<svg viewBox="0 0 64 64"><path d="M40 8 A24 24 0 1 0 56 42 A19 19 0 1 1 40 8 Z" fill="#FFE27A" stroke="#3b2f25" stroke-width="3" stroke-linejoin="round"/><path d="M50 12 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z M14 50 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 Z" fill="#FFE27A"/></svg>',
  foot: c => `<svg viewBox="0 0 100 100"><g fill="${c}"><ellipse cx="50" cy="64" rx="17" ry="17"/><ellipse cx="30" cy="34" rx="9" ry="13" transform="rotate(-20 30 34)"/><ellipse cx="50" cy="24" rx="9" ry="13"/><ellipse cx="70" cy="34" rx="9" ry="13" transform="rotate(20 70 34)"/><path d="M26 30 L38 58 L46 54 Z M74 30 L62 58 L54 54 Z M45 24 H55 L54 52 H46 Z"/></g></svg>`,
};
SVG.dino = (c, stamp = false) => `<svg class="dino2d" viewBox="0 0 120 100">
  <path d="M26 66 Q6 62 4 44 Q16 58 34 58 Z" fill="${c}" ${OUT}/>
  <ellipse cx="52" cy="64" rx="27" ry="22" fill="${c}" ${OUT}/>
  <ellipse cx="54" cy="70" rx="15" ry="11" fill="#FFE08A"/>
  <rect x="36" y="78" width="10" height="16" rx="5" fill="${c}" ${OUT}/><rect x="56" y="78" width="10" height="16" rx="5" fill="${c}" ${OUT}/>
  <circle cx="44" cy="52" r="4" fill="#4FAE5C"/><circle cx="34" cy="62" r="3" fill="#4FAE5C"/>
  <circle cx="80" cy="36" r="21" fill="${c}" ${OUT}/>
  <circle cx="86" cy="31" r="7.5" fill="#fff" ${OUT}/><circle cx="88" cy="31" r="4" fill="#2B2622"/><circle cx="89.5" cy="29" r="1.4" fill="#fff"/>
  <ellipse cx="90" cy="43" rx="4" ry="2.5" fill="#FFA3B5"/><path d="M78 46 Q86 52 96 44" fill="none" stroke="#3b2f25" stroke-width="3" stroke-linecap="round"/>
  <g class="arm"><rect x="66" y="50" width="9" height="22" rx="4.5" fill="${c}" ${OUT} transform="rotate(-150 70 58)"/>
  ${stamp ? `<g transform="translate(76 18) rotate(10)"><rect x="-8" y="-2" width="16" height="12" rx="3" fill="#C98B4B" ${OUT}/><rect x="-12" y="10" width="24" height="8" rx="3" fill="#E0655A" ${OUT}/></g>` : ''}</g>
</svg>`;
SVG.stampWait = '<svg viewBox="0 0 64 64"><rect x="24" y="10" width="16" height="18" rx="4" fill="#C98B4B" stroke="#fff" stroke-width="3"/><rect x="14" y="28" width="36" height="12" rx="4" fill="#E0655A" stroke="#fff" stroke-width="3"/><rect x="12" y="46" width="40" height="6" rx="3" fill="#fff" opacity=".8"/></svg>';
const tint = (c, k = 0.78) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), k).getHexString();

/* ---------- 할 일 데이터 ---------- */
const subj = sid => state.subjects.find(s => s.id === sid) || state.subjects[state.subjects.length - 1];
const uid = () => Math.random().toString(36).slice(2, 9);
const hasAnyPlan = () => Object.values(state.weekly).some(a => a.length) || Object.keys(state.overrides).length > 0;
function planFor(key) {
  if (state.overrides[key]) return state.overrides[key];
  const [y, m, d] = key.split('-').map(Number);
  return state.weekly[new Date(y, m - 1, d).getDay()] || [];
}
let curDay = '';
function ensureToday() {
  const k = todayKey();
  if (!state.days[k]) {
    state.days[k] = { missions: planFor(k).slice(0, MAX_PER_DAY).map(p => ({ ...p, id: uid(), status: 'todo' })), cheered: false };
    const keys = Object.keys(state.days).sort(); while (keys.length > 60) delete state.days[keys.shift()];   // 최근 60일만
    save();
  }
  curDay = k;
  return state.days[k];
}
// 부모가 일정을 고쳤을 때: 끝낸 것은 그대로 두고 나머지만 새 일정으로
function rebuildToday() {
  const day = ensureToday(), old = day.missions, used = new Set();
  const next = planFor(todayKey()).slice(0, MAX_PER_DAY).map(p => {
    const o = old.find(m => m.sid === p.sid && !used.has(m.id));
    if (o) { used.add(o.id); if (o.status !== 'done') Object.assign(o, p, { id: o.id, status: o.status }); return o; }
    return { ...p, id: uid(), status: 'todo' };
  });
  old.forEach(m => { if (m.status === 'done' && !used.has(m.id)) next.push(m); });
  day.missions = next; if (!next.every(m => m.status === 'done')) day.cheered = false;
  save();
}
// 할 일 찾기: 오늘 → 지난 날 순서 (하는 중에 자정이 지나도 그 날 할 일로 끝낼 수 있게)
function findMission(id) {
  for (const k of Object.keys(state.days).sort().reverse()) { const m = (state.days[k].missions || []).find(x => x.id === id); if (m) return m; }
  return null;
}
const allDoneToday = () => { const ms = ensureToday().missions; return ms.length > 0 && ms.every(m => m.status === 'done'); };

/* ---------- 조사 (받침 따라 랑/이랑, 를/을) ---------- */
function batchim(w) { const c = w.charCodeAt(w.length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; }
const rang = w => w + (batchim(w) ? '이랑' : '랑');
const reul = w => w + (batchim(w) ? '을' : '를');
function greetText() {
  const ms = ensureToday().missions, todo = ms.filter(m => m.status === 'todo').map(m => subj(m.sid).name);
  if (!ms.length) return hasAnyPlan() ? '오늘은 쉬는 날이야' : '';
  if (!todo.length) return '오늘 할 일 다 했어! 최고야!';
  if (todo.length === 1) return `오늘은 ${reul(todo[0])} 하자!`;
  const head = todo.slice(0, -2).map(w => w + ', ').join('');   // 3개 이상: "가, 나, 다랑 라를"
  return `오늘은 ${head}${rang(todo[todo.length - 2])} ${reul(todo[todo.length - 1])} 하자!`;
}

/* ---------- 바쁨 / 잠자기 ---------- */
let lastBusy = performance.now(), sleeping = false, doingOpen = false;
const zzzEl = $('zzz');
const panelOpen = () => $('parent').classList.contains('on') || $('pin').classList.contains('on') || $('stamp').classList.contains('on');
function poke() { lastBusy = performance.now(); }
function bodyBusy() { document.body.classList.toggle('busy', phase !== 'idle'); }
function goSleep() {
  sleeping = true; FRAME_MS = 1000 / 6; document.body.classList.add('sleep'); sfx('snore'); hideHand();
}
function wake() {
  if (!sleeping) return;
  sleeping = false; FRAME_MS = 1000 / TARGET_FPS; document.body.classList.remove('sleep'); anim.jump = 0.001; anim.jumps = 0;
}

/* ---------- 홈: 오늘 할 일 카드 (최대 5개) ---------- */
function renderHome() {
  const ms = ensureToday().missions;
  if (!ms.length) {
    sideEl.style.setProperty('--n', 3);
    sideEl.innerHTML = hasAnyPlan()
      ? `<div class="card rest"><div class="ic" style="background:#E7E4F7">${SVG.moon}</div></div>`
      : `<div class="card empty"><div class="ic"></div></div><p class="phint">부모님: 왼쪽 위 자물쇠 버튼을 누르면 할 일을 넣을 수 있어요</p>`;
    requestAnimationFrame(resize); return;
  }
  sideEl.style.setProperty('--n', Math.max(3, ms.length));   // 4~5개면 카드를 작게
  sideEl.innerHTML = ms.map(m => {
    const s = subj(m.sid), done = m.status === 'done';
    return `<div class="card${done ? ' done' : ''}" data-id="${m.id}">
      <div class="ic" style="background:${tint(s.color)}">${ICON[s.icon](s.color)}</div>
      ${done ? `<div class="stamp">${SVG.foot(s.color)}</div>` : m.status === 'wait' ? `<button class="go wait" aria-label="도장 받기">${SVG.stampWait}</button>` : `<button class="go" aria-label="시작">${SVG.play}</button>`}
    </div>`;
  }).join('');
  requestAnimationFrame(resize);   // 세로 화면에서는 카드 줄 높이가 바뀌면 공룡 위치도 다시 맞춤
}
let tapLock = 0;
sideEl.addEventListener('click', e => {
  const now = performance.now(); if (now - tapLock < 600) return; tapLock = now;   // 연타 방지
  unlock();
  const card = e.target.closest('.card'); if (!card) return;
  if (card.classList.contains('rest')) { say('오늘은 쉬는 날이야'); return; }
  if (card.classList.contains('empty')) return;
  const m = ensureToday().missions.find(x => x.id === card.dataset.id); if (!m) return;
  const s = subj(m.sid);
  card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump');
  if (e.target.closest('.go') && m.status === 'wait') { openStamp(m); return; }
  if (e.target.closest('.go') && m.status === 'todo') {
    if (phase !== 'idle') { sfx('rattle'); return; }       // 뼈를 붙이는 중이면 끝나고 시작
    openDoing(m); return;
  }
  if (m.status === 'done') say(`${s.name} 다 했어!`); else speakSubject(s);   // 카드를 누르면 이름을 읽어 줌 (녹음 우선)
});

/* ---------- 하는 중 화면 + 발자국 타이머 (2단계) ---------- */
const doingEl = $('doing');
$('dSpeak').innerHTML = SVG.speak; $('dLater').innerHTML = SVG.house; $('dDone').innerHTML = SVG.check;
const FEET = 10;
$('feet').innerHTML = Array.from({ length: FEET }, (_, i) => `<div class="fp${i % 2 ? ' dn' : ''}">${SVG.foot('#6b5536')}</div>`).join('');
const fpEls = [...document.querySelectorAll('#feet .fp')];
const PAUSE_SVG = '<svg viewBox="0 0 64 64"><rect x="18" y="14" width="10" height="36" rx="3" fill="#6b5536"/><rect x="36" y="14" width="10" height="36" rx="3" fill="#6b5536"/></svg>';
const RESUME_SVG = '<svg viewBox="0 0 64 64"><path d="M22 14 L50 32 L22 50 Z" fill="#6b5536" stroke="#6b5536" stroke-width="5" stroke-linejoin="round"/></svg>';
$('dWave').innerHTML = SVG.dino('#7ED36B');
let doingId = null, wakeLock = null, focusTimer = 0;

function missionOpts(m) {
  const s = subj(m.sid);
  return { min: m.min ?? state.settings.defaultMin, noTimer: m.noTimer ?? s.noTimer, confirm: m.confirm ?? s.confirm };
}
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {} }
function releaseAwake() { try { wakeLock?.release(); } catch {} wakeLock = null; }

function openDoing(m, resume = false) {
  const s = subj(m.sid), o = missionOpts(m);
  doingId = m.id; doingOpen = true; poke(); hideHand();
  doingEl.style.background = tint(s.color, 0.82);
  $('dIcon').innerHTML = ICON[s.icon](s.color);
  doingEl.classList.toggle('notimer', o.noTimer);
  doingEl.classList.remove('ring');
  if (!o.noTimer) {
    const f = state.focus;
    if (!(resume && f && f.mid === m.id)) state.focus = { mid: m.id, total: o.min * 60000, left: o.min * 60000, endsAt: Date.now() + o.min * 60000, paused: false, rang: false };
    save(); keepAwake(); tickFocus();
    clearInterval(focusTimer); focusTimer = setInterval(tickFocus, 500);
  } else { state.focus = { mid: m.id, noTimer: true }; save(); }
  doingEl.classList.add('on');
  stop();                                                  // 3D 렌더링 정지 (딴짓 방지, 배터리)
  if (!resume) { sfx('appear'); speakSubject(s, `${s.name} 시작!`); }
}
function focusLeft() { const f = state.focus; return !f || f.noTimer ? 0 : f.paused ? f.left : Math.max(0, f.endsAt - Date.now()); }
function tickFocus() {
  const f = state.focus; if (!f || f.noTimer || !doingOpen) return;
  const left = focusLeft(), shown = Math.ceil(left / f.total * FEET);
  fpEls.forEach((el, i) => el.classList.toggle('gone', i >= shown));   // 발자국이 하나씩 사라짐 (숫자 없음)
  $('dPause').innerHTML = f.paused ? RESUME_SVG : PAUSE_SVG;
  doingEl.classList.toggle('paused', !!f.paused);
  if (left <= 0 && !f.rang) {
    f.rang = true; save();
    doingEl.classList.add('ring');                          // 공룡이 손짓 + 노란 버튼이 통통
    sfx('chime'); buzz([200, 100, 200]); guide('다 했으면 노란 버튼을 눌러!');
  }
}
$('dPause').onclick = () => {
  const f = state.focus; if (!f || f.noTimer || f.rang) return;
  if (f.paused) { f.endsAt = Date.now() + f.left; f.paused = false; keepAwake(); }
  else { f.left = Math.max(0, f.endsAt - Date.now()); f.paused = true; }
  save(); tickFocus();
};
function closeDoing() {
  doingEl.classList.remove('on', 'ring'); doingOpen = false; doingId = null;
  clearInterval(focusTimer); releaseAwake();
  state.focus = null; save();
  start(); poke();
}
$('dSpeak').onclick = () => { const m = findMission(doingId); if (m) speakSubject(subj(m.sid)); };
$('dLater').onclick = () => { closeDoing(); renderHome(); };        // 나중에: 할 일은 남고 타이머만 처음으로 (벌칙 없음)
let doneLock = 0;
$('dDone').onclick = () => {
  if (performance.now() - doneLock < 1000) return; doneLock = performance.now();
  const m = findMission(doingId); if (!m) { closeDoing(); return; }
  closeDoing();
  if (missionOpts(m).confirm) { m.status = 'wait'; save(); renderHome(); openStamp(m); return; }   // 부모 확인 도장 (3단계)
  completeMission(m);
};
function completeMission(m) {
  m.status = 'done'; m.doneAt = Date.now(); save();
  wake(); renderHome();
  missionDone(subj(m.sid).color);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && doingOpen) { keepAwake(); tickFocus(); } });
function missionDone(color) {
  if (phase !== 'idle' || decoOn || growAnim) { state.dino.pending++; save(); return; }
  if (state.dino.awake && growOf(state.dino) < growSteps()) { growUp(); return; }   // 아기 공룡이면 쑥 자람
  if (state.dino.awake) { newDino(() => setTimeout(() => spawnRock(color), 700)); return; }
  setTimeout(() => spawnRock(color), 450);
}
function growUp() {
  const d = state.dino, from = sizeOf(d);
  d.grow = Math.min(growOf(d), growSteps()) + 1; save();
  const done = d.grow >= growSteps();
  growAnim = { from, to: sizeOf(d), t: 0, done };
  pillar.visible = true; pillar.material.opacity = 0;
  sfx('sparkle'); buzz(60); updateBar(-1, d.grow - 1); wake(); poke();
  guide(done ? '다 컸어! 최고야!' : '쑥쑥 자랐어!');
}
function stepGrow(dt) {
  const g = growAnim; if (!g) return;
  g.t += dt; const k = Math.min(1, g.t / 1.1), e = 1 - Math.pow(1 - k, 3);
  pillar.material.opacity = Math.sin(k * Math.PI) * 0.35; pillar.rotation.y += dt * 0.8;
  setSize(g.from + (g.to - g.from) * e + Math.sin(k * Math.PI) * 0.05);   // 쑥 커지면서 살짝 통통
  if (k < 1) return;
  growAnim = null; pillar.visible = false; setSize(sizeOf(state.dino));
  anim.jump = 0.001; anim.jumps = g.done ? 2 : 1;
  if (g.done) {                                            // 다 컸으면 크앙 + 공원 사진을 다 큰 모습으로
    anim.jaw = 0.8; sfx('roar');
    state.dino.thumb = capture(curKind, lookOf(state.dino)); save();
  }
  setTimeout(() => {
    if (state.dino.pending > 0) { state.dino.pending--; save(); missionDone(); }   // 그 사이 끝낸 할 일
    else maybeCheer();
  }, 1200);
}
// 진행 중인 바위·뼈·연출을 치움 (부모 테스트, 새 공룡)
function clearPlay() {
  if (growAnim) { growAnim = null; pillar.visible = false; }
  if (fl.obj) { scene.remove(fl.obj); fl.obj = null; }
  rock.mesh.visible = false; rockShadow.visible = false; pillar.visible = false; M.bone.emissive.setScalar(0);
  phase = 'idle'; hideHand(true); rig.scale.y = 1; bodyBusy();
}
// 깨어난 공룡은 공원으로, 새 공룡을 골라 뼈대부터 시작
function newDino(then) {
  const d = state.dino;
  state.park.push({ kind: d.kind, name: d.name, look: d.look, thumb: d.thumb || capture(d.kind, lookOf(d)), doneAt: d.doneAt || todayKey() });
  state.dino = { ...defaultState().dino, kind: d.kind, giftGiven: true, chosen: false };
  save(); clearPlay(); applyVisibility(); sfx('sparkle');
  setTimeout(() => chooseDino(then), 500);
}

/* ---------- 오늘 할 일 다 하면 축하 ---------- */
function maybeCheer() {
  const day = ensureToday();
  if (day.cheered || !allDoneToday() || phase !== 'idle') return;
  day.cheered = true; save();
  sfx('sparkle'); guide('오늘 할 일 다 했어! 최고야!');
  if (state.dino.awake) { anim.jump = 0.001; anim.jumps = 2; anim.jaw = 0.4; } else anim.wobble = 1;
  document.body.classList.remove('cheer'); void document.body.offsetWidth; document.body.classList.add('cheer');
}

/* ---------- 인사: 첫 터치 때 한 번 (브라우저가 터치 전에는 소리를 못 냄) ---------- */
let greeted = false;
document.addEventListener('pointerdown', e => {
  if (greeted) return; greeted = true;
  if (e.target.closest('#side, #parent, #pin, #corner, #doing, #stamp') || phase !== 'idle') return;
  if (ensureToday().missions.length && playVoice('greet')) return;
  const t = greetText(); if (t) setTimeout(() => guide(t), 150);
}, { capture: true });
setInterval(() => { if (todayKey() !== curDay) { ensureToday(); renderHome(); } }, 60000);   // 자정 넘김

/* ==========================================================
   4·5단계: 공룡 고르기 · 꾸미기 · 이름 카드 · 공룡 공원 · 스티커
   공통 방식: 카드를 누르면 소리로 알려 주고 커짐 → 초록 ✓로 결정
   ========================================================== */

/* ---------- 캡처 (완성 사진·고르기 카드) ---------- */
const CAP_W = 240, CAP_H = 180;
const capRT = new THREE.WebGLRenderTarget(CAP_W, CAP_H, { samples: 0 });
capRT.texture.colorSpace = THREE.SRGBColorSpace;
const capCam = new THREE.PerspectiveCamera(35, CAP_W / CAP_H, 0.1, 60);
capCam.position.set(0, 1.9, 10.4); capCam.lookAt(-0.2, 1.35, 0);
function capture(kind, look) {
  const keep = { kind: curKind, bg: scene.background.clone(), gr: groundMat.color.clone(), ry: root.rotation.y, py: rig.position.y, rz: rig.rotation.z, sy: rig.scale.y, clip: clipPlane.constant };
  const hidden = [rock.mesh, rockShadow, pillar, fl.obj, ...frags.map(f => f.m)].filter(o => o && o.visible); hidden.forEach(o => { o.visible = false; });
  useKind(kind);
  const keepSize = models[kind].group.scale.x; setSize(1, kind);   // 사진은 늘 다 큰 모습
  const vis = pieces.map(p => [p.bone.visible, p.ghost.visible, p.skin.visible]);
  pieces.forEach(p => { p.bone.visible = false; p.ghost.visible = false; p.skin.visible = true; p.holder.rotation.set(0, 0, 0); });
  applyLook(kind, look); eyes.forEach(g => { g.scale.y = 1; });
  scene.background.copy(GRASS_BG); groundMat.color.copy(GRASS_GROUND);
  root.rotation.y = -0.45; rig.position.y = 0; rig.rotation.z = 0; rig.scale.y = 1; clipPlane.constant = 100;
  renderer.setRenderTarget(capRT); renderer.render(scene, capCam);
  const buf = new Uint8Array(CAP_W * CAP_H * 4); renderer.readRenderTargetPixels(capRT, 0, 0, CAP_W, CAP_H, buf); renderer.setRenderTarget(null);
  const c = document.createElement('canvas'); c.width = CAP_W; c.height = CAP_H; const x = c.getContext('2d'), img = x.createImageData(CAP_W, CAP_H);
  for (let y = 0; y < CAP_H; y++) img.data.set(buf.subarray((CAP_H - 1 - y) * CAP_W * 4, (CAP_H - y) * CAP_W * 4), y * CAP_W * 4);   // 위아래 뒤집기
  x.putImageData(img, 0, 0);
  pieces.forEach((p, i) => { [p.bone.visible, p.ghost.visible, p.skin.visible] = vis[i]; });
  setSize(keepSize, kind);
  useKind(keep.kind); applyLook(keep.kind, viewing ? viewing.look : lookOf(state.dino));
  scene.background.copy(keep.bg); groundMat.color.copy(keep.gr);
  root.rotation.y = keep.ry; rig.position.y = keep.py; rig.rotation.z = keep.rz; rig.scale.y = keep.sy; clipPlane.constant = keep.clip;
  hidden.forEach(o => { o.visible = true; });
  return c.toDataURL('image/jpeg', 0.82);
}
const kindShots = {};
const kindShot = k => kindShots[k] || (kindShots[k] = capture(k, DEFAULT_LOOK[k]));

/* ---------- 고르기 화면 공통 ---------- */
const pickEl = $('pick');
const pk = { items: [], sel: -1, onOk: null };
$('pkOk').innerHTML = SVG.check;
function openPicker(kind, items, onOk, voice) {
  pk.items = items; pk.sel = -1; pk.onOk = onOk;
  pickEl.className = 'on ' + kind;
  $('pkCards').innerHTML = items.map((it, i) => `<button class="pkc" data-i="${i}" style="${it.bg ? `background:${it.bg}` : ''}">${it.html}</button>`).join('');
  $('pkOk').classList.remove('on'); hideHand();
  stop(); doingOpen = true;
  if (voice) guide(voice);
}
$('pkCards').addEventListener('click', e => {
  const b = e.target.closest('.pkc'); if (!b) return; unlock();
  pk.sel = +b.dataset.i;
  document.querySelectorAll('.pkc').forEach((el, i) => el.classList.toggle('sel', i === pk.sel));
  $('pkOk').classList.add('on'); sfx('appear');
  const it = pk.items[pk.sel]; if (it.say) say(it.say);
});
$('pkOk').onclick = () => {
  if (pk.sel < 0) return;
  const it = pk.items[pk.sel], cb = pk.onOk;
  pickEl.className = ''; doingOpen = false; start(); poke(); sfx('click');
  cb?.(it);
};

/* ---------- 공룡 고르기 (5단계) ---------- */
function chooseDino(then) {
  const got = new Set(parkList().map(p => p.kind));          // 이미 완성한 공룡에는 별 표시 (새 공룡이 눈에 띄게)
  openPicker('dinos', KINDS.map(k => ({ kind: k, say: DINO_NAME[k], html: `<img src="${kindShot(k)}" alt="">${got.has(k) ? `<span class="got">${ICON.etc('#F5C542')}</span>` : ''}` })), it => {
    state.dino.kind = it.kind; state.dino.chosen = true; save();
    applyVisibility(); guide(`${DINO_NAME[it.kind]} 뼈를 찾아보자!`);
    then?.();
  }, '어떤 공룡을 살려 볼까?');
}

/* ---------- 꾸미기 (깨어난 뒤) ---------- */
const BODY_COLORS = ['#7ED36B', '#F0A35E', '#7FB8E8', '#B58CE0', '#F58FB0', '#F2CF4A', '#5CC6B8', '#E86A5A'];
const SPOT_COLORS = ['#4FAE5C', '#C9703A', '#3F7FC0', '#8A5CC2', '#E0567E', '#F2A65A', '#2E8F83', '#FFFFFF'];
const PAT_SVG = {
  dots: c => `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="#fff" ${OUT}/><circle cx="22" cy="24" r="6" fill="${c}"/><circle cx="40" cy="22" r="5" fill="${c}"/><circle cx="30" cy="40" r="6" fill="${c}"/><circle cx="44" cy="40" r="4" fill="${c}"/></svg>`,
  stripes: c => `<svg viewBox="0 0 64 64"><clipPath id="cp"><circle cx="32" cy="32" r="26"/></clipPath><circle cx="32" cy="32" r="26" fill="#fff"/><g clip-path="url(#cp)" fill="${c}"><rect x="14" y="0" width="7" height="64"/><rect x="29" y="0" width="7" height="64"/><rect x="44" y="0" width="7" height="64"/></g><circle cx="32" cy="32" r="26" fill="none" ${OUT}/></svg>`,
  none: () => `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="#fff" ${OUT}/></svg>`,
};
const decoEl = $('deco');
function openDeco() {
  decoOn = true; document.body.classList.add('decoOn'); hideHand();
  if (!state.dino.look) state.dino.look = { ...lookOf(state.dino) };
  renderDeco(); requestAnimationFrame(resize);
  guide('공룡 색을 골라 줘!');
}
function renderDeco() {
  const L = state.dino.look;
  decoEl.innerHTML = `<div class="drow2">${BODY_COLORS.map(c => `<button class="dsw${L.body === c ? ' on' : ''}" data-body="${c}" style="background:${c}"></button>`).join('')}</div>
    <div class="drow2">${SPOT_COLORS.map(c => `<button class="dsw sm${L.spot === c ? ' on' : ''}" data-spot="${c}" style="background:${c}"></button>`).join('')}</div>
    <div class="drow2">${['dots', 'stripes', 'none'].map(p => `<button class="dpat${L.pattern === p ? ' on' : ''}" data-pat="${p}">${PAT_SVG[p](L.spot === '#FFFFFF' ? '#bbb' : L.spot)}</button>`).join('')}</div>
    <button class="dok" id="decoOk">${SVG.check}</button>`;
}
decoEl.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; unlock();
  const L = state.dino.look;
  if (b.dataset.body) L.body = b.dataset.body;
  if (b.dataset.spot) L.spot = b.dataset.spot;
  if (b.dataset.pat) L.pattern = b.dataset.pat;
  if (b.id === 'decoOk') { closeDeco(); return; }
  save(); applyLook(curKind, lookOf(state.dino)); renderDeco(); sfx('appear');
  anim.jump = 0.001; anim.jumps = 0;
});
function closeDeco() {
  decoOn = false; document.body.classList.remove('decoOn'); requestAnimationFrame(resize); sfx('click');
  chooseName();
}

/* ---------- 이름 카드 ---------- */
const NAME_ICONS = [
  c => SVG.foot(c),
  c => ICON.etc(c),
  c => `<svg viewBox="0 0 64 64"><circle cx="24" cy="36" r="14" fill="${c}" ${OUT}/><circle cx="44" cy="24" r="10" fill="${c}" ${OUT}/><circle cx="46" cy="46" r="6" fill="${c}" ${OUT}/><circle cx="20" cy="31" r="4" fill="#fff"/></svg>`,
  c => `<svg viewBox="0 0 64 64"><path d="${BONE_PATH}" transform="rotate(-35 32 32)" fill="${c}" ${OUT}/></svg>`,
  c => `<svg viewBox="0 0 64 64"><path d="M32 54 C10 38 6 26 14 17 C21 10 30 13 32 20 C34 13 43 10 50 17 C58 26 54 38 32 54 Z" fill="${c}" ${OUT}/></svg>`,
  c => `<svg viewBox="0 0 64 64"><path d="M16 46 C6 46 6 32 16 32 C16 20 32 16 36 26 C44 18 58 26 52 36 C60 38 58 48 50 46 Z" fill="${c}" ${OUT}/></svg>`,
];
const NAME_COLORS = ['#F0913F', '#E8B830', '#4FA3E0', '#C9A57A', '#EF7FA8', '#9B6FD6'];
const iya = n => n + (batchim(n) ? '이야' : '야');
function chooseName() {
  const names = state.settings.names.slice(0, 6);
  openPicker('names', names.map((n, i) => ({ name: n, say: n, bg: tint(NAME_COLORS[i % 6], 0.8), html: NAME_ICONS[i % 6](NAME_COLORS[i % 6]) })), it => {
    state.dino.name = it.name; save();
    state.dino.thumb = capture(curKind, lookOf(state.dino)); save();
    setTimeout(() => { say(`안녕! 나는 ${iya(it.name)}!`); anim.jump = 0.001; anim.jumps = 1; anim.jaw = 0.4; }, 300);
    setTimeout(maybeCheer, 2600);
  }, '이름을 골라 줘!');
}

/* ---------- 공룡 공원 (도감) + 이번 달 스티커 ---------- */
const parkEl = $('park');
$('parkBtn').innerHTML = SVG.foot('#5a8f3c'); $('parkHome').innerHTML = SVG.house; $('viewBack').innerHTML = SVG.house;
const monthKey = () => todayKey().slice(0, 7);
function parkList() {
  const L = state.park.slice();
  if (state.dino.awake && state.dino.name) L.push({ kind: state.dino.kind, name: state.dino.name, look: state.dino.look, thumb: state.dino.thumb, doneAt: state.dino.doneAt, current: true });
  return L;
}
let parkSel = -1;
function openPark() {
  if (phase !== 'idle' || decoOn) return;
  parkSel = -1; renderPark(); parkEl.classList.add('on'); stop(); doingOpen = true; hideHand(); sfx('appear');
}
function renderPark() {
  const L = parkList(), got = new Set(L.map(p => p.kind));
  const month = L.filter(p => (p.doneAt || '').startsWith(monthKey())).length;
  $('stickers').innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="stk${i < month ? ' on' : ''}">${ICON.etc(i < month ? '#F5C542' : '#e9dfcc')}</span>`).join('');
  $('parkGrid').innerHTML = L.map((p, i) => `<button class="pc${i === parkSel ? ' sel' : ''}" data-i="${i}"><img src="${p.thumb || kindShot(p.kind)}" alt=""></button>`).join('') +
    KINDS.filter(k => !got.has(k)).map(k => `<div class="pc unknown"><img src="${kindShot(k)}" alt=""><b>?</b></div>`).join('');
  $('parkView').classList.toggle('on', parkSel >= 0);
  $('parkView').innerHTML = SVG.play;
}
$('parkGrid').addEventListener('click', e => {
  const b = e.target.closest('.pc'); if (!b || b.classList.contains('unknown')) return; unlock();
  parkSel = +b.dataset.i; const p = parkList()[parkSel];
  say(p.name ? `${p.name}! ${DINO_NAME[p.kind]}` : DINO_NAME[p.kind]); renderPark();
});
$('parkHome').onclick = () => { parkEl.classList.remove('on'); doingOpen = false; start(); poke(); };
$('parkView').onclick = () => { const p = parkList()[parkSel]; if (!p) return; parkEl.classList.remove('on'); doingOpen = false; startView(p); };
$('parkBtn').onclick = () => { unlock(); openPark(); };
function startView(p) {
  viewing = { ...p, look: { ...DEFAULT_LOOK[p.kind], ...(p.look || {}) } };
  phase = 'view'; document.body.classList.add('viewing'); bodyBusy();
  useKind(p.kind); pieces.forEach(q => { q.bone.visible = false; q.ghost.visible = false; q.skin.visible = true; });
  setSize(p.current ? sizeOf(state.dino) : 1);                 // 공원 공룡은 다 큰 모습, 지금 공룡은 지금 크기
  applyLook(p.kind, viewing.look); scene.background.copy(GRASS_BG); groundMat.color.copy(GRASS_GROUND);
  requestAnimationFrame(resize);
  start(); anim.jump = 0.001; anim.jumps = 0; sfx('roarSmall');
  if (p.name) setTimeout(() => say(`나는 ${iya(p.name)}!`), 400);
}
$('viewBack').onclick = () => {
  viewing = null; phase = 'idle'; document.body.classList.remove('viewing');
  applyVisibility(); bodyBusy(); poke(); requestAnimationFrame(resize); openPark();
};

/* ==========================================================
   3단계: 녹음 · 부모 확인 도장 · 비밀번호 · 부모 모드
   ========================================================== */

/* ---------- 부모 목소리 녹음 (IndexedDB, 이 태블릿 안에만) ---------- */
const VDB = 'dinoPlannerVoice';
const voiceKeys = new Set(); const voiceUrls = {};
function vdb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no idb'));
    const r = indexedDB.open(VDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('v');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function vGetAll() {
  try {
    const db = await vdb();
    await new Promise(res => { const tx = db.transaction('v'), st = tx.objectStore('v'), rq = st.openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { voiceKeys.add(c.key); voiceUrls[c.key] = URL.createObjectURL(c.value); c.continue(); } else res(); };
      rq.onerror = () => res(); });
  } catch {}
}
async function vPut(key, blob) {
  const db = await vdb();
  await new Promise((res, rej) => { const tx = db.transaction('v', 'readwrite'); tx.objectStore('v').put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  voiceKeys.add(key); if (voiceUrls[key]) URL.revokeObjectURL(voiceUrls[key]); voiceUrls[key] = URL.createObjectURL(blob);
}
async function vDel(key) {
  try { const db = await vdb(); await new Promise(res => { const tx = db.transaction('v', 'readwrite'); tx.objectStore('v').delete(key); tx.oncomplete = res; tx.onerror = res; }); } catch {}
  voiceKeys.delete(key); if (voiceUrls[key]) { URL.revokeObjectURL(voiceUrls[key]); delete voiceUrls[key]; }
}
async function vClear() { try { const db = await vdb(); await new Promise(res => { const tx = db.transaction('v', 'readwrite'); tx.objectStore('v').clear(); tx.oncomplete = res; tx.onerror = res; }); } catch {} voiceKeys.clear(); }
let voiceAudio = null;
function playVoice(key) {
  if (!voiceUrls[key]) return false;
  try { if (hasTTS) speechSynthesis.cancel(); voiceAudio?.pause(); voiceAudio = new Audio(voiceUrls[key]); voiceAudio.play().catch(() => {}); return true; } catch { return false; }
}
// 할 일 이름 읽기: 1순위 부모 녹음, 2순위 음성 합성
function speakSubject(s, text) { if (!playVoice('s:' + s.id)) say(text || s.name); }
vGetAll();

/* ---------- 비밀번호 (6자리, 해시로 저장) ---------- */
async function hashPin(pin) {
  const msg = 'dinoPlanner:' + pin;
  try { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg)); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  catch { let h = 2166136261; for (const ch of msg) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return 'f' + (h >>> 0).toString(16); }
}
const pinEl = $('pin');
const pin = { buf: '', mode: 'check', first: '', onOk: null };
$('pinPad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '←'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('');
function pinDraw(msg = '') {
  $('pinDots').innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < pin.buf.length ? 'f' : ''}"></i>`).join('');
  $('pinMsg').textContent = msg;
  $('pinTitle').textContent = pin.mode === 'set1' ? '새 비밀번호 6자리' : pin.mode === 'set2' ? '한 번 더 입력' : '부모 비밀번호';
}
function askPin(onOk, forceSet = false) {
  pin.buf = ''; pin.onOk = onOk; pin.mode = (!state.settings.pinHash || forceSet) ? 'set1' : 'check';
  pinDraw(pin.mode === 'set1' && !forceSet ? '처음이라 비밀번호를 정합니다' : ''); pinEl.classList.add('on');
}
$('pinCancel').onclick = () => pinEl.classList.remove('on');
$('pinPad').addEventListener('click', async e => {
  const k = e.target.closest('button')?.dataset.k; if (k == null) return;
  if (k === '←') { pin.buf = pin.buf.slice(0, -1); pinDraw(); return; }
  if (pin.buf.length >= 6) return;
  pin.buf += k; pinDraw();
  if (pin.buf.length < 6) return;
  const v = pin.buf; pin.buf = '';
  if (pin.mode === 'set1') { pin.first = v; pin.mode = 'set2'; pinDraw(); return; }
  if (pin.mode === 'set2') {
    if (v !== pin.first) { pin.mode = 'set1'; pinDraw('두 번 입력한 번호가 달라요. 다시 정해 주세요'); return; }
    state.settings.pinHash = await hashPin(v); save(); pinEl.classList.remove('on'); pin.onOk?.(); return;
  }
  if (await hashPin(v) === state.settings.pinHash) { pinEl.classList.remove('on'); pin.onOk?.(); }
  else { pinDraw('번호가 달라요'); $('pinDots').classList.remove('shake'); void $('pinDots').offsetWidth; $('pinDots').classList.add('shake'); }
});

/* ---------- 부모 확인 도장 (6.3절) ---------- */
const stampEl = $('stamp');
$('stDino').innerHTML = SVG.dino('#7ED36B', true);
$('sLater').innerHTML = SVG.house;
$('stPad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, '←', 0, '✓'].map(k => `<button data-k="${k}">${k}</button>`).join('');
const st = { mid: null, a: 0, b: 0, buf: '' };
function openStamp(m) {
  const s = subj(m.sid);
  st.mid = m.id; st.buf = '';
  st.a = 11 + Math.floor(Math.random() * 18); st.b = 6 + Math.floor(Math.random() * 13);   // 두 자리 덧셈: 만 4세가 스스로 풀기 어려움
  $('stIcon').innerHTML = ICON[s.icon](s.color);
  drawStamp(); stampEl.classList.add('on'); stop(); doingOpen = true;
  guide('엄마 아빠한테 보여 주자!');
}
function drawStamp(msg) {
  const pinMode = state.settings.confirmMode === 'pin';
  $('sq').innerHTML = (pinMode ? `비밀번호 ${'●'.repeat(st.buf.length)}${'○'.repeat(6 - st.buf.length)}` : `${st.a} + ${st.b} = ${st.buf || '?'}`) +
    `<small>${msg || '부모님이 확인하고 도장을 찍어 주세요'}</small>`;
}
function closeStamp() { stampEl.classList.remove('on'); doingOpen = false; start(); poke(); }
$('sLater').onclick = () => { closeStamp(); renderHome(); };    // 도장은 나중에: 카드에 "도장 기다리는 중"
$('stPad').addEventListener('click', async e => {
  const k = e.target.closest('button')?.dataset.k; if (k == null) return;
  const pinMode = state.settings.confirmMode === 'pin';
  if (k === '←') { st.buf = st.buf.slice(0, -1); drawStamp(); return; }
  if (k !== '✓') { if (st.buf.length < (pinMode ? 6 : 3)) st.buf += k; drawStamp(); if (!(pinMode && st.buf.length === 6)) return; }
  const ok = pinMode ? (await hashPin(st.buf)) === state.settings.pinHash : Number(st.buf) === st.a + st.b;
  if (!ok) { st.buf = ''; drawStamp('다시 확인해 주세요'); $('sq').classList.remove('shake'); void $('sq').offsetWidth; $('sq').classList.add('shake'); return; }
  const m = findMission(st.mid);
  closeStamp(); sfx('stamp'); buzz(60);
  if (m) completeMission(m);
});

/* ---------- 부모 모드 입구: 왼쪽 위 자물쇠 버튼 (누르면 비밀번호) ---------- */
const corner = $('corner'), parentEl = $('parent');
corner.addEventListener('click', e => { e.preventDefault(); unlock(); askPin(openParent); });
corner.addEventListener('contextmenu', e => e.preventDefault());

const TABS = [['plan', '할 일'], ['past', '지난 날'], ['subj', '할 일 종류'], ['stats', '달성'], ['set', '설정'], ['test', '테스트'], ['data', '데이터']];
const pv = { tab: 'plan', planMode: 'weekly', weekOff: 0, pickFor: null, msg: '', wipeArm: 0 };
function openParent() { parentEl.classList.add('on'); stop(); hideHand(); renderParent(); }
function closeParent() {
  parentEl.classList.remove('on'); pv.pickFor = null; start(); poke(); renderHome();
  // 지난 날에서 처리한 할 일: 쌓인 뼈를 하나씩 (나머지는 뼈를 붙일 때마다 이어서 나옴)
  if (pv.pastGiven && state.dino.pending > 0) { pv.pastGiven = false; state.dino.pending--; save(); setTimeout(() => missionDone(), 300); }
}
$('pClose').onclick = closeParent;
$('ptabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.t; if (t) { pv.tab = t; pv.pickFor = null; pv.msg = ''; renderParent(); $('pbody').scrollTop = 0; } });

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function mondayOf(off = 0) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + off * 7); return d; }
function weekKeys(off = 0) { const m = mondayOf(off); return Array.from({ length: 7 }, (_, i) => { const d = new Date(m); d.setDate(m.getDate() + i); return keyOf(d); }); }
const itemFor = sid => { const s = subj(sid); return { sid, min: state.settings.defaultMin, noTimer: s.noTimer, confirm: s.confirm }; };
const fullItem = p => ({ ...itemFor(p.sid), ...p });

function planItemHTML(p, idx, where, doneMark) {
  const s = subj(p.sid), it = fullItem(p);
  return `<div class="item" data-w="${where}" data-i="${idx}">
    <span class="mini">${ICON[s.icon](s.color)}</span><span class="nm">${esc(s.name)}</span>
    ${doneMark ? `<span class="done">${doneMark}</span>` : ''}
    ${it.noTimer ? `<button class="sm" data-a="timer">타이머 없음</button>`
      : `<span class="step"><button class="sm" data-a="min-">−</button><b>${it.min}분</b><button class="sm" data-a="min+">+</button><button class="sm" data-a="timer">타이머 끄기</button></span>`}
    <button class="sm${it.confirm ? ' sel' : ''}" data-a="confirm">도장${it.confirm ? ' 켬' : ''}</button>
    <button class="sm warn" data-a="del">삭제</button>
  </div>`;
}
function pickerHTML(where) {
  return `<div class="picker">${state.subjects.map(s => `<button class="sm" data-add="${s.id}" data-w="${where}"><span class="mini">${ICON[s.icon](s.color)}</span>${esc(s.name)}</button>`).join('')}<button class="sm" data-a="pickclose" data-w="${where}">닫기</button></div>`;
}
function dayBlock(title, list, where, extra = '', dayRec = null, isToday = false) {
  const status = sid => { if (!dayRec) return ''; const m = dayRec.missions.find(x => x.sid === sid && x.status === 'done'); return m ? '완료 ✓' : ''; };
  return `<div class="day${isToday ? ' today' : ''}"><header><span>${title}</span>${extra}</header>
    ${list.length ? list.map((p, i) => planItemHTML(p, i, where, status(p.sid))).join('') : '<div class="note">쉬는 날</div>'}
    <div class="row"><button class="sm" data-a="pick" data-w="${where}" ${list.length >= MAX_PER_DAY ? 'disabled' : ''}>+ 할 일</button></div>
    ${pv.pickFor === where ? pickerHTML(where) : ''}</div>`;
}
function listFor(where) {
  if (where.startsWith('w')) return state.weekly[+where.slice(1)];
  const k = where.slice(1);
  if (!state.overrides[k]) state.overrides[k] = planFor(k).map(p => ({ ...p }));   // 날짜별로 처음 고칠 때 반복 일정을 복사
  return state.overrides[k];
}
function planChanged() { save(); rebuildToday(); renderParent(); }

function renderParent() {
  $('ptabs').innerHTML = TABS.map(([t, n]) => `<button data-t="${t}" class="${pv.tab === t ? 'on' : ''}">${n}</button>`).join('');
  const b = $('pbody'); const top = b.scrollTop;
  b.innerHTML = ({ plan: tabPlan, past: tabPast, subj: tabSubj, stats: tabStats, set: tabSet, test: tabTest, data: tabData })[pv.tab]();
  b.scrollTop = top;
  if (pv.tab === 'data') $('jsonOut') && ($('jsonOut').value = '');
}

/* --- 할 일 등록 --- */
function tabPlan() {
  const today = todayKey();
  let h = `<div class="row"><button data-a="mode" data-v="weekly" class="${pv.planMode === 'weekly' ? 'sel' : ''}">매주 반복</button>
    <button data-a="mode" data-v="date" class="${pv.planMode === 'date' ? 'sel' : ''}">날짜별</button></div>`;
  if (pv.planMode === 'weekly') {
    h += `<p class="note">요일마다 할 일을 정하면 매주 자동으로 나옵니다. 하루 최대 ${MAX_PER_DAY}개. 비워 둔 날은 쉬는 날입니다. "도장 켬"이면 다 했어 뒤에 부모 확인이 필요합니다.</p><div class="days">`;
    h += WEEK_ORDER.map(d => dayBlock(`${DOW[d]}요일`, state.weekly[d], 'w' + d)).join('') + '</div>';
  } else {
    const ks = weekKeys(pv.weekOff), a = ks[0].slice(5).replace('-', '/'), z = ks[6].slice(5).replace('-', '/');
    h += `<div class="row"><button data-a="wk-">◀</button><b>${pv.weekOff === 0 ? '이번 주' : pv.weekOff < 0 ? `${-pv.weekOff}주 전` : `${pv.weekOff}주 뒤`} (${a} ~ ${z})</b><button data-a="wk+">▶</button></div>
      <div class="row"><button class="sm" data-a="copyLast">지난주 복사</button><button class="sm" data-a="toWeekly">반복 일정으로 되돌리기</button><button class="sm warn" data-a="clearWeek">이번 주 비우기</button></div><div class="days">`;
    h += ks.map(k => {
      const [y, m, d] = k.split('-').map(Number), dw = new Date(y, m - 1, d).getDay(), own = !!state.overrides[k];
      const extra = `<span class="tag${own ? ' own' : ''}">${own ? '이 날만' : '반복'}</span>${own ? `<button class="sm" data-a="unown" data-k="${k}">반복으로</button>` : ''}`;
      return dayBlock(`${m}/${d} (${DOW[dw]})`, own ? state.overrides[k] : planFor(k), 'd' + k, extra, state.days[k], k === today);
    }).join('') + '</div>';
  }
  return h + (pv.msg ? `<div class="out">${esc(pv.msg)}</div>` : '');
}

/* --- 할 일 종류 (아이콘·이름·색·녹음) --- */
const PALETTE = ['#4FA3E0', '#F0913F', '#E0655A', '#9B6FD6', '#E2B21C', '#2DB3A6', '#EF7FA8', '#D98A4A', '#56B35C', '#8A8F99'];
let recState = { key: null, rec: null, timer: 0 };
function tabSubj() {
  const rec = k => recState.key === k;
  const recBtns = (k, label) => `<span class="row" style="margin:0">
    <button class="sm${rec(k) ? ' warn' : ''}" data-rec="${k}">${rec(k) ? '■ 멈추기' : '🎙 ' + label}</button>
    ${voiceKeys.has(k) ? `<button class="sm" data-play="${k}">▶ 듣기</button><button class="sm warn" data-vdel="${k}">녹음 지우기</button>` : '<span class="note">녹음 없음 (음성 합성으로 읽음)</span>'}</span>`;
  let h = `<p class="note">아이 화면에는 그림만 나오고, 이름은 소리로만 들립니다. 이름은 음성 합성이 읽을 말이라 소리 내어 읽기 좋게 적어 주세요. 녹음을 하면 녹음이 먼저 나옵니다 (5초까지).</p>`;
  h += state.subjects.map((s, i) => `<div class="subjrow" data-si="${i}">
    <span class="mini" style="background:${tint(s.color)};border-radius:10px;padding:4px">${ICON[s.icon](s.color)}</span>
    <input type="text" value="${esc(s.name)}" data-name="${i}" maxlength="12">
    <span class="row icpick" style="margin:0">${Object.keys(ICON).map(ic => `<button class="sm${s.icon === ic ? ' sel' : ''}" data-icon="${ic}" data-si="${i}"><span class="mini">${ICON[ic](s.color)}</span></button>`).join('')}</span>
    <span class="row" style="margin:0">${PALETTE.map(c => `<button class="sw${s.color === c ? ' on' : ''}" style="background:${c}" data-color="${c}" data-si="${i}"></button>`).join('')}</span>
    <button class="sm${s.noTimer ? ' sel' : ''}" data-snt="${i}">타이머 없음${s.noTimer ? ' 켬' : ''}</button>
    <button class="sm${s.confirm ? ' sel' : ''}" data-scf="${i}">도장${s.confirm ? ' 켬' : ''}</button>
    ${recBtns('s:' + s.id, '이름 녹음')}
    <button class="sm warn" data-sdel="${i}">삭제</button>
  </div>`).join('');
  h += `<div class="row"><button class="pri" data-a="sadd" ${state.subjects.length >= 12 ? 'disabled' : ''}>+ 할 일 종류 추가</button><span class="note">최대 12개. "타이머 없음"·"도장"은 새로 넣는 할 일의 기본값입니다.</span></div>`;
  h += `<h3>인사 녹음</h3><p class="note">앱을 열고 처음 만질 때 나오는 인사. 없으면 "오늘은 ○○랑 ○○를 하자!"를 음성 합성으로 읽습니다.</p>${recBtns('greet', '인사 녹음')}`;
  return h + (pv.msg ? `<div class="out">${esc(pv.msg)}</div>` : '');
}
async function toggleRec(key) {
  if (recState.key) { recState.rec?.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { pv.msg = '이 브라우저는 녹음을 지원하지 않습니다.'; renderParent(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream), chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop()); clearTimeout(recState.timer);
      recState = { key: null, rec: null, timer: 0 };
      try { await vPut(key, new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); pv.msg = '녹음했어요. ▶ 듣기로 확인해 보세요.'; playVoice(key); }
      catch { pv.msg = '녹음을 저장하지 못했습니다.'; }
      renderParent();
    };
    recState = { key, rec, timer: setTimeout(() => rec.state !== 'inactive' && rec.stop(), 5000) };
    rec.start(); pv.msg = '녹음 중… 5초 뒤 저절로 멈춥니다.'; renderParent();
  } catch { pv.msg = '마이크를 쓸 수 없습니다. 브라우저에서 마이크 권한을 허용해 주세요.'; renderParent(); }
}

/* --- 달성 --- */
function rate(keys, sid) {
  let t = 0, d = 0;
  keys.forEach(k => (state.days[k]?.missions || []).forEach(m => { if (sid && m.sid !== sid) return; t++; if (m.status === 'done') d++; }));
  return { t, d, p: t ? Math.round(d / t * 100) : null };
}
const pct = r => r.p == null ? '–' : `${r.p}% (${r.d}/${r.t})`;
/* 지난 날: 자정이 지나 오늘 할 일이 새로 나와도, 지난 7일의 할 일을 보고 못 누른 것을 "다 했어"로 처리
   (처리한 만큼 뼈가 쌓이고, 부모 모드를 닫으면 바위가 나옴) */
function tabPast() {
  let h = '<h3>지난 날</h3><p class="note">최근 7일의 할 일입니다. 아이가 하고 나서 못 누른 것을 "다 했어로 처리"하면 뼈 1개가 쌓이고, 부모 모드를 닫으면 바위가 나옵니다.</p>';
  let any = false;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i); const k = keyOf(d), ms = state.days[k]?.missions || [];
    if (!ms.length) continue; any = true;
    const done = ms.filter(m => m.status === 'done').length;
    h += `<h3 style="margin-top:14px">${d.getMonth() + 1}/${d.getDate()} (${'일월화수목금토'[d.getDay()]}) <small style="font-weight:400;color:#8a7760">${done}/${ms.length} 완료</small></h3>`;
    h += ms.map(m => { const s = subj(m.sid);
      return `<div class="pitem"><span class="mini">${ICON[s.icon](s.color)}</span><span class="nm">${esc(s.name)}${m.late ? ' <small style="color:#8a7760">· 나중에 처리</small>' : ''}</span>`
        + (m.status === 'done' ? '<span class="ok">다 했어 ✓</span>' : `<span class="no">${m.status === 'wait' ? '도장 기다림' : '안 함'}</span><button class="sm pri" data-a="pastDone" data-k="${k}" data-id="${m.id}">다 했어로 처리</button>`) + '</div>'; }).join('');
  }
  if (!any) h += '<div class="out">최근 7일 동안 할 일이 없었어요.</div>';
  if (state.dino.pending > 0) h += `<div class="out">쌓인 뼈 ${state.dino.pending}개 — 부모 모드를 닫으면 바위가 나와요.</div>`;
  return h;
}
function tabStats() {
  const today = todayKey(), wk = weekKeys(0).filter(k => k <= today);
  const now = new Date(), mk = Object.keys(state.days).filter(k => k.startsWith(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`));
  const last7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return keyOf(d); });
  let h = `<h3>달성률</h3><table class="grid"><tr><th>오늘</th><th>이번 주</th><th>이번 달</th></tr>
    <tr><td>${pct(rate([today]))}</td><td>${pct(rate(wk))}</td><td>${pct(rate(mk))}</td></tr></table>`;
  h += `<h3>최근 7일</h3><div class="bars">${last7.map(k => { const r = rate([k]); const [, m, d] = k.split('-');
    return `<div><small>${r.t ? r.d + '/' + r.t : ''}</small><span style="height:${r.p == null ? 2 : Math.max(3, r.p)}%;${r.p == null ? 'background:#e6dccb' : ''}"></span>${+m}/${+d}</div>`; }).join('')}</div>`;
  const weeks = [-3, -2, -1, 0].map(o => weekKeys(o).filter(k => k <= today));
  h += `<h3>할 일별 최근 4주</h3><table class="grid"><tr><th>할 일</th><th>3주 전</th><th>2주 전</th><th>지난주</th><th>이번 주</th></tr>
    ${state.subjects.map(s => `<tr><td style="text-align:left"><span class="mini" style="display:inline-block;vertical-align:middle">${ICON[s.icon](s.color)}</span> ${esc(s.name)}</td>${weeks.map(w => `<td>${pct(rate(w, s.id))}</td>`).join('')}</tr>`).join('')}</table>`;
  const L = state.log, tot = L.placeSelf + L.placeAuto, month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  h += `<h3>공룡</h3><div class="out">지금 공룡: ${DINO_NAME[state.dino.kind] || state.dino.kind}${state.dino.name ? ` "${esc(state.dino.name)}"` : ''} · 뼈 ${state.dino.placed}/${PIECE_COUNT}${state.dino.awake ? ` · 깨어남${growSteps() ? ` · 자람 ${Math.min(growOf(state.dino), growSteps())}/${growSteps()}` : ''}` : ''}
완성한 공룡: 모두 ${state.park.length}마리 · 이번 달 ${state.park.filter(p => (p.doneAt || '').startsWith(month)).length}마리
뼈 붙이기: 스스로 ${L.placeSelf}번 / 자동 ${L.placeAuto}번${tot ? ` (스스로 ${Math.round(L.placeSelf / tot * 100)}%)` : ''}
바위 깨기: 스스로 ${L.rockSelf}번 / 자동 ${L.rockAuto}번</div>`;
  return h;
}

/* --- 설정 --- */
function tabSet() {
  const s = state.settings, sel = (c) => c ? ' sel' : '';
  return `<h3>기본 시간</h3><div class="row step"><button data-a="dmin-">−</button><b>${s.defaultMin}분</b><button data-a="dmin+">+</button><span class="note">새로 넣는 할 일의 시간 (5~20분)</span></div>
  <h3>잠자기</h3><div class="row"><button class="${sel(s.sleep)}" data-a="sleep">잠자기 ${s.sleep ? '켜짐' : '꺼짐'}</button>
    <span class="step"><button class="sm" data-a="smin-">−</button><b>${s.sleepMin}분</b><button class="sm" data-a="smin+">+</button></span><span class="note">할 일을 안 하고 이 시간이 지나면 공룡이 잠듭니다</span></div>
  <h3>부모 확인 도장</h3><div class="row"><button class="${sel(s.confirmMode === 'math')}" data-a="cm" data-v="math">두 자리 덧셈</button><button class="${sel(s.confirmMode === 'pin')}" data-a="cm" data-v="pin">부모 비밀번호</button></div>
    <p class="note">형이 대신 풀어 주는 일이 있으면 비밀번호로 바꾸세요.</p>
  <h3>뼈 붙이기</h3><div class="row"><button class="${sel(s.placeMode === 'drag')}" data-a="pm" data-v="drag">끌어다 놓기</button><button class="${sel(s.placeMode === 'tap')}" data-a="pm" data-v="tap">누르면 날아가 붙기</button>
    <button class="${sel(s.skipAwaken)}" data-a="skipAw">깨어남 연출 짧게${s.skipAwaken ? ' 켬' : ''}</button></div>
  <h3>자라기</h3><div class="row">${[0, 2, 4, 6].map(v => `<button class="${sel(growSteps() === v)}" data-a="grow" data-v="${v}">${v ? v + '번' : '끔'}</button>`).join('')}</div>
    <p class="note">깨어난 공룡은 아기로 시작해 할 일을 이 횟수만큼 더 하면 다 큰 공룡이 되고, 그다음 할 일에서 공원으로 갑니다. 한 마리 = 뼈 8개 + 자라기 횟수.</p>
  <h3>소리</h3><div class="row"><button class="${sel(s.sound)}" data-a="sound">효과음 ${s.sound ? '켜짐' : '꺼짐'}</button><button class="${sel(s.voice)}" data-a="voice">안내 목소리 ${s.voice ? '켜짐' : '꺼짐'}</button></div>
  <h3>이름 카드</h3><p class="note">공룡이 깨어나면 아이가 고르는 이름 (그림 카드를 누르면 소리로 들림). 쉼표로 구분, 6개.</p>
    <div class="row"><input type="text" id="namesIn" value="${esc(s.names.join(', '))}" style="flex:1;min-width:240px;font-size:16px;padding:10px;border-radius:10px;border:1px solid #d8c9ad"><button data-a="names">저장</button></div>
  <h3>3D</h3><div class="row"><button class="${sel(s.quality === 'low')}" data-a="q" data-v="low">품질 낮음</button><button class="${sel(s.quality === 'high')}" data-a="q" data-v="high">품질 높음</button>
    <button class="${sel(s.showStats)}" data-a="stats">성능 표시 ${s.showStats ? '켜짐' : '꺼짐'}</button></div><p class="note">품질을 바꾸면 화면을 다시 불러옵니다.</p>
  <h3>비밀번호</h3><div class="row"><button data-a="pinChange">비밀번호 바꾸기</button></div>
  ${pv.msg ? `<div class="out">${esc(pv.msg)}</div>` : ''}`;
}

/* --- 테스트·초기화 --- */
function tabTest() {
  return `<h3>뼈·공룡</h3><div class="row"><button class="pri" data-a="give">뼈 1개 주기</button><button data-a="last">7개 채우고 마지막 1개</button><button data-a="wakePrev">깨어남 연출 보기</button><button data-a="growTest">자라기 1번</button><button data-a="dinoReset">지금 공룡 처음부터</button></div>
  <h3>오늘</h3><div class="row"><button data-a="todayReset">오늘 할 일 다시 만들기</button><button data-a="sleepNow">지금 재우기</button><button data-a="logReset">아이 기록 지우기</button></div>
  <h3>읽어주기 (음성 합성) 테스트</h3><p class="note">① 인터넷이 켜진 상태에서 한 번, ② 와이파이를 끄고 한 번 더. 둘 다 소리가 나면 오프라인 읽어주기가 됩니다.</p>
  <div class="row"><button class="pri" data-a="tts">"양치하자!" 읽어 보기</button></div><div class="out" id="tOut">아직 테스트하지 않았습니다.</div>
  <h3>모든 데이터 지우기</h3><p class="note">공룡 앱의 기록·공룡·할 일·녹음을 지웁니다 (비밀번호는 유지). 형의 몬스터·전차 앱은 건드리지 않습니다.</p>
  <div class="row"><button class="warn" data-a="wipe">${pv.wipeArm && Date.now() - pv.wipeArm < 4000 ? '한 번 더 누르면 지웁니다' : '모든 데이터 지우기'}</button></div>
  ${pv.msg ? `<div class="out">${esc(pv.msg)}</div>` : ''}`;
}
function ttsTest() {
  const out = $('tOut');
  if (!hasTTS) { out.textContent = '이 브라우저는 음성 합성을 지원하지 않습니다. → 부모 녹음을 쓰세요.'; return; }
  pickVoice();
  const ko = voiceInfo.ko, online = navigator.onLine ? '인터넷 연결됨' : '인터넷 끊김';
  out.textContent = `상태: ${online} · 음성 전체 ${voiceInfo.all}개\n한국어 음성:\n${ko.length ? ko.map(v => `· ${v.name} — ${v.localService ? '기기 내장 (오프라인 가능)' : '온라인 전용'}`).join('\n') : '· 한국어 음성이 목록에 없음'}\n\n재생 시도 중…`;
  let started = false;
  const timer = setTimeout(() => { if (!started) out.textContent += '\n→ 3초 안에 시작되지 않았습니다. 소리가 안 났다면 이 상태에서는 읽어주기를 쓸 수 없습니다.'; }, 3000);
  say('양치하자! 뼈를 붙여 볼까?', r => {
    if (r === 'start') { started = true; out.textContent += `\n→ 재생 시작됨 (${online}). 실제로 소리가 들렸는지 확인하세요.`; }
    else if (r.startsWith('error')) { clearTimeout(timer); out.textContent += `\n→ 재생 실패 (${r.slice(6)})`; }
    else if (r === 'end') clearTimeout(timer);
  });
}

/* --- 데이터 --- */
function tabData() {
  return `<h3>내보내기</h3><p class="note">기기를 옮길 때 씁니다. 녹음은 들어가지 않습니다 (새 기기에서 다시 녹음).</p>
  <div class="row"><button class="pri" data-a="export">파일로 저장</button><button data-a="showJson">글자로 보기 (복사용)</button></div>
  <textarea id="jsonOut" readonly placeholder="글자로 보기를 누르면 여기에 나옵니다"></textarea>
  <h3>가져오기</h3><p class="note">지금 데이터를 덮어씁니다 (비밀번호는 지금 것을 유지).</p>
  <div class="row"><input type="file" id="jsonFile" accept=".json,application/json"></div>
  <textarea id="jsonIn" placeholder="또는 여기에 붙여넣기"></textarea>
  <div class="row"><button class="warn" data-a="import">가져오기</button></div>
  ${pv.msg ? `<div class="out">${esc(pv.msg)}</div>` : ''}`;
}
function importJSON(text) {
  let s; try { s = JSON.parse(text); } catch { pv.msg = 'JSON 형식이 아닙니다.'; return false; }
  if (!s || !s.dino || !Array.isArray(s.subjects)) { pv.msg = '공룡 앱 데이터가 아닙니다 (dino·subjects 없음).'; return false; }
  const keepPin = state.settings.pinHash;
  localStorage.setItem(KEY, JSON.stringify(s)); state = load(); state.settings.pinHash = keepPin; save();
  location.reload(); return true;
}

/* --- 부모 모드 클릭 처리 --- */
const bumpMin = (v, d) => clamp(v + d * 5, 5, 20);
$('pbody').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const a = t.dataset.a; pv.msg = '';
  // 할 일 항목 편집
  const item = t.closest('.item');
  if (item && a) {
    const list = listFor(item.dataset.w), i = +item.dataset.i, p = list[i];
    Object.assign(p, fullItem(p));
    if (a === 'del') list.splice(i, 1);
    if (a === 'min-' || a === 'min+') p.min = bumpMin(p.min, a === 'min+' ? 1 : -1);
    if (a === 'timer') p.noTimer = !p.noTimer;
    if (a === 'confirm') p.confirm = !p.confirm;
    planChanged(); return;
  }
  if (t.dataset.add) { const list = listFor(t.dataset.w); if (list.length < MAX_PER_DAY) list.push(itemFor(t.dataset.add)); pv.pickFor = null; planChanged(); return; }
  if (a === 'pastDone') {
    const m = (state.days[t.dataset.k]?.missions || []).find(x => x.id === t.dataset.id);
    if (m && m.status !== 'done') { m.status = 'done'; m.doneAt = Date.now(); m.late = true; state.dino.pending++; pv.pastGiven = true; save(); }
    renderParent(); return;
  }
  if (a === 'pick') { pv.pickFor = t.dataset.w; renderParent(); return; }
  if (a === 'pickclose') { pv.pickFor = null; renderParent(); return; }
  if (a === 'mode') { pv.planMode = t.dataset.v; pv.pickFor = null; renderParent(); return; }
  if (a === 'wk-' || a === 'wk+') { pv.weekOff += a === 'wk+' ? 1 : -1; pv.pickFor = null; renderParent(); return; }
  if (a === 'unown') { delete state.overrides[t.dataset.k]; planChanged(); return; }
  if (a === 'copyLast') { const prev = weekKeys(pv.weekOff - 1), cur = weekKeys(pv.weekOff); cur.forEach((k, i) => { state.overrides[k] = planFor(prev[i]).map(p => ({ ...p })); }); pv.msg = '지난주 할 일을 이번 주에 복사했어요.'; planChanged(); return; }
  if (a === 'toWeekly') { weekKeys(pv.weekOff).forEach(k => delete state.overrides[k]); pv.msg = '이번 주를 반복 일정으로 되돌렸어요.'; planChanged(); return; }
  if (a === 'clearWeek') { weekKeys(pv.weekOff).forEach(k => { state.overrides[k] = []; }); pv.msg = '이번 주를 비웠어요 (모두 쉬는 날). 끝낸 할 일은 남습니다.'; planChanged(); return; }
  // 할 일 종류
  const si = t.dataset.si != null ? +t.dataset.si : null;
  if (t.dataset.icon) { state.subjects[si].icon = t.dataset.icon; save(); renderParent(); return; }
  if (t.dataset.color) { state.subjects[si].color = t.dataset.color; save(); renderParent(); return; }
  if (t.dataset.snt) { const s = state.subjects[+t.dataset.snt]; s.noTimer = !s.noTimer; save(); renderParent(); return; }
  if (t.dataset.scf) { const s = state.subjects[+t.dataset.scf]; s.confirm = !s.confirm; save(); renderParent(); return; }
  if (t.dataset.sdel) {
    if (state.subjects.length <= 1) { pv.msg = '하나는 남겨 두어야 합니다.'; renderParent(); return; }
    const [s] = state.subjects.splice(+t.dataset.sdel, 1);
    Object.values(state.weekly).forEach(l => { for (let i = l.length - 1; i >= 0; i--) if (l[i].sid === s.id) l.splice(i, 1); });
    Object.values(state.overrides).forEach(l => { for (let i = l.length - 1; i >= 0; i--) if (l[i].sid === s.id) l.splice(i, 1); });
    vDel('s:' + s.id); planChanged(); return;
  }
  if (a === 'sadd') { state.subjects.push({ id: 'u' + uid(), name: '새 할 일', icon: 'etc', color: PALETTE[state.subjects.length % PALETTE.length], noTimer: false, confirm: false }); save(); renderParent(); return; }
  if (t.dataset.rec) { toggleRec(t.dataset.rec); return; }
  if (t.dataset.play) { playVoice(t.dataset.play); return; }
  if (t.dataset.vdel) { await vDel(t.dataset.vdel); renderParent(); return; }
  // 설정
  const S = state.settings;
  if (a === 'dmin-' || a === 'dmin+') S.defaultMin = bumpMin(S.defaultMin, a === 'dmin+' ? 1 : -1);
  if (a === 'sleep') S.sleep = !S.sleep;
  if (a === 'smin-' || a === 'smin+') S.sleepMin = clamp(S.sleepMin + (a === 'smin+' ? 1 : -1), 1, 10);
  if (a === 'cm') S.confirmMode = t.dataset.v;
  if (a === 'pm') S.placeMode = t.dataset.v;
  if (a === 'skipAw') S.skipAwaken = !S.skipAwaken;
  if (a === 'grow') { S.growSteps = +t.dataset.v; save(); applyVisibility(); }
  if (a === 'sound') S.sound = !S.sound;
  if (a === 'voice') S.voice = !S.voice;
  if (a === 'stats') { S.showStats = !S.showStats; statsEl.classList.toggle('hidden', !S.showStats); }
  if (a === 'names') { const n = $('namesIn').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 6); if (n.length) { S.names = n; pv.msg = '이름 카드를 저장했어요.'; } }
  if (a === 'q' && S.quality !== t.dataset.v) { S.quality = t.dataset.v; save(); location.reload(); return; }
  if (a === 'pinChange') { askPin(() => { pv.msg = '비밀번호를 바꿨어요.'; renderParent(); }, true); return; }
  // 테스트
  if (a === 'give') { closeParent(); if (phase === 'idle' && !decoOn) { if (state.dino.awake) newDino(() => setTimeout(() => spawnRock(), 700)); else setTimeout(() => spawnRock(), 350); } else { state.dino.pending++; save(); } return; }
  if (a === 'last') { clearPlay(); Object.assign(state.dino, { placed: PIECE_COUNT - 1, awake: false, pending: 0, inPlay: false }); save(); applyVisibility(); closeParent(); setTimeout(() => spawnRock(), 350); return; }
  if (a === 'growTest') { if (!state.dino.awake) pv.msg = '깨어난 공룡이 있을 때만 됩니다.'; else { closeParent(); setTimeout(() => missionDone(), 300); return; } }
  if (a === 'wakePrev') { clearPlay(); Object.assign(state.dino, { placed: PIECE_COUNT, awake: false, pending: 0, inPlay: false }); save(); applyVisibility(); closeParent(); setTimeout(startAwaken, 350); return; }
  if (a === 'dinoReset') { clearPlay(); Object.assign(state.dino, { placed: 0, awake: false, pending: 0, inPlay: false }); save(); applyVisibility(); pv.msg = '지금 공룡을 뼈 0개로 돌렸어요.'; }
  if (a === 'todayReset') { const day = ensureToday(); day.missions = []; delete state.days[todayKey()]; ensureToday(); pv.msg = '오늘 할 일을 일정대로 다시 만들었어요.'; }
  if (a === 'sleepNow') { closeParent(); lastBusy = -Infinity; return; }
  if (a === 'logReset') { state.log = defaultState().log; pv.msg = '아이 기록을 지웠어요.'; }
  if (a === 'tts') { ttsTest(); return; }
  if (a === 'wipe') {
    if (!pv.wipeArm || Date.now() - pv.wipeArm > 4000) { pv.wipeArm = Date.now(); renderParent(); return; }
    const keepPin = S.pinHash; localStorage.removeItem(KEY); await vClear();       // 자기 키만 지움 (형 앱 데이터 유지)
    state = defaultState(); state.settings.pinHash = keepPin; save(); location.reload(); return;
  }
  // 데이터
  if (a === 'export') {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `dinoPlanner-${todayKey()}.json`;
    document.body.appendChild(l); l.click(); setTimeout(() => { URL.revokeObjectURL(l.href); l.remove(); }, 1000); return;
  }
  if (a === 'showJson') { $('jsonOut').value = JSON.stringify(state, null, 2); return; }
  if (a === 'import') {
    const f = $('jsonFile').files?.[0];
    const text = f ? await f.text() : $('jsonIn').value;
    if (!text.trim()) { pv.msg = '파일을 고르거나 글자를 붙여넣어 주세요.'; renderParent(); return; }
    if (!importJSON(text)) renderParent(); return;
  }
  save(); renderParent();
});
$('pbody').addEventListener('change', e => {
  const n = e.target.dataset.name; if (n == null) return;
  const v = e.target.value.trim(); if (v) { state.subjects[+n].name = v.slice(0, 12); save(); }
});

/* ---------- 시작 ---------- */
statsEl.classList.toggle('hidden', !state.settings.showStats);
ensureToday(); renderHome();
applyVisibility();
resize(); start();
// 첫 실행: 선물 뼈 1개 (설명 없이 방법 익히기). 앱을 닫았다 열어도 받던 뼈는 다시 나옴
const giftOrResume = () => { if (!state.dino.awake && state.dino.placed < PIECE_COUNT && (!state.dino.giftGiven || state.dino.inPlay)) { state.dino.giftGiven = true; save(); setTimeout(() => spawnRock(), 900); } };
if (!state.dino.chosen && !state.dino.awake && state.dino.placed === 0) setTimeout(() => chooseDino(giftOrResume), 500);
else if (state.dino.awake && !state.dino.name) setTimeout(openDeco, 600);
else giftOrResume();
// 하는 중이던 할 일이 있으면 이어서 (새로고침·앱 전환 뒤)
if (state.focus) { const m = findMission(state.focus.mid); if (m && m.status === 'todo') setTimeout(() => openDoing(m, true), 300); else { state.focus = null; save(); } }
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});

// 확인용 (브라우저 콘솔)
window.__dino = { size: () => +models[curKind].group.scale.x.toFixed(3), growing: () => !!growAnim, rock, camera, renderer, useKind: k => { state.dino.kind = k; applyVisibility(); }, openPark, capture, chooseDino, state: () => state, phase: () => phase, sleeping: () => sleeping, poke: t => { lastBusy = t; }, spawnRock, startAwaken, toScreen, ROCK_POS, floatCenterWorld: () => fl.obj && floatCenterWorld(), slotCenterWorld,
  tris: () => { const all = o => { let n = o.isMesh ? (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 : 0; o.children.forEach(c => n += all(c)); return n; };
    return Object.fromEntries(KINDS.map(k => { const ps = models[k].pieces; return [k, { bone: ps.reduce((n, p) => n + all(p.bone), 0), skin: ps.reduce((n, p) => n + all(p.skin), 0) }]; })); } };
})();
