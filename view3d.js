// 3D 평면 보기 (three.js r128 + OrbitControls). 마우스 드래그로 집 가운데를 중심으로 회전, 휠로 확대.
// 벽은 허리 높이(1.15 m)에서 잘라 그려 방 안이 보이게 함(건축 모형식). 연기 슬래브·바닥 색은 '상태 표현'이지 시뮬레이션 실측이 아님.
"use strict";

const WALL_H = 1.15, CEIL = 2.4, T_WALL = 0.12;

// 격자 덩어리(직사각형)들의 바깥 테두리 선분: 다른 덩어리와 맞닿은 부분은 뺀다
function outlineSegments(meshes) {
  const segs = [];   // {axis:'x'|'y', at, a, b}  axis='x' → y=at 고정, x가 a..b
  const EPS = 1e-6;
  const subtract = (a, b, cuts) => {
    let parts = [[a, b]];
    for (const [c1, c2] of cuts) {
      const next = [];
      for (const [p, q] of parts) {
        if (c2 <= p + EPS || c1 >= q - EPS) { next.push([p, q]); continue; }
        if (c1 > p + EPS) next.push([p, c1]);
        if (c2 < q - EPS) next.push([c2, q]);
      }
      parts = next;
    }
    return parts;
  };
  meshes.forEach((m, i) => {
    const [x1, x2, y1, y2] = m;
    const others = meshes.filter((_, j) => j !== i);
    // 아래/위 변 (y = y1 / y2): 다른 덩어리가 그 선에서 맞닿으면 그 x구간 제외
    for (const [at, side] of [[y1, "bottom"], [y2, "top"]]) {
      const cuts = others.filter(o => Math.abs((side === "bottom" ? o[3] : o[2]) - at) < EPS).map(o => [o[0], o[1]]);
      for (const [a, b] of subtract(x1, x2, cuts)) segs.push({ axis: "x", at, a, b });
    }
    for (const [at, side] of [[x1, "left"], [x2, "right"]]) {
      const cuts = others.filter(o => Math.abs((side === "left" ? o[1] : o[0]) - at) < EPS).map(o => [o[2], o[3]]);
      for (const [a, b] of subtract(y1, y2, cuts)) segs.push({ axis: "y", at, a, b });
    }
  });
  return segs;
}

// 벽 직사각형에서 문 구멍을 뺀다 (벽의 긴 축을 따라 나눔)
function cutDoors(rect, doors) {
  let parts = [rect];
  for (const d of doors) {
    const next = [];
    for (const r of parts) {
      const [x1, x2, y1, y2] = r, [dx1, dx2, dy1, dy2] = d;
      const overlap = dx1 < x2 && dx2 > x1 && dy1 < y2 && dy2 > y1;
      if (!overlap) { next.push(r); continue; }
      if ((x2 - x1) >= (y2 - y1)) {        // 벽이 x방향으로 김 → x로 나눔
        if (dx1 > x1) next.push([x1, dx1, y1, y2]);
        if (dx2 < x2) next.push([dx2, x2, y1, y2]);
      } else {
        if (dy1 > y1) next.push([x1, x2, y1, dy1]);
        if (dy2 < y2) next.push([x1, x2, dy2, y2]);
      }
    }
    parts = next;
  }
  return parts;
}

