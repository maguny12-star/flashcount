// 사용자 지정 평면: 방을 직접 그리고(격자 0.2 m) 문·창·화원을 놓으면, FDS 정답 없이
//   ① 불난 방: SFPE 상관식 이론값(보수적) — Thomas 플래시오버 열방출률, MQH 상층 온도, Heskestad 플룸으로 연기층 하강(유출 없음)
//   ② 다른 방: 문으로 이어진 거리(홉)에 따라 불난 방 온도를 줄이고 늦춰 넣는 구역 모델 근사
//   ③ 그 온도를 센서 입력처럼 AI에 넣어 실시간 탭과 똑같이 재생 (비교표의 '정답' 자리는 이론값)
// 화면에 '정답 아님·보수적 추정'을 명시한다. 정식 평가는 FDS 사례(유형 A·B·C)에서.
"use strict";

const CUSTOM = (() => {
  const ALPHA = { medium: 0.01172, fast: 0.0469, ultrafast: 0.1876 };   // kW/s²
  const KRC = 0.48 * 1440 * 840;                                          // 석고보드 kρc [W²·s/m⁴·K²]
  const ROLES = [["living", "거실"], ["kitchen", "주방·식당"], ["master", "안방"], ["br1", "침실1"], ["br2", "침실2"], ["corridor", "복도"], ["entry", "현관"]];
  const ROLE_KO = Object.fromEntries(ROLES);
  const SLOT_ORDER = ROLES.map(r => r[0]);
  const ROLE_COLOR = { living: "#f6c89f", kitchen: "#fbe7a1", master: "#c9d8f6", br1: "#d8e8c9", br2: "#cfe3c0", corridor: "#e6e1d8", entry: "#e0d5c3" };
  const G = 0.2, CW = 14.0, CH = 11.0, S = 50, H = 2.4;   // 격자(m), 캔버스 크기(m), px/m, 층고
  const DOOR_L = 0.8, WIN_L = 1.6, WIN_H = 1.2, DOOR_H = 2.0;
  const ed = { rooms: [], doors: [], wins: [], open: [], fire: null, tool: "room", role: "living", growth: "fast", q: 2000, doorOpen: true, winOpen: false };   // open: 벽 없이 트인 경계 ("a|b")
  let root = null, svg = null, drag = null, preview = null, caseSeq = 0;
  const snap = v => Math.round(v / G) * G;
  const r2 = v => Math.round(v * 100) / 100;
  const fmtT = s => s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const css = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);
  const roomOf = role => ed.rooms.find(r => r.role === role);
  const inRect = (r, x, y) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;

  // ── 기하 도우미 ──────────────────────────────────────────────
  const pairKey = (a, b) => [a, b].sort().join("|");
  const isOpen = (a, b) => ed.open.includes(pairKey(a, b));
  // 두 방이 마주 보는 관계: 0.2 m 틈(벽) 또는 0 m(트임). {gap, axis, strip{x1,x2,y1,y2}, span}
  function facing(a, b) {
    const ovY = [Math.max(a.y1, b.y1), Math.min(a.y2, b.y2)], ovX = [Math.max(a.x1, b.x1), Math.min(a.x2, b.x2)];
    const sy = ovY[1] - ovY[0], sx = ovX[1] - ovX[0];
    if (sy > 0.3) {
      if (b.x1 >= a.x2 - 0.05 && b.x1 - a.x2 < 0.25) return { gap: r2(b.x1 - a.x2), axis: "y", strip: { x1: a.x2, x2: b.x1, y1: ovY[0], y2: ovY[1] }, span: sy };
      if (a.x1 >= b.x2 - 0.05 && a.x1 - b.x2 < 0.25) return { gap: r2(a.x1 - b.x2), axis: "y", strip: { x1: b.x2, x2: a.x1, y1: ovY[0], y2: ovY[1] }, span: sy };
    }
    if (sx > 0.3) {
      if (b.y1 >= a.y2 - 0.05 && b.y1 - a.y2 < 0.25) return { gap: r2(b.y1 - a.y2), axis: "x", strip: { x1: ovX[0], x2: ovX[1], y1: a.y2, y2: b.y1 }, span: sx };
      if (a.y1 >= b.y2 - 0.05 && a.y1 - b.y2 < 0.25) return { gap: r2(a.y1 - b.y2), axis: "x", strip: { x1: ovX[0], x2: ovX[1], y1: b.y2, y2: a.y1 }, span: sx };
    }
    return null;
  }
  // 0.2 m 벽 띠 (트인 경계로 지정한 쌍은 제외)
  function wallBetween(a, b) {
    const f = facing(a, b);
    if (!f || Math.abs(f.gap - G) > 0.05 || isOpen(a.role, b.role)) return null;
    return { ...f.strip, axis: f.axis };
  }
  // 벽 없이 통하는 쌍: 맞닿음(틈 0) 또는 '개방' 지정
  function openBetween(a, b) {
    const f = facing(a, b);
    return !!f && (f.gap <= 0.05 || isOpen(a.role, b.role));
  }
  function walls() {
    const out = [];
    for (let i = 0; i < ed.rooms.length; i++) for (let j = i + 1; j < ed.rooms.length; j++) {
      const w = wallBetween(ed.rooms[i], ed.rooms[j]);
      if (w) out.push({ ...w, a: ed.rooms[i].role, b: ed.rooms[j].role });
    }
    return out;
  }
  function opens() {
    const out = [];
    for (let i = 0; i < ed.rooms.length; i++) for (let j = i + 1; j < ed.rooms.length; j++) {
      const a = ed.rooms[i], b = ed.rooms[j], f = facing(a, b);
      if (f && openBetween(a, b)) out.push({ ...f, a: a.role, b: b.role });
    }
    return out;
  }
  // 새 방이 기존 방과 겹치면 겹침이 가장 얇은 쪽을 깎아 0.2 m 벽 간격을 남긴다
  function resolveOverlap(n) {
    for (const o of ed.rooms) {
      if (o.role === n.role) continue;
      const ox = Math.min(n.x2, o.x2 + G) - Math.max(n.x1, o.x1 - G), oy = Math.min(n.y2, o.y2 + G) - Math.max(n.y1, o.y1 - G);
      if (ox <= 0 || oy <= 0) continue;
      const cands = [["x2", o.x1 - G, n.x2 - (o.x1 - G)], ["x1", o.x2 + G, (o.x2 + G) - n.x1], ["y2", o.y1 - G, n.y2 - (o.y1 - G)], ["y1", o.y2 + G, (o.y2 + G) - n.y1]].filter(c => c[2] > 0);
      cands.sort((p, q) => p[2] - q[2]);
      const [k, v] = cands[0]; n[k] = r2(v);
    }
    // 기존 방과 0.6 m 안쪽으로 어긋나게 그리면 0.2 m 벽 간격으로 당겨 붙인다
    for (const o of ed.rooms) {
      if (o.role === n.role) continue;
      const sy = Math.min(n.y2, o.y2) - Math.max(n.y1, o.y1), sx = Math.min(n.x2, o.x2) - Math.max(n.x1, o.x1);
      if (sy > 0.3) { if (n.x1 > o.x2 + 0.05 && n.x1 - o.x2 < 0.6) n.x1 = r2(o.x2 + G); else if (o.x1 > n.x2 + 0.05 && o.x1 - n.x2 < 0.6) n.x2 = r2(o.x1 - G); }
      if (sx > 0.3) { if (n.y1 > o.y2 + 0.05 && n.y1 - o.y2 < 0.6) n.y1 = r2(o.y2 + G); else if (o.y1 > n.y2 + 0.05 && o.y1 - n.y2 < 0.6) n.y2 = r2(o.y1 - G); }
    }
    return n;
  }

  // ── 그리기 ──────────────────────────────────────────────
  function render() {
    if (!svg) return;
    const ns = "http://www.w3.org/2000/svg";
    svg.innerHTML = "";
    const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
    const X = x => x * S, Y = y => (CH - y) * S;
    for (let x = 0; x <= CW + 1e-6; x += 1) el("line", { x1: X(x), y1: 0, x2: X(x), y2: CH * S, stroke: "#c9ced8", "stroke-width": x % 2 ? .5 : 1 });
    for (let y = 0; y <= CH + 1e-6; y += 1) el("line", { x1: 0, y1: Y(y), x2: CW * S, y2: Y(y), stroke: "#c9ced8", "stroke-width": y % 2 ? .5 : 1 });
    for (const r of ed.rooms) {
      el("rect", { x: X(r.x1), y: Y(r.y2), width: (r.x2 - r.x1) * S, height: (r.y2 - r.y1) * S, fill: ROLE_COLOR[r.role], stroke: "#1b1d22", "stroke-width": 3 });
      const t = el("text", { x: X((r.x1 + r.x2) / 2), y: Y((r.y1 + r.y2) / 2) + 5, "text-anchor": "middle", "font-size": 14, "font-weight": 800, fill: "#1b1d22" });
      t.textContent = `${ROLE_KO[r.role]} ${r2(r.x2 - r.x1)}×${r2(r.y2 - r.y1)}`;
    }
    for (const w of walls()) el("rect", { x: X(w.x1), y: Y(w.y2), width: (w.x2 - w.x1) * S, height: (w.y2 - w.y1) * S, fill: "#1b1d22" });
    for (const o of opens()) {   // 트인 경계: 점선
      const s = o.strip, mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      if (o.axis === "y") el("line", { x1: X(mx), y1: Y(s.y1), x2: X(mx), y2: Y(s.y2), stroke: "#8a8f98", "stroke-width": 2, "stroke-dasharray": "6 5" });
      else el("line", { x1: X(s.x1), y1: Y(my), x2: X(s.x2), y2: Y(my), stroke: "#8a8f98", "stroke-width": 2, "stroke-dasharray": "6 5" });
    }
    for (const d of ed.doors) {
      el("rect", { x: X(d.x1), y: Y(d.y2), width: (d.x2 - d.x1) * S, height: (d.y2 - d.y1) * S, fill: "#fff", stroke: "#b8431c", "stroke-width": 1.5 });
      const t = el("text", { x: X((d.x1 + d.x2) / 2), y: Y((d.y1 + d.y2) / 2) + 4, "text-anchor": "middle", "font-size": 11, fill: "#b8431c", "font-weight": 700 }); t.textContent = "문";
    }
    for (const w of ed.wins) el("line", { x1: X(w.x1), y1: Y(w.y1), x2: X(w.x2), y2: Y(w.y2), stroke: "#2f6690", "stroke-width": 7 });
    if (ed.fire) {
      el("rect", { x: X(ed.fire.x), y: Y(ed.fire.y + .6), width: .6 * S, height: .6 * S, fill: "#e8572a", rx: 4 });
      const t = el("text", { x: X(ed.fire.x + .3), y: Y(ed.fire.y + .3) + 4, "text-anchor": "middle", "font-size": 11, fill: "#fff", "font-weight": 700 }); t.textContent = "화원";
    }
    if (preview) el("rect", { x: X(preview.x1), y: Y(preview.y2), width: (preview.x2 - preview.x1) * S, height: (preview.y2 - preview.y1) * S, fill: "rgba(232,85,42,.18)", stroke: "#e8572a", "stroke-dasharray": "6 4", "stroke-width": 2 });
    const note = el("text", { x: 8, y: CH * S - 8, "font-size": 12, fill: "#5f6672" });
    note.textContent = `격자 0.2 m · 캔버스 ${CW}×${CH} m · 도구: ${({ room: "방 그리기(드래그)", door: "문(두 방 사이 벽 클릭)", open: "개방(벽 클릭 → 트임, 다시 클릭 → 벽)", window: "창(바깥쪽 벽 클릭)", fire: "화원(방 안 클릭)", erase: "지우기(클릭)" })[ed.tool]}`;
    updateSide();
  }

  function toM(e) {
    const rc = svg.getBoundingClientRect();
    return { x: (e.clientX - rc.left) / rc.width * CW, y: CH - (e.clientY - rc.top) / rc.height * CH };
  }
  function onDown(e) {
    const p = toM(e);
    if (ed.tool === "room") { drag = { x: snap(p.x), y: snap(p.y) }; preview = null; svg.setPointerCapture(e.pointerId); return; }
    if (ed.tool === "door") return placeDoor(p);
    if (ed.tool === "open") return toggleOpen(p);
    if (ed.tool === "window") return placeWindow(p);
    if (ed.tool === "fire") return placeFire(p);
    if (ed.tool === "erase") return erase(p);
  }
  function onMove(e) {
    if (!drag) return;
    const p = toM(e);
    preview = { x1: Math.min(drag.x, snap(p.x)), x2: Math.max(drag.x, snap(p.x)), y1: Math.min(drag.y, snap(p.y)), y2: Math.max(drag.y, snap(p.y)) };
    render();
  }
  function onUp(e) {
    if (!drag) return;
    const n = preview; drag = null; preview = null;
    if (!n || n.x2 - n.x1 < 1.0 || n.y2 - n.y1 < 1.0) { render(); if (n) toast("방은 1 m × 1 m보다 커야 해요"); return; }
    const room = resolveOverlap({ role: ed.role, x1: Math.max(0.2, n.x1), x2: Math.min(CW - 0.2, n.x2), y1: Math.max(0.2, n.y1), y2: Math.min(CH - 0.2, n.y2) });
    if (room.x2 - room.x1 < 1.0 || room.y2 - room.y1 < 1.0) { render(); toast("다른 방과 겹쳐서 자리가 안 나와요"); return; }
    const old = roomOf(ed.role);
    if (old) { removeRoom(old); toast(`${ROLE_KO[ed.role]}을(를) 새로 그렸어요`); }
    ed.rooms.push(room);
    // 다음 방 역할을 자동으로 다음 것으로
    const next = ROLES.map(r => r[0]).find(k => !roomOf(k)); if (next) ed.role = next;
    render();
  }
  // 0.2 m 벽을 트인 경계로, 다시 누르면 벽으로
  function toggleOpen(p) {
    for (let i = 0; i < ed.rooms.length; i++) for (let j = i + 1; j < ed.rooms.length; j++) {
      const a = ed.rooms[i], b = ed.rooms[j], f = facing(a, b);
      if (!f || Math.abs(f.gap - G) > 0.05) continue;
      const s = f.strip;
      const near = f.axis === "y" ? (Math.abs(p.x - (s.x1 + s.x2) / 2) < 0.35 && p.y >= s.y1 && p.y <= s.y2) : (Math.abs(p.y - (s.y1 + s.y2) / 2) < 0.35 && p.x >= s.x1 && p.x <= s.x2);
      if (!near) continue;
      const k = pairKey(a.role, b.role);
      if (ed.open.includes(k)) ed.open = ed.open.filter(x => x !== k);
      else { ed.open.push(k); ed.doors = ed.doors.filter(d => pairKey(d.a, d.b) !== k); }
      render(); return;
    }
    toast("두 방 사이의 벽을 클릭하세요");
  }
  function removeRoom(r) {
    ed.rooms = ed.rooms.filter(x => x !== r);
    ed.open = ed.open.filter(k => !k.split("|").includes(r.role));
    ed.doors = ed.doors.filter(d => d.a !== r.role && d.b !== r.role);
    ed.wins = ed.wins.filter(w => w.room !== r.role);
    if (ed.fire && ed.fire.room === r.role) ed.fire = null;
  }
  function placeDoor(p) {
    for (const w of walls()) {
      const near = w.axis === "y" ? (Math.abs(p.x - (w.x1 + w.x2) / 2) < 0.35 && p.y >= w.y1 && p.y <= w.y2) : (Math.abs(p.y - (w.y1 + w.y2) / 2) < 0.35 && p.x >= w.x1 && p.x <= w.x2);
      if (!near) continue;
      let d;
      if (w.axis === "y") { let c = snap(p.y); c = Math.min(w.y2 - DOOR_L / 2, Math.max(w.y1 + DOOR_L / 2, c)); d = { x1: r2(w.x1 - 0.1), x2: r2(w.x2 + 0.1), y1: r2(c - DOOR_L / 2), y2: r2(c + DOOR_L / 2) }; }
      else { let c = snap(p.x); c = Math.min(w.x2 - DOOR_L / 2, Math.max(w.x1 + DOOR_L / 2, c)); d = { x1: r2(c - DOOR_L / 2), x2: r2(c + DOOR_L / 2), y1: r2(w.y1 - 0.1), y2: r2(w.y2 + 0.1) }; }
      ed.doors = ed.doors.filter(x => !(x.a === w.a && x.b === w.b));   // 두 방 사이 문은 하나
      ed.doors.push({ ...d, a: w.a, b: w.b });
      render(); return;
    }
    toast("두 방 사이의 벽(검은 띠)을 클릭하세요. 방은 0.2 m 간격으로 맞닿아야 벽이 생겨요");
  }
  function placeWindow(p) {
    const ws = walls();
    for (const r of ed.rooms) {
      const edges = [["x", r.x1, "W"], ["x", r.x2, "E"], ["y", r.y1, "S"], ["y", r.y2, "N"]];
      for (const [ax, at, side] of edges) {
        const near = ax === "x" ? (Math.abs(p.x - at) < 0.3 && p.y >= r.y1 && p.y <= r.y2) : (Math.abs(p.y - at) < 0.3 && p.x >= r.x1 && p.x <= r.x2);
        if (!near) continue;
        // 그 자리에 다른 방과의 벽이 있으면 바깥벽이 아님
        const blocked = ws.some(w => (w.a === r.role || w.b === r.role) && (ax === "x" ? (w.axis === "y" && Math.abs((w.x1 + w.x2) / 2 - at) < 0.3 && p.y >= w.y1 && p.y <= w.y2) : (w.axis === "x" && Math.abs((w.y1 + w.y2) / 2 - at) < 0.3 && p.x >= w.x1 && p.x <= w.x2)));
        if (blocked) { toast("다른 방과 맞닿은 벽에는 창을 못 놓아요"); return; }
        let win;
        if (ax === "x") { let c = Math.min(r.y2 - WIN_L / 2, Math.max(r.y1 + WIN_L / 2, snap(p.y))); win = { room: r.role, x1: at, x2: at, y1: r2(c - WIN_L / 2), y2: r2(c + WIN_L / 2) }; }
        else { let c = Math.min(r.x2 - WIN_L / 2, Math.max(r.x1 + WIN_L / 2, snap(p.x))); win = { room: r.role, x1: r2(c - WIN_L / 2), x2: r2(c + WIN_L / 2), y1: at, y2: at }; }
        ed.wins = ed.wins.filter(w => w.room !== r.role);   // 방마다 창 하나
        ed.wins.push(win); render(); return;
      }
    }
    toast("방의 바깥쪽 벽(테두리)을 클릭하세요");
  }
  function placeFire(p) {
    const r = ed.rooms.find(r => inRect(r, p.x, p.y));
    if (!r) { toast("방 안을 클릭하세요"); return; }
    ed.fire = { room: r.role, x: r2(Math.min(r.x2 - 0.8, Math.max(r.x1 + 0.2, snap(p.x - 0.3)))), y: r2(Math.min(r.y2 - 0.8, Math.max(r.y1 + 0.2, snap(p.y - 0.3)))) };
    render();
  }
  function erase(p) {
    if (ed.fire && p.x >= ed.fire.x - .2 && p.x <= ed.fire.x + .8 && p.y >= ed.fire.y - .2 && p.y <= ed.fire.y + .8) { ed.fire = null; render(); return; }
    const d = ed.doors.find(d => p.x >= d.x1 - .2 && p.x <= d.x2 + .2 && p.y >= d.y1 - .2 && p.y <= d.y2 + .2); if (d) { ed.doors = ed.doors.filter(x => x !== d); render(); return; }
    const w = ed.wins.find(w => Math.abs(p.x - Math.min(Math.max(p.x, w.x1), w.x2)) < .3 && Math.abs(p.y - Math.min(Math.max(p.y, w.y1), w.y2)) < .3); if (w) { ed.wins = ed.wins.filter(x => x !== w); render(); return; }
    const r = ed.rooms.find(r => inRect(r, p.x, p.y)); if (r) { removeRoom(r); render(); return; }
  }

  // 유형 A·B·C를 편집기로 불러오기 (방 역할은 슬롯 순서로 맞춤)
  function loadPlan(key) {
    const p = PLANS[key]; if (!p) return;
    const xs = p.meshes.flatMap(m => [m[0], m[1]]), ys = p.meshes.flatMap(m => [m[2], m[3]]);
    const ox = 0.4 - Math.min(...xs), oy = 0.4 - Math.min(...ys);
    const roleOf = {}; p.slots.forEach((r, j) => { if (r) roleOf[r] = SLOT_ORDER[j]; });
    ed.rooms = []; ed.doors = []; ed.wins = []; ed.open = []; ed.fire = null;
    for (const r in p.rooms) { if (!roleOf[r]) continue; const [x1, x2, y1, y2] = p.rooms[r]; ed.rooms.push({ role: roleOf[r], x1: r2(x1 + ox), x2: r2(x2 + ox), y1: r2(y1 + oy), y2: r2(y2 + oy) }); }
    for (const r in p.doors) {
      const [x1, x2, y1, y2] = p.doors[r].map((v, i) => r2(v + (i < 2 ? ox : oy)));
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const touch = ed.rooms.filter(q => cx >= q.x1 - 0.3 && cx <= q.x2 + 0.3 && cy >= q.y1 - 0.3 && cy <= q.y2 + 0.3);
      if (touch.length >= 2) ed.doors.push({ x1, x2, y1, y2, a: touch[0].role, b: touch[1].role });
    }
    for (const r in p.windows) { if (!roleOf[r]) continue; const [x1, x2, y1, y2] = p.windows[r].map((v, i) => r2(v + (i < 2 ? ox : oy))); ed.wins.push({ room: roleOf[r], x1, x2, y1, y2 }); }
    // 원래 평면에 벽이 없던 0.2 m 틈(거실↔복도 등)은 트인 경계로
    const wallSolids = p.solids.filter(s => s.wall).map(s => s.xb.map((v, i) => r2(v + (i < 2 ? ox : oy))));
    for (let i = 0; i < ed.rooms.length; i++) for (let j = i + 1; j < ed.rooms.length; j++) {
      const a = ed.rooms[i], b = ed.rooms[j], f = facing(a, b);
      if (!f || Math.abs(f.gap - G) > 0.05) continue;
      const s = f.strip;
      const covered = wallSolids.some(w => Math.min(w[1], s.x2) - Math.max(w[0], s.x1) > 0.05 && Math.min(w[3], s.y2) - Math.max(w[2], s.y1) > 0.05);
      if (!covered) ed.open.push(pairKey(a.role, b.role));
    }
    const fr = Object.keys(p.fire).find(r => roleOf[r] === "living") || Object.keys(p.fire)[0];
    const [fx, fy] = p.fire[fr][0]; ed.fire = { room: roleOf[fr], x: r2(fx + ox), y: r2(fy + oy) };
    render();
  }

  // ── 검사 ──────────────────────────────────────────────
  function hops() {   // 불난 방에서 열린 문으로 이어진 거리
    const dist = {}; if (!ed.fire) return dist;
    dist[ed.fire.room] = 0; const q = [ed.fire.room];
    while (q.length) {
      const cur = q.shift();
      for (const d of ed.doors) {
        const other = d.a === cur ? d.b : d.b === cur ? d.a : null; if (!other || dist[other] != null) continue;
        const passable = (d.a === ed.fire.room || d.b === ed.fire.room) ? ed.doorOpen : true;
        if (!passable) continue;
        dist[other] = dist[cur] + 1; q.push(other);
      }
      const curR = roomOf(cur);
      for (const o of ed.rooms) {   // 벽 없이 트인 경계는 늘 통함
        if (o.role === cur || dist[o.role] != null || !openBetween(curR, o)) continue;
        dist[o.role] = dist[cur] + 1; q.push(o.role);
      }
    }
    return dist;
  }
  function validate() {
    const errs = [], warns = [];
    if (!ed.rooms.length) errs.push("방을 하나 이상 그리세요");
    if (!ed.fire) errs.push("화원을 놓으세요 (도구: 화원 → 방 안 클릭)");
    if (ed.rooms.length && !ed.rooms.some(r => r.role === "entry" || r.role === "corridor")) warns.push("현관·복도가 없어 피난 골든타임은 '—'로 나와요");
    if (ed.fire) { const d = hops(); const cut = ed.rooms.filter(r => d[r.role] == null); if (cut.length) warns.push(`문으로 이어지지 않은 방: ${cut.map(r => ROLE_KO[r.role]).join(", ")} (누기만 가정)`); }
    return { errs, warns };
  }

  // ── 이론값 ──────────────────────────────────────────────
  function theoryFireRoom(W, D, openings, growth, q) {
    const Ao = openings.reduce((s, o) => s + o.w * o.h, 0);
    const AoH0 = openings.reduce((s, o) => s + o.w * o.h * Math.sqrt(o.h), 0);
    const sealed = AoH0 < 1e-6, AoH = sealed ? 0.03 * Math.sqrt(0.3) : AoH0;
    const AT = 2 * W * D + 2 * H * (W + D) - Ao;
    const Qfo = 7.8 * AT + 378 * AoH, alpha = ALPHA[growth];
    const Q = t => Math.min(alpha * t * t, q);
    const tfoThomas = Qfo <= q ? Math.sqrt(Qfo / alpha) : null;
    const T = [], Z = []; let z = H, tDet = null, tUnt = null, tLayer = null, tFo600 = null;
    for (let t = 0; t <= 900; t++) {
      const qq = Q(t), hk = Math.sqrt(KRC / Math.max(t, 1)) / 1000;
      const dT = qq > 0 ? 6.85 * Math.cbrt(qq * qq / (AoH * hk * AT)) : 0;
      const Tup = Math.min(20 + dT, 1200);
      const qc = 0.7 * qq, zp = Math.max(0.1, z - 0.4);
      const mp = qc > 0 ? 0.071 * Math.cbrt(qc) * Math.pow(zp, 5 / 3) + 0.0018 * qc : 0;
      if (z > 0.5) z = Math.max(0.5, z - mp / ((353 / (Tup + 273)) * W * D));
      T.push(Tup); Z.push(z);
      if (tDet == null && Tup >= 70) tDet = t;
      if (tLayer == null && z <= 1.8) tLayer = t;
      if (tUnt == null && z <= 1.8 && Tup >= 60) tUnt = t;
      if (tFo600 == null && Tup >= 600) tFo600 = t;
    }
    const c = [tfoThomas, tFo600].filter(v => v != null);
    return { Ao, AoH, AT, Qfo, tfoThomas, tFo600, tfo: c.length ? Math.min(...c) : null, tDet, tUnt, tLayer, T, Z, sealed };
  }
  function fireRoomOpenings() {
    const F = ed.fire && roomOf(ed.fire.room); if (!F) return [];
    const out = [];
    if (ed.doorOpen) for (const d of ed.doors) if (d.a === F.role || d.b === F.role) out.push({ w: DOOR_L, h: DOOR_H });
    if (ed.winOpen) for (const w of ed.wins) if (w.room === F.role) out.push({ w: WIN_L, h: WIN_H });
    for (const o of opens()) if (o.a === F.role || o.b === F.role) out.push({ w: o.span, h: H });   // 트인 경계 = 큰 개구부
    return out;
  }
  function theory() {
    const F = ed.fire && roomOf(ed.fire.room); if (!F) return null;
    return theoryFireRoom(r2(F.x2 - F.x1), r2(F.y2 - F.y1), fireRoomOpenings(), ed.growth, ed.q);
  }

  // ── 평면·사례 만들기 (실시간 탭이 그대로 재생) ──────────────────────────
  function buildPlan() {
    const rooms = {}, centers = {}, room_ko = {}, fire = {}, doors = {}, windows = {}, solids = [];
    // 격자 덩어리 = 방을 벽 절반(0.1)만큼 넓힌 것. 맞닿은(틈 0) 쪽은 넓히지 않아 변이 정확히 겹치게 → 3D 바깥벽 윤곽에 안쪽 선이 안 생김
    const meshes = ed.rooms.map(r => {
      const e = { x1: 0.1, x2: 0.1, y1: 0.1, y2: 0.1 };
      for (const o of ed.rooms) { if (o === r) continue; const f = facing(r, o); if (!f || f.gap > 0.05) continue;
        if (f.axis === "y") { if (o.x1 >= r.x2 - 0.05) e.x2 = 0; else e.x1 = 0; } else { if (o.y1 >= r.y2 - 0.05) e.y2 = 0; else e.y1 = 0; } }
      return [r2(r.x1 - e.x1), r2(r.x2 + e.x2), r2(r.y1 - e.y1), r2(r.y2 + e.y2)];
    });
    for (const r of ed.rooms) {
      rooms[r.role] = [r.x1, r.x2, r.y1, r.y2]; room_ko[r.role] = ROLE_KO[r.role];
      centers[r.role] = [r2((Math.floor((r.x1 + r.x2) / 2 / G) + 0.5) * G), r2((Math.floor((r.y1 + r.y2) / 2 / G) + 0.5) * G)];
    }
    for (const w of walls()) solids.push({ xb: [w.x1, w.x2, w.y1, w.y2], name: `W_${w.a}_${w.b}`, wall: true, ko: "" });
    const PRIV = ["master", "br1", "br2", "kitchen", "entry", "corridor", "living"];
    const used = {};
    for (const d of ed.doors) {
      let key = (d.a === ed.fire.room || d.b === ed.fire.room) ? ed.fire.room : (PRIV.find(k => k === d.a || k === d.b) || d.a);   // 불난 방 문은 그 방 이름으로 (열림/닫힘 표시용)
      if (used[key]) key = key + "_2"; used[key] = true;
      doors[key] = [d.x1, d.x2, d.y1, d.y2];
    }
    for (const w of ed.wins) windows[w.room] = [w.x1, w.x2, w.y1, w.y2];
    fire[ed.fire.room] = [[ed.fire.x, ed.fire.y]];
    const door_rooms = ed.rooms.filter(r => ed.doors.some(d => d.a === r.role || d.b === r.role)).map(r => r.role);
    return { title: "사용자 지정 평면 (직접 그림 · 정답 없음)", short: "사용자 지정 평면", label: "사용자 지정", holdout: true, custom: true,
      meshes, solids, doors, windows, rooms, room_ko, centers, fire, door_rooms, cooktop: ["(none)", 0], slots: SLOT_ORDER.map(k => roomOf(k) ? k : null) };
  }
  function buildCase(plan, th) {
    const F = ed.fire.room, dist = hops();
    const tEnd = 600, tc = {}, roomsOut = {}, detects = [];
    for (const r of ed.rooms) {
      const h = dist[r.role];
      const f = r.role === F ? 1 : h == null ? 0.04 : 0.42 * Math.pow(0.55, h - 1), delay = r.role === F ? 0 : h == null ? 40 : 12 * h;
      const arr = [], ev = { t_detect: null, t_T60: null, t_VIS5: null, t_CO1400: null, t_O2_15: null, t_untenable: null };
      for (let t = 0; t <= tEnd; t++) {
        const Tf = th.T[Math.max(0, t - delay)], T = 20 + f * (Tf - 20);
        arr.push(Math.round(T * 10));
        if (ev.t_detect == null && T >= 70) ev.t_detect = t;
        if (ev.t_T60 == null && T >= 60) ev.t_T60 = t;
      }
      if (r.role === F) ev.t_untenable = th.tUnt;
      else { const viaSmoke = (h != null && th.tLayer != null) ? th.tLayer + 25 * h : null; const c = [ev.t_T60, viaSmoke].filter(v => v != null); ev.t_untenable = c.length ? Math.min(...c) : null; }
      if (ev.t_untenable != null && ev.t_untenable > tEnd) ev.t_untenable = null;
      if (ev.t_detect != null) detects.push(ev.t_detect);
      tc[r.role] = arr; roomsOut[r.role] = ev;
    }
    const id = `custom_${++caseSeq}`;
    return { id, plan: "custom", fire_room: F, spot: 0, door_open: ed.doorOpen, window_open: ed.winOpen, growth: ed.growth, growth_ko: GROWTH_KO[ed.growth], q_mw: ed.q / 1000,
      cooktop: false, split: "theory", t_end: tEnd, t_flashover: th.tfo != null && th.tfo <= tEnd ? th.tfo : null, t_first_detect: detects.length ? Math.min(...detects) : null,
      t_oxygen_starved: null, peak_hrr_kw: ed.q, rooms: roomsOut, tc, theory: th };
  }
  function startDemo() {
    const { errs } = validate();
    if (errs.length) { toast(errs[0]); return; }
    const th = theory(), plan = buildPlan(), c = buildCase(plan, th);
    PLANS.custom = plan;
    for (let i = CASES.length - 1; i >= 0; i--) if (CASES[i].plan === "custom") { delete CASE_BY_ID[CASES[i].id]; CASES.splice(i, 1); }
    CASES.push(c); CASE_BY_ID[c.id] = c; delete ROOM_CASES.custom;
    lv.custom = false; lv.reveal = true; lv.viewPlan = null;   // 평면이 바뀌었으니 3D를 새로 만든다
    $("lv-custom").classList.add("hidden"); $("lv-live-area").classList.remove("hidden");
    lvLoad(c.id);
    if (lv.view) { lv.view.resize(); lvChart(0); }
    toast("사용자 지정 평면을 재생합니다 — 비교표의 정답 자리는 이론값(보수적)");
  }
  // 실시간 탭에서 클릭으로 조건을 바꿨을 때 다시 만들기
  function rebuild(patch) {
    if (patch.room) { const r = roomOf(patch.room); if (!r) return; ed.fire = { room: r.role, x: r2(Math.min(r.x2 - 0.8, Math.max(r.x1 + 0.2, (r.x1 + r.x2) / 2 - 0.3))), y: r2(Math.min(r.y2 - 0.8, Math.max(r.y1 + 0.2, (r.y1 + r.y2) / 2 - 0.3))) }; }
    if (patch.door != null) ed.doorOpen = patch.door;
    if (patch.win != null) ed.winOpen = patch.win;
    if (patch.growth) ed.growth = patch.growth;
    if (patch.q) ed.q = patch.q * 1000;
    startDemo();
  }
  function openEditor() {
    lv.custom = true; if (lv.playing) lvTogglePlay();
    $("lv-live-area").classList.add("hidden"); $("lv-custom").classList.remove("hidden");
    show($("lv-custom")); lvPlanTabs();
  }

  // ── 화면 ──────────────────────────────────────────────
  function updateSide() {
    const v = validate(), th = theory();
    const chk = root.querySelector("#cu-check"); if (chk) chk.innerHTML = [...v.errs.map(e => `<div style="color:var(--danger);font-weight:700">✗ ${e}</div>`), ...v.warns.map(w => `<div style="color:var(--muted)">△ ${w}</div>`)].join("") || `<div style="color:var(--safe);font-weight:700">✓ 시연 준비됨</div>`;
    const btn = root.querySelector("#cu-go"); if (btn) btn.disabled = v.errs.length > 0;
    const tb = root.querySelector("#cu-theory");
    if (tb) {
      if (!th) tb.innerHTML = `<div class="note">화원을 놓으면 불난 방 이론값이 여기 나옵니다.</div>`;
      else {
        const F = roomOf(ed.fire.room);
        const stat = (k, v, sub, cls = "") => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div>${sub ? `<div class="k">${sub}</div>` : ""}</div>`;
        tb.innerHTML = `<div class="theory-cards">
          ${stat("플래시오버 필요 열방출률", `${Math.round(th.Qfo).toLocaleString()} kW`, "Thomas 상관식")}
          ${stat("플래시오버 (이론)", th.tfo == null ? "안 일어남" : fmtT(th.tfo), th.tfo == null ? `최대 ${ed.q / 1000} MW로는 부족` : (th.tfoThomas != null && th.tfoThomas <= (th.tFo600 ?? 1e9) ? "Thomas 도달" : "MQH 상층 600°C"), th.tfo == null ? "ok" : "red")}
          ${stat("불난 방 피난 불가 (이론)", fmtT(th.tUnt), "연기층 1.8 m↓ & 60°C↑", "red")}
          ${stat("열감지기 작동 (이론)", fmtT(th.tDet), "상층 70°C")}
        </div>
        <div class="formula">${ROLE_KO[F.role]} ${r2(F.x2 - F.x1)}×${r2(F.y2 - F.y1)} m · A_T = ${th.AT.toFixed(1)} m² · A_o√H_o = ${th.AoH.toFixed(2)}${th.sealed ? " (밀폐 → 누기 0.03 m² 가정)" : ""} · α = ${ALPHA[ed.growth]} kW/s² · Q_max = ${ed.q} kW<br>Q_fo = 7.8·A_T + 378·A_o√H_o · ΔT = 6.85·(Q²/(A_o√H_o·h_k·A_T))^(1/3), h_k = √(kρc/t) · 다른 방: 홉당 ×0.55, 12초 지연 (근사)</div>`;
      }
    }
  }
  function render_root() {
    root.innerHTML = `
      <div class="banner">사용자 지정 평면은 <b>FDS 정답이 없습니다.</b> 불난 방은 SFPE 상관식 이론값(보수적), 다른 방은 문 연결 거리로 줄이고 늦춘 구역 모델 근사로 온도를 만들고, 그 온도를 센서 입력처럼 AI에 넣어 실시간 탭과 똑같이 재생합니다. 정식 평가는 유형 A·B·C(FDS)에서 — 새 평면을 정식으로 넣으려면 FDS 시뮬레이션(1건 약 1시간)이 필요합니다.</div>
      <div class="custom-grid">
        <div>
          <div class="card">
            <h2>그리기 도구</h2>
            <div class="field"><div class="seg" id="cu-tool"></div></div>
            <div class="field" id="cu-role-f"><label>방 역할 (AI 입력 자리 = 센서 7개)</label><div class="seg" id="cu-role"></div></div>
            <div class="field"><label>예시 불러오기</label><div class="seg" id="cu-load"></div></div>
            <div class="note">방: 드래그로 네모 그리기(0.2 m 벽 간격은 자동, 딱 붙여 그리면 벽 없이 트임). 문: 두 방 사이 검은 벽 클릭. 개방: 벽을 트인 경계(점선)로. 창: 바깥 테두리 클릭. 화원: 방 안 클릭.</div>
          </div>
          <div class="card">
            <h2>화재 조건</h2>
            <div class="field"><label>불이 커지는 속도</label><div class="seg" id="cu-growth"></div></div>
            <div class="field"><label>최대 열방출률</label><div class="seg" id="cu-q"></div></div>
            <div class="field"><label>불난 방의 문</label><div class="seg" id="cu-door"></div></div>
            <div class="field"><label>불난 방의 창</label><div class="seg" id="cu-win"></div></div>
            <div id="cu-check" style="font-size:12.5px;margin:6px 0 10px;line-height:1.5"></div>
            <button class="btn" id="cu-go" style="width:100%">▶ 이 평면으로 시연</button>
          </div>
        </div>
        <div>
          <div class="card" style="padding:10px">
            <svg id="cu-svg" viewBox="0 0 ${CW * S} ${CH * S}" style="width:100%;height:auto;display:block;background:#f4f1ea;border-radius:10px;touch-action:none;cursor:crosshair"></svg>
          </div>
          <div class="card"><h2>불난 방 이론값 (정답 아님 · 보수적)</h2><div id="cu-theory"></div></div>
        </div>
      </div>`;
    svg = root.querySelector("#cu-svg");
    svg.addEventListener("pointerdown", onDown); svg.addEventListener("pointermove", onMove); svg.addEventListener("pointerup", onUp); svg.addEventListener("pointercancel", onUp);
    const segs = (id, items, value, on) => seg(root.querySelector(id), items, value, v => { on(v); render_segs(); render(); });
    const render_segs = () => {
      segs("#cu-tool", [["room", "방"], ["door", "문"], ["open", "개방"], ["window", "창"], ["fire", "화원"], ["erase", "지우기"]].map(([v, l]) => ({ value: v, label: l })), ed.tool, v => ed.tool = v);
      root.querySelector("#cu-role-f").style.display = ed.tool === "room" ? "" : "none";
      segs("#cu-role", ROLES.map(([k, ko]) => ({ value: k, label: ko + (roomOf(k) ? " ✓" : "") })), ed.role, v => ed.role = v);
      // 예시: 방이 서로 겹치지 않는 평면만 (유형 B는 현관이 거실 안에 있어 편집기 표현과 안 맞음)
      const loadable = Object.keys(PLANS).filter(k => !PLANS[k].custom && !Object.values(PLANS[k].rooms).some((a, i, arr) => arr.some((b, j) => j !== i && a[0] < b[1] - 0.05 && a[1] > b[0] + 0.05 && a[2] < b[3] - 0.05 && a[3] > b[2] + 0.05)));
      segs("#cu-load", [...loadable.map(k => ({ value: k, label: planShort(k).split(" · ")[0] })), { value: "clear", label: "모두 지우기" }], null, v => { if (v === "clear") { ed.rooms = []; ed.doors = []; ed.wins = []; ed.open = []; ed.fire = null; ed.role = "living"; } else loadPlan(v); });
      segs("#cu-growth", ["medium", "fast", "ultrafast"].map(g => ({ value: g, label: GROWTH_KO[g] })), ed.growth, v => ed.growth = v);
      segs("#cu-q", [2000, 4000].map(q => ({ value: q, label: `${q / 1000} MW` })), ed.q, v => ed.q = +v);
      segs("#cu-door", [{ value: 1, label: "열림" }, { value: 0, label: "닫힘" }], ed.doorOpen ? 1 : 0, v => ed.doorOpen = !!+v);
      segs("#cu-win", [{ value: 0, label: "닫힘" }, { value: 1, label: "열림" }], ed.winOpen ? 1 : 0, v => ed.winOpen = !!+v);
    };
    render_segs();
    root.querySelector("#cu-go").onclick = startDemo;
    if (!ed.rooms.length) loadPlan("lh");
    render();
  }
  function show(container) { root = container; render_root(); }
  function redraw() { }
  return { show, redraw, rebuild, openEditor, state: ed };
})();
