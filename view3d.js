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
  const draw = (title, status, color) => {
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "rgba(12,14,20,0.78)";
    const r = 28, w = c.width, h = c.height;
    g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.quadraticCurveTo(w, 0, w, r); g.lineTo(w, h - r); g.quadraticCurveTo(w, h, w - r, h); g.lineTo(r, h); g.quadraticCurveTo(0, h, 0, h - r); g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.fill();
    g.fillStyle = color || "#ffb020"; g.fillRect(0, 0, 14, h);
    g.fillStyle = "#f3f1ec"; g.font = "700 60px Pretendard, 'Malgun Gothic', sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillText(title, 40, 58);
    g.fillStyle = color || "#cfd3da"; g.font = "600 44px Pretendard, 'Malgun Gothic', sans-serif";
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

class PlanView3D {
  constructor(container, plan) {
    this.plan = plan; this.container = container;
    const xs = plan.meshes.flatMap(m => [m[0], m[1]]), ys = plan.meshes.flatMap(m => [m[2], m[3]]);
    this.minx = Math.min(...xs); this.maxx = Math.max(...xs); this.miny = Math.min(...ys); this.maxy = Math.max(...ys);
    this.cx = (this.minx + this.maxx) / 2; this.cy = (this.miny + this.maxy) / 2;
    const span = Math.max(this.maxx - this.minx, this.maxy - this.miny);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1117);
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

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2e0, 0.9);
    sun.position.set(span * 0.5, span * 1.2, span * 0.4); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -span; sc.right = sc.top = span; sc.near = 0.5; sc.far = span * 4;
    scene.add(sun);

    this.X = x => x - this.cx; this.Z = y => -(y - this.cy);   // FDS(x, y북) → three(x, -z)
    this.rooms = {}; this.doors = {}; this.wins = {};
    this.build();
    this.clock = new THREE.Clock();
    this.running = true;
    this.resize();
    window.addEventListener("resize", () => this.resize());
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
    const matFloor = new THREE.MeshStandardMaterial({ color: 0xd8cdb6, roughness: 0.95 });
    const matWall = new THREE.MeshStandardMaterial({ color: 0xece8e0, roughness: 0.8 });
    const matBlock = new THREE.MeshStandardMaterial({ color: 0x7d838e, roughness: 0.9 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2 });
    const matGlassOpen = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.15, roughness: 0.1 });
    const matDoor = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.7 });
    // 바닥 + 바깥 땅
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 1 }));
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
      const panel = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.05, WALL_H, alongX ? 0.05 : len), matDoor);
      panel.castShadow = true;
      panel.position.set(alongX ? len / 2 : 0, WALL_H / 2, alongX ? 0 : -len / 2);
      g.add(panel);
      g.position.set(this.X(alongX ? x1 : (x1 + x2) / 2), 0, this.Z(alongX ? (y1 + y2) / 2 : y2));
      scene.add(g);
      this.doors[r] = { g, openAngle: alongX ? -1.3 : 1.3 };
    }
    // 창: 유리판
    for (const r in p.windows) {
      const [x1, x2, y1, y2] = p.windows[r];
      const alongX = Math.abs(x2 - x1) > Math.abs(y2 - y1);
      const m = alongX ? this.box(x1, x2, y1 - 0.05, y2 + 0.05, 0.3, WALL_H + 0.3, matGlass, false)
                       : this.box(x1 - 0.05, x2 + 0.05, y1, y2, 0.3, WALL_H + 0.3, matGlass, false);
      m.userData.mats = [matGlass, matGlassOpen];
      this.wins[r] = m;
    }
    // 방: 바닥 색 + 연기 슬래브 + 라벨
    for (const r in p.rooms) {
      const [x1, x2, y1, y2] = p.rooms[r];
      const tint = this.box(x1 + 0.05, x2 - 0.05, y1 + 0.05, y2 - 0.05, 0.005, 0.02,
        new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.22 }), false);
      const smoke = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1 - 0.1, 1, y2 - y1 - 0.1),
        new THREE.MeshStandardMaterial({ color: 0x23252b, transparent: true, opacity: 0, roughness: 1 }));
      smoke.position.set(this.X((x1 + x2) / 2), CEIL, this.Z((y1 + y2) / 2)); smoke.visible = false;
      scene.add(smoke);
      const [cx, cy] = p.centers[r];
      const label = textSprite([p.room_ko[r], "안전"], { color: "#2dd4bf" });
      label.position.set(this.X(cx), WALL_H + 0.75, this.Z(cy));
      scene.add(label);
      this.rooms[r] = { tint, smoke, label, size: [x2 - x1 - 0.1, y2 - y1 - 0.1] };
    }
    // 화원
    const fire = this.fire = new THREE.Group(); fire.visible = false;
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x3a2a22, emissive: 0xff4a10, emissiveIntensity: 0.8, roughness: 0.6 }));
    core.position.y = 0.2; core.castShadow = true; fire.add(core);
    const ftex = flameTexture();
    this.flames = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.set((Math.random() - .5) * 0.3, 0.5 + i * 0.12, (Math.random() - .5) * 0.3);
      s.scale.set(0.8, 1.0, 1); fire.add(s); this.flames.push(s);
    }
    const light = this.fireLight = new THREE.PointLight(0xff7a30, 1.4, 9, 2); light.position.y = 0.8; fire.add(light);
    scene.add(fire);
    // AI 추정 화원 표시(실시간 모드): 바닥의 고리
    const ring = this.aiRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 10, 48), new THREE.MeshBasicMaterial({ color: 0xff6a3d }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; ring.visible = false; scene.add(ring);
  }

  setFire(room, spot) {
    if (room == null) { this.fire.visible = false; return; }
    const [fx, fy] = this.plan.fire[room][spot];
    this.fire.position.set(this.X(fx + 0.3), 0, this.Z(fy + 0.3)); this.fire.visible = true;
  }
  setDoor(room, open) { const d = this.doors[room]; if (d) d.g.rotation.y = open ? d.openAngle : 0; }
  setWindow(room, open) { const w = this.wins[room]; if (w) w.material = w.userData.mats[open ? 1 : 0]; }
  setAIMarker(room) {
    if (!room) { this.aiRing.visible = false; return; }
    const [cx, cy] = this.plan.centers[room];
    this.aiRing.position.set(this.X(cx), 0.06, this.Z(cy)); this.aiRing.visible = true;
  }
  // level: 0 안전 … 1 피난 불가 (연기 슬래브 두께·바닥 색)
  setRoom(r, color, text, level = 0) {
    const o = this.rooms[r]; if (!o) return;
    o.tint.material.color.set(color); o.tint.material.opacity = 0.18 + 0.3 * level;
    o.label.userData.update(this.plan.room_ko[r], text, color);
    const depth = level < 0.03 ? 0 : 0.1 + 1.9 * Math.min(1, level);
    o.smoke.visible = depth > 0;
    if (depth > 0) {
      o.smoke.scale.set(1, depth, 1); o.smoke.position.y = CEIL - depth / 2;
      o.smoke.material.opacity = 0.25 + 0.55 * Math.min(1, level);
    }
  }
  resize() {
    const w = this.container.clientWidth || 800, h = Math.round(w * 10 / 16);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = h + "px";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  tick() {
    const t = this.clock.getElapsedTime();
    if (this.fire.visible) {
      this.flames.forEach((s, i) => { const k = t * 9 + i * 1.7; s.scale.set(0.7 + 0.25 * Math.sin(k), 0.9 + 0.35 * Math.abs(Math.sin(k * 0.7)), 1); s.position.y = 0.45 + i * 0.12 + 0.1 * Math.sin(k * 1.3); });
      this.fireLight.intensity = 1.2 + 0.5 * Math.sin(t * 17) * Math.sin(t * 7);
    }
    if (this.aiRing.visible) { const s = 1 + 0.12 * Math.sin(t * 4); this.aiRing.scale.set(s, s, 1); }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.running = false; this.renderer.dispose(); }
}