function textSprite(lines, opts = {}) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 176;
  const g = c.getContext("2d");
  // 방 라벨: 흰(테마의 카드색) 칩, 왼쪽 띠와 상태 글자만 상태색 (DESIGN.md: 색은 데이터에만)
  const tc = (v, f) => (typeof PlanView3D !== "undefined" ? PlanView3D.themeColor(v, f) : f);
  const draw = (title, status, color) => {
    g.clearRect(0, 0, c.width, c.height);
    const r = 16, w = c.width, h = c.height;
    const path = () => { g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.quadraticCurveTo(w, 0, w, r); g.lineTo(w, h - r); g.quadraticCurveTo(w, h, w - r, h); g.lineTo(r, h); g.quadraticCurveTo(0, h, 0, h - r); g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.closePath(); };
    g.fillStyle = tc("--card", "#ffffff"); g.globalAlpha = 0.94; path(); g.fill(); g.globalAlpha = 1;
    g.strokeStyle = tc("--line", "#e3e6e9"); g.lineWidth = 3; path(); g.stroke();
    g.fillStyle = color || tc("--dim", "#8b8f94"); g.fillRect(0, 0, 14, h);
    g.fillStyle = tc("--ink", "#131416"); g.font = "600 58px 'IBM Plex Sans KR', 'Malgun Gothic', sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillText(title, 40, 58);
    g.fillStyle = color || tc("--muted", "#5d5f60"); g.font = "500 44px 'IBM Plex Sans KR', 'Malgun Gothic', sans-serif";
    g.fillText(status, 40, 124);
  };
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2.1, 2.1 * c.height / c.width, 1);
  sp.renderOrder = 10;
  sp.userData.update = (title, status, color) => { draw(title, status, color); tex.needsUpdate = true; };
  sp.userData.update(lines[0], lines[1] || "", opts.color);
  return sp;
}

function flameTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 76, 4, 64, 64, 60);
  grd.addColorStop(0, "rgba(255,245,200,1)"); grd.addColorStop(0.35, "rgba(255,150,40,0.9)"); grd.addColorStop(0.7, "rgba(230,60,20,0.45)"); grd.addColorStop(1, "rgba(120,20,10,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// 연기층 텍스처: 이어 붙여도 티 안 나는 값 잡음(4옥타브) → 밝기·알파. 한 번 만들어 모든 방·보기에서 공유
let _smokeTex = null;
function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  const size = 256, c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), img = g.createImageData(size, size);
  const octs = [];
  for (let o = 0; o < 4; o++) { const n = 4 << o, grid = new Float32Array(n * n); for (let i = 0; i < grid.length; i++) grid[i] = Math.random(); octs.push({ n, grid }); }
  const sample = (grid, n, u, v) => {
    const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => grid[(j % n) * n + (i % n)];
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 0.5, sum = 0;
    for (const o of octs) { v += amp * sample(o.grid, o.n, x / size, y / size); sum += amp; amp *= 0.5; }
    v /= sum;
    const a = Math.min(1, Math.max(0, (v - 0.3) / 0.45));
    const i = (y * size + x) * 4, shade = 44 + 70 * v;
    img.data[i] = shade; img.data[i + 1] = shade + 2; img.data[i + 2] = shade + 8; img.data[i + 3] = Math.round(255 * (0.3 + 0.7 * a));
  }
  g.putImageData(img, 0, 0);
  _smokeTex = new THREE.CanvasTexture(c);
  _smokeTex.wrapS = _smokeTex.wrapT = THREE.RepeatWrapping; _smokeTex.encoding = THREE.sRGBEncoding;
  return _smokeTex;
}

// 연기 뭉치(화원에서 피어오르는 입자) 텍스처: 가장자리가 부드러운 원
let _puffTex = null;
function puffTexture() {
  if (_puffTex) return _puffTex;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grd.addColorStop(0, "rgba(255,255,255,0.9)"); grd.addColorStop(0.45, "rgba(255,255,255,0.45)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  _puffTex = new THREE.CanvasTexture(c); _puffTex.encoding = THREE.sRGBEncoding;
  return _puffTex;
}

const N_LAYER = 5;   // 방마다 쌓는 연기 판 수 (천장 → 연기층 아랫면)

class PlanView3D {
  constructor(container, plan) {
    this.plan = plan; this.container = container;
    const xs = plan.meshes.flatMap(m => [m[0], m[1]]), ys = plan.meshes.flatMap(m => [m[2], m[3]]);
    this.minx = Math.min(...xs); this.maxx = Math.max(...xs); this.miny = Math.min(...ys); this.maxy = Math.max(...ys);
    this.cx = (this.minx + this.maxx) / 2; this.cy = (this.miny + this.maxy) / 2;
    const span = Math.max(this.maxx - this.minx, this.maxy - this.miny);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(PlanView3D.themeColor("--scene-bg", "#1f2635"));
    const cam = this.camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.1, 200);
    cam.position.set(span * 0.12, span * 0.8, span * 0.9);
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.innerHTML = ""; container.appendChild(renderer.domElement);
    const ctl = this.controls = new THREE.OrbitControls(cam, renderer.domElement);
    ctl.target.set(0, 0.5, 0); ctl.enableDamping = true; ctl.dampingFactor = 0.08;
    ctl.maxPolarAngle = Math.PI / 2 - 0.06; ctl.minDistance = 3; ctl.maxDistance = span * 3.5;
    ctl.enablePan = false;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc8ccd0, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2e0, 0.9);
    sun.position.set(span * 0.5, span * 1.2, span * 0.4); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -span; sc.right = sc.top = span; sc.near = 0.5; sc.far = span * 4;
    scene.add(sun);

    this.X = x => x - this.cx; this.Z = y => -(y - this.cy);   // FDS(x, y북) → three(x, -z)
    this.rooms = {}; this.doors = {}; this.wins = {}; this.pickables = [];
    this.build();
    // 클릭(드래그가 아닌 짧은 누름)으로 방·문·창·화원 고르기 → onPick({kind, room, x, y}); 올리면 강조
    this.onPick = null; this.hover = null;
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2();
    const dom = renderer.domElement; let down = null;
    dom.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    dom.addEventListener("pointerup", e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
      if (moved > 6 || dt > 600) return;
      const hit = this.pickAt(e);
      if (hit && this.onPick) this.onPick({ ...hit.userData.pick, x: e.clientX, y: e.clientY });
    });
    dom.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") return; this.setHover(this.pickAt(e)); });
    dom.addEventListener("pointerleave", () => this.setHover(null));
    this.clock = new THREE.Clock();
    this.running = true;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    document.addEventListener("fullscreenchange", this._onResize);
    const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.tick(); };
    loop();
  }

  box(x1, x2, y1, y2, z1, z2, mat, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, z2 - z1, y2 - y1), mat);
    m.position.set(this.X((x1 + x2) / 2), (z1 + z2) / 2, this.Z((y1 + y2) / 2));
    m.castShadow = shadow; m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  build() {
    const p = this.plan, scene = this.scene;
    const matFloor = new THREE.MeshStandardMaterial({ color: 0xe9eaec, roughness: 0.95 });
    const matWall = new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.8 });
    const matBlock = new THREE.MeshStandardMaterial({ color: 0x7d838e, roughness: 0.9 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0x7fb0e8, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2 });
    const matGlassOpen = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.15, roughness: 0.1 });
    const matDoor = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.7 });
    // 바닥 + 바깥 땅
    const ground = this.ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: PlanView3D.themeColor("--scene-ground", "#28303f"), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    for (const m of p.meshes) this.box(m[0], m[1], m[2], m[3], -0.06, 0, matFloor, false);
    // 바깥벽
    for (const s of outlineSegments(p.meshes)) {
      if (s.axis === "x") this.box(s.a - T_WALL / 2, s.b + T_WALL / 2, s.at - T_WALL / 2, s.at + T_WALL / 2, 0, WALL_H, matWall);
      else this.box(s.at - T_WALL / 2, s.at + T_WALL / 2, s.a - T_WALL / 2, s.b + T_WALL / 2, 0, WALL_H, matWall);
    }
    // 안쪽 벽(문 구멍 뺌)·막힌 공간
    const doorRects = Object.values(p.doors);
    for (const s of p.solids) {
      if (s.wall) for (const r of cutDoors(s.xb, doorRects)) this.box(r[0], r[1], r[2], r[3], 0, WALL_H, matWall);
      else {
        this.box(s.xb[0], s.xb[1], s.xb[2], s.xb[3], 0, WALL_H * 0.75, matBlock);
        if (s.ko) {
          const sp = textSprite([s.ko, ""], { color: "#9aa0ab" }); sp.scale.multiplyScalar(0.55);
          sp.position.set(this.X((s.xb[0] + s.xb[1]) / 2), WALL_H * 0.75 + 0.25, this.Z((s.xb[2] + s.xb[3]) / 2)); scene.add(sp);
        }
      }
    }
    // 문: 경첩 축(group)에 문짝을 달아 열림/닫힘 회전
    for (const r in p.doors) {
      const [x1, x2, y1, y2] = p.doors[r];
      const alongX = (x2 - x1) >= (y2 - y1);
      const len = alongX ? x2 - x1 : y2 - y1;
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.05, WALL_H, alongX ? 0.05 : len), matDoor.clone());
      panel.castShadow = true; panel.userData.pick = { kind: "door", room: r }; this.pickables.push(panel);
      panel.position.set(alongX ? len / 2 : 0, WALL_H / 2, alongX ? 0 : -len / 2);
      g.add(panel);
      g.position.set(this.X(alongX ? x1 : (x1 + x2) / 2), 0, this.Z(alongX ? (y1 + y2) / 2 : y2));
      scene.add(g);
      this.doors[r] = { g, openAngle: alongX ? -1.3 : 1.3, target: 0 };
    }
    // 창: 유리판
    for (const r in p.windows) {
      const [x1, x2, y1, y2] = p.windows[r];
      const alongX = Math.abs(x2 - x1) > Math.abs(y2 - y1);
      const m = alongX ? this.box(x1, x2, y1 - 0.05, y2 + 0.05, 0.3, WALL_H + 0.3, matGlass, false)
                       : this.box(x1 - 0.05, x2 + 0.05, y1, y2, 0.3, WALL_H + 0.3, matGlass, false);
      m.userData.mats = [matGlass.clone(), matGlassOpen.clone()]; m.material = m.userData.mats[0];
      m.userData.pick = { kind: "window", room: r }; this.pickables.push(m);
      this.wins[r] = m;
    }
    // 방: 바닥 색 + 연기층(잡음 무늬 판을 천장부터 여러 장 쌓아 두께·농도 표현, 천천히 흐름) + 라벨
    const stex = smokeTexture();
    for (const r in p.rooms) {
      const [x1, x2, y1, y2] = p.rooms[r];
      const tint = this.box(x1 + 0.05, x2 - 0.05, y1 + 0.05, y2 - 0.05, 0.005, 0.02,
        new THREE.MeshBasicMaterial({ color: 0x1e7b4f, transparent: true, opacity: 0.2 }), false);
      tint.userData.pick = { kind: "room", room: r }; this.pickables.push(tint);
      const layers = [];
      for (let i = 0; i < N_LAYER; i++) {
        const tex = stex.clone(); tex.needsUpdate = true;
        tex.repeat.set((x2 - x1) / 3.2, (y2 - y1) / 3.2); tex.offset.set(Math.random(), Math.random());
        const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1 - 0.1, y2 - y1 - 0.1),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() < 0.5 ? 0 : Math.PI;
        m.position.set(this.X((x1 + x2) / 2), CEIL, this.Z((y1 + y2) / 2));
        m.visible = false; m.renderOrder = 2;
        const ang = Math.random() * Math.PI * 2, sp = 0.012 + Math.random() * 0.014;
        m.userData.drift = [Math.cos(ang) * sp, Math.sin(ang) * sp];
        scene.add(m); layers.push(m);
      }
      const [cx, cy] = p.centers[r];
      const label = textSprite([p.room_ko[r], "안전"], { color: "#1e7b4f" });
      label.position.set(this.X(cx), WALL_H + 0.75, this.Z(cy));
      scene.add(label);
      this.rooms[r] = { tint, layers, label, level: 0, hover: false, size: [x2 - x1 - 0.1, y2 - y1 - 0.1] };
    }
    // 화원
    const fire = this.fire = new THREE.Group(); fire.visible = false;
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x3a2a22, emissive: 0xff4a10, emissiveIntensity: 0.8, roughness: 0.6 }));
    core.position.y = 0.2; core.castShadow = true; fire.add(core);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), new THREE.MeshBasicMaterial({ visible: false }));   // 클릭 영역
    hit.position.y = 0.5; hit.userData.pick = { kind: "fire" }; fire.add(hit); this.pickables.push(hit);
    const ftex = flameTexture();
    this.flames = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.set((Math.random() - .5) * 0.3, 0.5 + i * 0.12, (Math.random() - .5) * 0.3);
      s.scale.set(0.8, 1.0, 1); fire.add(s); this.flames.push(s);
    }
    const light = this.fireLight = new THREE.PointLight(0xff7a30, 1.4, 9, 2); light.position.y = 0.8; fire.add(light);
    // 화원에서 피어오르는 연기 뭉치: 올라가며 커지고 옅어지다 천장에 닿으면 옆으로 퍼짐 (화원 그룹의 자식이라 화원을 가리면 같이 숨음)
    const ptex = puffTexture();
    this.puffs = [];
    for (let i = 0; i < 56; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ptex, transparent: true, opacity: 0, depthWrite: false, color: 0x55585f }));
      s.visible = false; s.userData = { age: -Math.random() * 4.5, life: 0, vx: 0, vz: 0, rot: 0, spin: 0 };
      this.puffReset(s.userData);
      fire.add(s); this.puffs.push(s);
    }
    scene.add(fire);
    // AI 추정 화원 표시(실시간 모드): 바닥의 고리
    const ring = this.aiRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 10, 48), new THREE.MeshBasicMaterial({ color: 0x1b6c80 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; ring.visible = false; scene.add(ring);
  }

  setFire(room, spot) {
    if (room == null) { this.fire.visible = false; return; }
    const [fx, fy] = this.plan.fire[room][spot];
    this.fire.position.set(this.X(fx + 0.3), 0, this.Z(fy + 0.3)); this.fire.visible = true;
  }
  setDoor(room, open) { const d = this.doors[room]; if (d) d.target = open ? d.openAngle : 0; }   // 실제 회전은 tick()에서 부드럽게
  static themeColor(varName, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || fallback;
  }
  // 밝은/어두운 테마 전환 시 배경·바닥 색만 바꿈
  applyTheme() {
    this.scene.background.set(PlanView3D.themeColor("--scene-bg", "#1f2635"));
    this.ground.material.color.set(PlanView3D.themeColor("--scene-ground", "#28303f"));
  }
  setWindow(room, open) { const w = this.wins[room]; if (w) w.material = w.userData.mats[open ? 1 : 0]; }
  setAIMarker(room) {
    if (!room) { this.aiRing.visible = false; return; }
    const [cx, cy] = this.plan.centers[room];
    this.aiRing.position.set(this.X(cx), 0.06, this.Z(cy)); this.aiRing.visible = true;
  }
  puffReset(u) {
    u.life = 3.2 + Math.random() * 1.6;
    u.vx = (Math.random() - .5) * 0.22; u.vz = (Math.random() - .5) * 0.22;
    u.rot = Math.random() * Math.PI * 2; u.spin = (Math.random() - .5) * 0.9;
  }
  // level: 0 안전 … 1 피난 불가 (연기층 두께·농도, 바닥 색). 연기층은 그 방 천장 온도로 정한 '상태 표현'
  pickAt(e) {
    const rc = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    const hits = this.ray.intersectObjects(this.pickables.filter(o => o.visible && o.parent.visible), false);
    return hits.length ? hits[0].object : null;
  }
  setHover(obj) {
    if (obj === this.hover) return;
    if (this.hover) this.highlight(this.hover, false);
    this.hover = obj; this.renderer.domElement.style.cursor = obj ? "pointer" : "";
    if (obj) this.highlight(obj, true);
  }
  highlight(obj, on) {
    const pk = obj.userData.pick;
    if (pk.kind === "room") { const o = this.rooms[pk.room]; o.hover = on; o.tint.material.opacity = 0.18 + 0.3 * o.level + (on ? 0.25 : 0); }
    else if (obj.material && obj.material.emissive) obj.material.emissive.set(on ? 0x7a4a1a : 0x000000);
  }
  setRoom(r, color, text, level = 0) {
    const o = this.rooms[r]; if (!o) return;
    o.level = level;
    o.tint.material.color.set(color); o.tint.material.opacity = 0.18 + 0.3 * level + (o.hover ? 0.25 : 0);
    o.label.userData.update(this.plan.room_ko[r], text, color);
    const lv = Math.min(1, level), show = level >= 0.02;
    const depth = 0.12 + 1.9 * lv;
    o.layers.forEach((m, i) => {
      m.visible = show; if (!show) return;
      const f = i / (N_LAYER - 1);                       // 0 천장 … 1 연기층 아랫면
      m.position.y = CEIL - depth * f;
      m.material.opacity = (0.28 + 0.52 * lv) * (1 - 0.5 * f);
    });
  }
  resize() {
    const fs = document.fullscreenElement && document.fullscreenElement.contains(this.container);
    const w = this.container.clientWidth || 800;
    const h = fs ? Math.max(200, this.container.clientHeight) : Math.round(w * 10 / 16);   // 전체화면이면 주어진 높이를 꽉 채움
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = h + "px";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1), t = this.clock.elapsedTime;
    if (this.fire.visible) {
      this.flames.forEach((s, i) => { const k = t * 9 + i * 1.7; s.scale.set(0.7 + 0.25 * Math.sin(k), 0.9 + 0.35 * Math.abs(Math.sin(k * 0.7)), 1); s.position.y = 0.45 + i * 0.12 + 0.1 * Math.sin(k * 1.3); });
      this.fireLight.intensity = 1.2 + 0.5 * Math.sin(t * 17) * Math.sin(t * 7);
      for (const s of this.puffs) {
        const u = s.userData; u.age += dt;
        if (u.age < 0) { s.visible = false; continue; }
        if (u.age > u.life) { u.age = -Math.random() * 0.5; this.puffReset(u); s.visible = false; continue; }
        const k = u.age / u.life;
        const y = Math.min(CEIL - 0.15, 0.5 + u.age * 0.8);
        const spread = 1 + 2.5 * Math.max(0, u.age - 2.2);     // 천장에 닿은 뒤 옆으로 퍼짐
        s.position.set(u.vx * u.age * spread + Math.sin(u.age * 3 + u.rot) * 0.06, y, u.vz * u.age * spread + Math.cos(u.age * 2.5 + u.rot) * 0.06);
        const sc = 0.35 + 1.15 * k; s.scale.set(sc, sc, 1);
        s.material.opacity = 0.5 * (1 - k) * Math.min(1, u.age * 3);
        s.material.rotation = u.rot + u.age * u.spin;
        s.material.color.setRGB(0.5 - 0.2 * k, 0.42 - 0.14 * k, 0.36 - 0.06 * k);   // 불 근처는 갈색빛, 올라가며 회색
        s.visible = true;
      }
    }
    for (const r in this.rooms) for (const m of this.rooms[r].layers) if (m.visible) { const tex = m.material.map; tex.offset.x += m.userData.drift[0] * dt; tex.offset.y += m.userData.drift[1] * dt; }
    for (const r in this.doors) { const d = this.doors[r]; const cur = d.g.rotation.y; if (Math.abs(d.target - cur) > 1e-3) d.g.rotation.y = cur + (d.target - cur) * Math.min(1, dt * 7); }   // 문 여닫는 동작
    if (this.aiRing.visible) { const s = 1 + 0.12 * Math.sin(t * 4); this.aiRing.scale.set(s, s, 1); }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.running = false; this.renderer.dispose(); window.removeEventListener("resize", this._onResize); document.removeEventListener("fullscreenchange", this._onResize); }
}
