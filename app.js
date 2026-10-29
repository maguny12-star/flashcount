// FlashCount 웹 데모 — ① 시나리오(FDS 결과 열람) ② 실시간 AI 예측(브라우저에서 GRU 계산) ③ 설명
"use strict";

const S = 60;            // 1 m = 60 px
const PAD = 0.35;        // 평면 바깥 여백 (m)
let PLANS, CASES, MODEL, model;
const CASE_BY_ID = {};
const $ = id => document.getElementById(id);
const fmt = s => (s == null || isNaN(s)) ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const PLAN_SHORT = { lh: "유형 A · 2020년대 4베이 확장형", bs: "유형 B · 1990년대 계단실형", nb: "유형 C · 타워형 (학습 제외)" };   // plans.json에 short가 없을 때의 대비
const GROWTH_KO = { medium: "보통", fast: "빠름", ultrafast: "매우 빠름" };

// ───────────────────────── 공통: 평면 그리기 ─────────────────────────
function makePlanView(svg, plan) {
  const xs = plan.meshes.flatMap(m => [m[0], m[1]]), ys = plan.meshes.flatMap(m => [m[2], m[3]]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const X = x => (x - minx + PAD) * S, Y = y => (maxy - y + PAD) * S;
  const W = (maxx - minx + 2 * PAD) * S, H = (maxy - miny + 2 * PAD) * S;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const rect = (xb, attrs, parent) => el("rect", { x: X(xb[0]), y: Y(xb[3]), width: (xb[1] - xb[0]) * S, height: (xb[3] - xb[2]) * S, ...attrs }, parent);
  const gFloor = el("g", {}), gRooms = el("g", {}), gSolid = el("g", {}), gDoors = el("g", {}), gWin = el("g", {}), gFire = el("g", {}), gText = el("g", { "pointer-events": "none" });
  for (const m of plan.meshes) rect(m, { fill: "#ffffff" }, gFloor);
  // 클릭 상호작용: 방·문·창·화원을 누르면 onPick({kind, room, x, y})
  const api = { onPick: null };
  const pick = (node, data) => { node.classList.add("pick"); node.addEventListener("click", e => { e.stopPropagation(); if (api.onPick) api.onPick({ ...data, x: e.clientX, y: e.clientY }); }); };
  const rooms = {};
  for (const r in plan.rooms) {
    const node = rect(plan.rooms[r], { fill: "#1e7b4f", "fill-opacity": .45 }, gRooms);
    pick(node, { kind: "room", room: r });
    const [cx, cy] = plan.centers[r];
    const label = el("text", { x: X(cx), y: Y(cy) - 6, "text-anchor": "middle", class: "room-label" }, gText);
    label.textContent = plan.room_ko[r];
    const status = el("text", { x: X(cx), y: Y(cy) + 14, "text-anchor": "middle", class: "room-status" }, gText);
    rooms[r] = { node, status };
  }
  for (const s of plan.solids) {
    rect(s.xb, { fill: s.wall ? "#131416" : "#9aa0a6" }, gSolid);
    if (!s.wall && s.ko) {
      const t = el("text", { x: X((s.xb[0] + s.xb[1]) / 2), y: Y((s.xb[2] + s.xb[3]) / 2) + 4, "text-anchor": "middle", fill: "#fff", "font-size": 12 }, gSolid);
      t.textContent = s.ko;
    }
  }
  const doors = {};
  for (const r in plan.doors) {
    const xb = plan.doors[r];
    const g = el("g", {}, gDoors);
    doors[r] = { node: rect(xb, { fill: "#ffffff" }, g) };
    const t = el("text", { x: X((xb[0] + xb[1]) / 2), y: Y((xb[2] + xb[3]) / 2) + 4, "text-anchor": "middle", fill: "#1b6c80", "font-size": 11 }, g);
    t.textContent = "문";
    doors[r].text = t;
    pick(g, { kind: "door", room: r });
  }
  const wins = {};
  for (const r in plan.windows) {
    const xb = plan.windows[r];
    const g = el("g", {}, gWin);
    el("line", { x1: X(xb[0]), y1: Y(xb[2]), x2: X(xb[1]), y2: Y(xb[3]), stroke: "transparent", "stroke-width": 22, "pointer-events": "stroke" }, g);   // 클릭 영역
    wins[r] = el("line", { x1: X(xb[0]), y1: Y(xb[2]), x2: X(xb[1]), y2: Y(xb[3]), stroke: "#2f70bb", "stroke-width": 7 }, g);
    pick(g, { kind: "window", room: r });
  }
  const fire = el("g", { visibility: "hidden" }, gFire);
  const fireRect = el("rect", { width: .6 * S, height: .6 * S, fill: "#e8572a", rx: 4 }, fire);
  const fireText = el("text", { "text-anchor": "middle", fill: "#fff", "font-size": 12, "font-weight": 700 }, fire);
  fireText.textContent = "화원";
  pick(fire, { kind: "fire" });
  const note = el("text", { x: 8, y: H - 8, "font-size": 12, fill: "#5f6672" }, gText);
  note.textContent = "파랑: 창   검정: 벽   회색: 계산에서 뺀 공간(욕실 등)   클릭: 방·문·창·화원 바꾸기";
  return Object.assign(api, {
    rooms, doors, wins,
    setFire(room, spot) {
      if (room == null) { fire.setAttribute("visibility", "hidden"); return; }
      const [fx, fy] = plan.fire[room][spot];
      fire.setAttribute("visibility", "visible");
      fireRect.setAttribute("x", X(fx)); fireRect.setAttribute("y", Y(fy + .6));
      fireText.setAttribute("x", X(fx + .3)); fireText.setAttribute("y", Y(fy + .3) + 4);
    },
    setDoor(room, open) {
      const d = doors[room]; if (!d) return;
      d.node.setAttribute("fill", open ? "#ffffff" : "#6d4c41");
      d.text.textContent = open ? "문" : "닫힘";
      d.text.setAttribute("fill", open ? "#1b6c80" : "#fff");
    },
    setWindow(room, open) {
      const w = wins[room]; if (!w) return;
      w.setAttribute("stroke", open ? "#a9cdf2" : "#2f70bb");
      w.setAttribute("stroke-dasharray", open ? "8 6" : "");
    },
    setRoom(r, color, text) { rooms[r].node.setAttribute("fill", color); rooms[r].node.setAttribute("fill-opacity", color === "#1e7b4f" ? .4 : .7); rooms[r].status.textContent = text; },
  });
}

// 남은 시간 → [색, 글자, 심각도 0~1(연기 슬래브 두께용)]
function statusOf(remaining, passedText = "피난 불가") {
  if (remaining == null) return ["#1e7b4f", "피난 가능", 0];
  if (remaining < 5) return ["#7f1d1d", passedText, 1];
  if (remaining <= 60) return ["#c4242a", `${Math.round(remaining)}초 남음`, 0.45 + 0.5 * (1 - remaining / 60)];
  if (remaining <= 180) return ["#b45309", `${Math.round(remaining)}초 남음`, 0.12 + 0.33 * (1 - (remaining - 60) / 120)];
  return ["#1e7b4f", `${Math.round(remaining)}초 남음`, 0.05];
}

// 2D(SVG) + 3D(three.js)를 같은 명령으로 움직이는 묶음 보기
function makeView(svgEl, el3d, wrap2d, plan) {
  const v2 = makePlanView(svgEl, plan);
  let v3 = null;
  try { if (window.THREE) v3 = new PlanView3D(el3d, plan); } catch (e) { console.warn("3D 사용 불가", e); }
  const hint = el3d.querySelector(".hint"); if (hint) el3d.appendChild(hint);
  const view = {
    v3,
    mode: v3 ? "3d" : "2d",
    setMode(m) { view.mode = v3 && m === "3d" ? "3d" : "2d"; el3d.classList.toggle("hidden", view.mode !== "3d"); wrap2d.classList.toggle("hidden", view.mode === "3d"); if (v3 && view.mode === "3d") v3.resize(); },
    setFire(r, s) { v2.setFire(r, s); if (v3) v3.setFire(r, s); },
    setDoor(r, o) { v2.setDoor(r, o); if (v3) v3.setDoor(r, o); },
    setWindow(r, o) { v2.setWindow(r, o); if (v3) v3.setWindow(r, o); },
    setRoom(r, c, t, level = 0) { v2.setRoom(r, c, t); if (v3) v3.setRoom(r, c, t, level); },
    setAIMarker(r) { if (v3) v3.setAIMarker(r); },
    setPick(fn) { v2.onPick = fn; if (v3) v3.onPick = fn; },
    resize() { if (v3) v3.resize(); },
    dispose() { if (v3) v3.dispose(); },
  };
  view.setMode(view.mode);
  return view;
}

// ───────────────────────── 테마(밝게/어둡게)·전체화면·골든타임 ─────────────────────────
const cssVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);
function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem("fc-theme", name); } catch (e) { /* 사생활 보호 모드 등 */ }
  for (const v of [sc.view, lv.view]) if (v && v.v3) v.v3.applyTheme();
  if (lv.c) lvChart(Math.floor(lv.t));
  if (window.CUSTOM) CUSTOM.redraw();
  themeSeg();
}
function themeSeg() { seg($("theme-seg"), [{ value: "light", label: "☀ 밝게" }, { value: "dark", label: "☾ 어둡게" }], document.documentElement.dataset.theme || "light", applyTheme); }
function fullscreenBtn(btnId, cardId) {
  $(btnId).onclick = () => { const el = $(cardId); if (document.fullscreenElement === el) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); };
}
document.addEventListener("fullscreenchange", () => setTimeout(() => { if (sc.view) sc.view.resize(); if (lv.view) lv.view.resize(); if (lv.c) lvChart(Math.floor(lv.t)); }, 60));

// 피난 골든타임 = 탈출 통로(현관·복도)가 막히기까지 남은 시간. remaining: {방: 초 | null(계산 시간 안에 안 막힘)}
function goldenView(el, p, remaining, who) {
  const route = Object.keys(p.rooms).filter(r => r === "corridor" || r === "entry");
  const vals = route.map(r => remaining[r]).filter(v => v != null);
  const g = vals.length ? Math.min(...vals) : null;
  const cls = g == null ? "ok" : g < 5 ? "over" : g <= 60 ? "urgent" : g <= 180 ? "soon" : "ok";
  const big = g == null ? "확보" : g < 5 ? "통로 피난 불가" : fmt(g);
  const sub = g == null ? "계산 시간 안에 현관 쪽 통로가 막히지 않음" : g < 5 ? "통로로 못 나감 → 방 안 대피: 문 닫고 틈 막기, 창가에서 구조 요청" : "이 시간 안에 현관으로 나가야 함";
  const chips = Object.keys(p.rooms).map(r => { const v = remaining[r]; const c = v == null ? "ok" : v < 5 ? "bad" : v <= 60 ? "soon" : "ok"; return `<span class="${c}">${p.room_ko[r]} ${v == null ? "가능" : v < 5 ? "불가" : Math.round(v) + "초"}</span>`; }).join("");
  el.className = "golden " + cls;
  el.innerHTML = `<div><div class="lab">피난 골든타임 · 현관·복도 통로 기준${who ? ` (${who})` : ""}</div><div class="big">${big}</div><div class="sub">${sub}</div></div><div class="rooms">${chips}</div>`;
}

// ───────────────────────── 공통: 클릭 상호작용 도우미 ─────────────────────────
const planShort = k => (PLANS[k] && PLANS[k].short) || PLAN_SHORT[k] || k;
const caseIdOf = (plan, room, spot, door, win, growth, q) => `${plan}_${room}_s${spot}_d${door ? 1 : 0}_w${win ? 1 : 0}_${growth}_${q}MW`;
const ROOM_CASES = {};
// 그 평면에서 화원 조건이 실제로 계산된 방 (3번째 평면은 일부 방만 계산)
function roomsWithCases(plan) {
  if (!ROOM_CASES[plan]) ROOM_CASES[plan] = Object.keys(PLANS[plan].fire).filter(r => CASES.some(c => c.plan === plan && c.fire_room === r));
  return ROOM_CASES[plan];
}

function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2400);
}

// 클릭한 자리 옆에 뜨는 작은 설정 창. rows: [{label, items, value, onChange}]
let POP = null;
function closePop() { if (POP) { POP.remove(); POP = null; } }
function openPop(container, x, y, title, rows, foot) {
  closePop();
  const pop = document.createElement("div"); pop.className = "pop";
  pop.innerHTML = `<div class="pop-h"><span>${title}</span><button class="pop-x" title="닫기">✕</button></div>`;
  pop.querySelector(".pop-x").onclick = closePop;
  for (const r of rows) {
    const f = document.createElement("div"); f.className = "field";
    f.innerHTML = `<label>${r.label}</label><div class="seg"></div>`;
    seg(f.querySelector(".seg"), r.items, r.value, r.onChange);
    pop.appendChild(f);
  }
  if (foot) { const n = document.createElement("div"); n.className = "note"; n.textContent = foot; pop.appendChild(n); }
  pop.addEventListener("pointerdown", e => e.stopPropagation());
  container.appendChild(pop);
  const cr = container.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(x - cr.left + 14, cr.width - pop.offsetWidth - 8)) + "px";
  pop.style.top = Math.max(8, Math.min(y - cr.top - 12, cr.height - pop.offsetHeight - 8)) + "px";
  POP = pop;
}
document.addEventListener("pointerdown", e => { if (POP && !POP.contains(e.target)) closePop(); });

// 화원을 클릭했을 때: 그 방 화재의 조건(위치·속도·크기·문·창)을 바로 바꾸는 창. which = "sc" | "lv"
function openFirePop(ev, which) {
  const st = which === "sc"
    ? { plan: sc.plan, room: sc.room, spot: sc.spot, door: sc.door, win: sc.win, growth: sc.growth, q: sc.q }
    : { plan: lv.c.plan, room: lv.c.fire_room, spot: lv.c.spot, door: lv.c.door_open, win: lv.c.window_open, growth: lv.c.growth, q: lv.c.q_mw };
  const p = PLANS[st.plan], view = which === "sc" ? sc.view : lv.view;
  const container = view.mode === "3d" ? $(`${which}-3d`) : $(`${which}-2d`);
  const theory = which === "lv" && lv.c.split === "theory";
  const ok = patch => theory || !!CASE_BY_ID[caseIdOf(st.plan, st.room, patch.spot ?? st.spot, patch.door ?? st.door, patch.win ?? st.win, patch.growth ?? st.growth, patch.q ?? st.q)];
  const apply = patch => {
    const n = { ...st, ...patch };
    if (which === "sc") { Object.assign(sc, { room: n.room, spot: n.spot, door: n.door, win: n.win, growth: n.growth, q: n.q, t: 0 }); scRender(); }
    else if (theory) { closePop(); CUSTOM.rebuild({ door: n.door, win: n.win, growth: n.growth, q: n.q }); return; }
    else {
      const id = caseIdOf(n.plan, n.room, n.spot, n.door, n.win, n.growth, n.q);
      if (!CASE_BY_ID[id]) { toast("이 조합은 계산된 사례가 없습니다"); return; }
      lv.reveal = true; lvLoad(id);
    }
    openFirePop(ev, which);
  };
  const rows = [];
  const spots = p.fire[st.room];
  if (spots.length > 1) rows.push({ label: "화원 위치", items: spots.map((_, i) => ({ value: i, label: `화원 ${i + 1}`, disabled: !ok({ spot: i }) })), value: st.spot, onChange: v => apply({ spot: +v }) });
  rows.push({ label: "불이 커지는 속도", items: ["medium", "fast", "ultrafast"].map(g => ({ value: g, label: GROWTH_KO[g], disabled: !ok({ growth: g }) })), value: st.growth, onChange: v => apply({ growth: v }) });
  rows.push({ label: "최대 화재 크기", items: [2, 4].map(q => ({ value: q, label: `${q} MW`, disabled: !ok({ q }) })), value: st.q, onChange: v => apply({ q: +v }) });
  if (p.door_rooms.includes(st.room)) rows.push({ label: "이 방의 문", items: [{ value: 1, label: "열림", disabled: !ok({ door: true }) }, { value: 0, label: "닫힘", disabled: !ok({ door: false }) }], value: st.door ? 1 : 0, onChange: v => apply({ door: !!+v }) });
  rows.push({ label: "이 방의 창", items: [{ value: 0, label: "닫힘", disabled: !ok({ win: false }) }, { value: 1, label: "열림", disabled: !ok({ win: true }) }], value: st.win ? 1 : 0, onChange: v => apply({ win: !!+v }) });
  openPop(container, ev.x, ev.y, `${p.room_ko[st.room]} 화재 설정`, rows,
    which === "lv" ? "조건을 바꾸면 '정답 표시'가 켜집니다. 청중에게 가리려면 '가림'으로 돌린 뒤 재생하세요." : "다른 방을 클릭하면 불난 방이 바뀌고, 문·창을 클릭하면 열림/닫힘이 바뀝니다.");
}

// 3D 연기 슬래브 두께: 그 방 천장 온도(센서 입력)로 정함. 25°C → 없음, 225°C 이상 → 바닥 가까이
function smokeLevel(c, r, t) {
  const arr = c.tc[r]; if (!arr) return 0;
  const T = arr[Math.min(Math.max(0, Math.floor(t)), arr.length - 1)] / 10;
  return Math.max(0, Math.min(1, (T - 25) / 200));
}

function viewModeSeg(container, view, onChange) {
  const refresh = () => seg(container, [{ value: "3d", label: "3D" }, { value: "2d", label: "평면도" }], view.mode, m => { view.setMode(m); refresh(); if (onChange) onChange(); });
  refresh();
}

function seg(container, items, value, onChange) {
  container.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.label; b.dataset.v = it.value;
    if (String(it.value) === String(value)) b.classList.add("on");
    if (it.disabled) b.disabled = true;
    b.onclick = () => onChange(it.value);
    container.appendChild(b);
  }
}

// ───────────────────────── ① 시나리오 ─────────────────────────
const sc = { plan: "lh", room: "kitchen", spot: 0, door: true, win: false, growth: "fast", q: 4, t: 0, playing: false, view: null, viewPlan: null };

function scCase() {
  const p = PLANS[sc.plan];
  const ok = roomsWithCases(sc.plan);
  if (!ok.includes(sc.room)) sc.room = ok[0];
  if (sc.spot >= p.fire[sc.room].length) sc.spot = 0;
  if (!p.door_rooms.includes(sc.room)) sc.door = true;
  let id = caseIdOf(sc.plan, sc.room, sc.spot, sc.door, sc.win, sc.growth, sc.q);
  if (!CASE_BY_ID[id]) {   // 그 조합이 계산되지 않았으면(3번째 평면 등) 같은 방의 계산된 사례로 맞춤
    const alt = CASES.find(c => c.plan === sc.plan && c.fire_room === sc.room && c.spot === sc.spot) || CASES.find(c => c.plan === sc.plan && c.fire_room === sc.room);
    Object.assign(sc, { spot: alt.spot, door: alt.door_open, win: alt.window_open, growth: alt.growth, q: alt.q_mw });
    id = alt.id;
  }
  return CASE_BY_ID[id];
}

// 3D·평면도에서 방·문·창·화원을 클릭했을 때
function scPick(ev) {
  const p = PLANS[sc.plan];
  if (ev.kind === "room") {
    if (!roomsWithCases(sc.plan).includes(ev.room)) { toast(`${p.room_ko[ev.room]}: 화원 조건을 계산하지 않은 공간입니다`); return; }
    if (ev.room === sc.room) { openFirePop(ev, "sc"); return; }
    sc.room = ev.room; sc.spot = 0; sc.t = 0; scRender(); toast(`불난 방 → ${p.room_ko[ev.room]}`);
  } else if (ev.kind === "door") {
    if (ev.room !== sc.room) { toast(`${p.room_ko[ev.room]} 문: 불난 방의 문만 조건입니다 (다른 방문은 항상 열림)`); return; }
    sc.door = !sc.door; sc.t = 0; scRender(); toast(`불난 방 문 → ${sc.door ? "열림" : "닫힘"}`);
  } else if (ev.kind === "window") {
    if (ev.room !== sc.room) { toast(`${p.room_ko[ev.room]} 창: 불난 방의 창만 조건입니다`); return; }
    sc.win = !sc.win; sc.t = 0; scRender(); toast(`불난 방 창 → ${sc.win ? "열림" : "닫힘"}`);
  } else if (ev.kind === "fire") openFirePop(ev, "sc");
}

function scRender() {
  const p = PLANS[sc.plan], c = scCase();
  const isDoor = p.door_rooms.includes(sc.room);
  const isCook = sc.room === p.cooktop[0] && sc.spot === p.cooktop[1];
  const has = patch => !!CASE_BY_ID[caseIdOf(sc.plan, sc.room, patch.spot ?? sc.spot, patch.door ?? sc.door, patch.win ?? sc.win, patch.growth ?? sc.growth, patch.q ?? sc.q)];
  seg($("sc-plan"), Object.keys(PLANS).filter(k => !PLANS[k].custom).map(k => { const has = CASES.some(c => c.plan === k); return { value: k, label: (PLANS[k].label || planShort(k)) + (has ? "" : " · 계산 중"), disabled: !has }; }), sc.plan, v => { sc.plan = v; sc.t = 0; scRender(); });
  seg($("sc-room"), roomsWithCases(sc.plan).map(r => ({ value: r, label: p.room_ko[r] })), sc.room, v => { sc.room = v; sc.spot = 0; sc.t = 0; scRender(); });
  const spots = p.fire[sc.room];
  seg($("sc-spot"), spots.map((_, i) => ({ value: i, label: spots.length > 1 ? `화원 ${i + 1}` : "1곳", disabled: !has({ spot: i }) })), sc.spot, v => { sc.spot = +v; sc.t = 0; scRender(); });
  $("sc-spot-note").textContent = isCook ? "조리대(가스레인지) 위치 → 조리 화재 곡선(기름 불 100 kW 유지 후 확대)" : spots.length > 1 ? "넓은 공간은 마주 보는 두 벽(TV·소파) 가운데" : "";
  seg($("sc-door"), [{ value: 1, label: "열림", disabled: !isDoor || !has({ door: true }) }, { value: 0, label: "닫힘", disabled: !isDoor || !has({ door: false }) }], sc.door ? 1 : 0, v => { sc.door = !!+v; sc.t = 0; scRender(); });
  $("sc-door-note").textContent = isDoor ? "" : "거실·주방은 문이 없는 열린 공간";
  seg($("sc-win"), [{ value: 0, label: "닫힘", disabled: !has({ win: false }) }, { value: 1, label: "열림", disabled: !has({ win: true }) }], sc.win ? 1 : 0, v => { sc.win = !!+v; sc.t = 0; scRender(); });
  seg($("sc-growth"), ["medium", "fast", "ultrafast"].map(g => ({ value: g, label: GROWTH_KO[g], disabled: !has({ growth: g }) })), sc.growth, v => { sc.growth = v; sc.t = 0; scRender(); });
  $("sc-growth-note").textContent = "t² 화재 성장 곡선: 보통 = 소파류, 빠름 = 매트리스·커튼, 매우 빠름 = 포장재·가연성 액체 수준";
  seg($("sc-q"), [2, 4].map(q => ({ value: q, label: `${q} MW`, disabled: !has({ q }) })), sc.q, v => { sc.q = +v; sc.t = 0; scRender(); });
  $("sc-caseid").textContent = `케이스 ${c.id}` + (c.split === "test" ? " · AI 학습에 쓰지 않은 평가용" : c.split === "new" ? " · 학습에 전혀 안 쓴 평면(평가용)" : "");
  $("sc-title").textContent = `${p.title} — ${p.room_ko[sc.room]} 화재`;

  if (sc.viewPlan !== sc.plan) {
    const prevMode = sc.view ? sc.view.mode : "3d";
    if (sc.view) sc.view.dispose();
    closePop();
    sc.view = makeView($("sc-svg"), $("sc-3d"), $("sc-2d"), p); sc.view.setMode(prevMode); sc.viewPlan = sc.plan;
    sc.view.setPick(scPick);
    viewModeSeg($("sc-viewmode"), sc.view, closePop);
  }
  const v = sc.view;
  v.setFire(sc.room, sc.spot);
  for (const r of p.door_rooms) v.setDoor(r, r === sc.room ? sc.door : true);
  for (const r in p.windows) v.setWindow(r, r === sc.room && sc.win);
  $("sc-time").max = c.t_end;
  if (sc.t > c.t_end) sc.t = c.t_end;
  $("sc-time").value = sc.t;
  scTick();

  // 사건 표
  const rows = Object.keys(p.rooms).map(r => {
    const e = c.rooms[r];
    return `<tr><td>${p.room_ko[r]}${r === sc.room ? " 🔥" : ""}</td><td class="num">${fmt(e.t_detect)}</td><td class="num">${fmt(e.t_T60)}</td><td class="num">${fmt(e.t_VIS5)}</td><td class="num">${fmt(e.t_CO1400)}</td><td class="num">${fmt(e.t_O2_15)}</td><td class="num"><b>${fmt(e.t_untenable)}</b></td></tr>`;
  }).join("");
  $("sc-table").innerHTML = `<tr><th>방</th><th class="num">열감지기</th><th class="num">온도 60°C</th><th class="num">가시거리 5 m</th><th class="num">CO 1,400 ppm</th><th class="num">O₂ 15%</th><th class="num">피난 불가</th></tr>${rows}`;

  // 비교: 문 닫힘/열림 (문 없는 공간은 창)
  const otherId = isDoor
    ? `${sc.plan}_${sc.room}_s${sc.spot}_d${sc.door ? 0 : 1}_w${sc.win ? 1 : 0}_${sc.growth}_${sc.q}MW`
    : `${sc.plan}_${sc.room}_s${sc.spot}_d1_w${sc.win ? 0 : 1}_${sc.growth}_${sc.q}MW`;
  const o = CASE_BY_ID[otherId];
  $("sc-compare-card").querySelector("h2").textContent = isDoor ? "불난 방의 문을 닫으면?" : "창을 열면?";
  if (!o) { $("sc-compare").innerHTML = `<div class="note">비교할 사례(${isDoor ? "문" : "창"} 반대 조건)가 계산되지 않았습니다.</div>`; return; }
  const a = isDoor ? (sc.door ? "문 열림 (현재)" : "문 닫힘 (현재)") : (sc.win ? "창 열림 (현재)" : "창 닫힘 (현재)");
  const b = isDoor ? (sc.door ? "문 닫힘" : "문 열림") : (sc.win ? "창 닫힘" : "창 열림");
  const cmpRows = Object.keys(p.rooms).map(r => `<tr><td>${p.room_ko[r]}${r === sc.room ? " 🔥" : ""}</td><td class="num">${fmt(c.rooms[r].t_untenable)}</td><td class="num">${fmt(o.rooms[r].t_untenable)}</td></tr>`).join("");
  $("sc-compare").innerHTML = `<table><tr><th>피난 불가 시각</th><th class="num">${a}</th><th class="num">${b}</th></tr>${cmpRows}<tr><td>플래시오버</td><td class="num">${fmt(c.t_flashover)}</td><td class="num">${fmt(o.t_flashover)}</td></tr></table>
    <div class="note" style="margin-top:6px">${isDoor ? "침실 화재 228건 전체: 문을 닫으면 다른 방 피난 불가 0%, 열면 100%(중앙값 1분 20초)." : "창이 닫힌 집은 플래시오버 뒤 산소가 바닥나 불이 약해집니다(창 닫힘 75%). 다만 그 방문을 갑자기 열면 역화 위험이 있습니다."}</div>`;
}

function scTick() {
  const p = PLANS[sc.plan], c = scCase(), t = sc.t;
  for (const r in p.rooms) {
    const tu = c.rooms[r].t_untenable;
    const [color, text] = statusOf(tu == null ? null : tu - t);
    sc.view.setRoom(r, color, text, smokeLevel(c, r, t));
  }
  $("sc-tlabel").textContent = fmt(t);
  const remaining = {}; for (const r in p.rooms) { const tu = c.rooms[r].t_untenable; remaining[r] = tu == null ? null : tu - t; }
  goldenView($("sc-golden"), p, remaining, "FDS 결과");
  const others = Object.keys(p.rooms).filter(r => r !== sc.room).map(r => c.rooms[r].t_untenable).filter(v => v != null);
  const firstOther = others.length ? Math.min(...others) : null;
  const stat = (k, v, cls = "") => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  $("sc-stats").innerHTML =
    stat("첫 열감지기 작동", fmt(c.t_first_detect), t >= (c.t_first_detect ?? 1e9) ? "red" : "") +
    stat("불난 방 피난 불가", fmt(c.rooms[sc.room].t_untenable), t >= (c.rooms[sc.room].t_untenable ?? 1e9) ? "red" : "") +
    stat("다른 방 첫 피난 불가", firstOther == null ? "없음" : fmt(firstOther), firstOther == null ? "ok" : t >= firstOther ? "red" : "") +
    stat("플래시오버 (상층 600°C)", c.t_flashover == null ? "안 일어남" : fmt(c.t_flashover), c.t_flashover == null ? "ok" : t >= c.t_flashover ? "red" : "") +
    (c.t_oxygen_starved != null ? stat("산소 부족으로 불이 약해짐", fmt(c.t_oxygen_starved)) : "");
}

function scSetup() {
  $("sc-time").oninput = e => { sc.t = +e.target.value; scTick(); };
  let timer = null;
  $("sc-play").onclick = () => {
    if (timer) { clearInterval(timer); timer = null; $("sc-play").textContent = "▶ 재생"; return; }
    if (sc.t >= scCase().t_end) sc.t = 0;
    $("sc-play").textContent = "⏸ 멈춤";
    timer = setInterval(() => {
      sc.t = Math.min(sc.t + 2, scCase().t_end);
      $("sc-time").value = sc.t; scTick();
      if (sc.t >= scCase().t_end) { clearInterval(timer); timer = null; $("sc-play").textContent = "▶ 재생"; }
    }, 100);
  };
  scRender();
}

// ───────────────────────── ② 실시간 AI ─────────────────────────
const lv = { c: null, t: 0, playing: false, speed: 5, reveal: false, preds: [], log: [], flags: {}, logT: -1, thoughts: [], view: null, viewPlan: null, raf: null, last: 0 };

// 정답을 가린 상태에서는 화원 방·성장 속도 같은 조건을 목록에서도 숨긴다 (AI가 모르는 정보)
function lvCaseLabel(c, i) {
  const p = PLANS[c.plan];
  const head = i == null ? "직접 고른 조건" : `사례 ${i + 1}`;
  if (!lv.reveal) return `${head} · ${planShort(c.plan)} (조건 가림)`;
  return `${head} · ${planShort(c.plan)} · ${p.room_ko[c.fire_room]} 화재${c.cooktop ? "(조리)" : ""} · 문 ${p.door_rooms.includes(c.fire_room) ? (c.door_open ? "열림" : "닫힘") : "없음"} · 창 ${c.window_open ? "열림" : "닫힘"} · 성장 ${GROWTH_KO[c.growth]} · 최대 ${c.q_mw} MW`;
}

// 실시간 탭에서 3D·평면도를 클릭했을 때: 조건을 바꿔 그 사례를 불러온다 (학습에 쓴 사례면 그렇다고 표시)
function lvPick(ev) {
  const c = lv.c, p = PLANS[c.plan];
  if (c.split === "theory") {   // 사용자 지정: 정답이 없으니 조건을 바꿔 이론 사례를 다시 만든다
    if (ev.kind === "room") { if (ev.room === c.fire_room) openFirePop(ev, "lv"); else CUSTOM.rebuild({ room: ev.room }); }
    else if (ev.kind === "door") { if (ev.room !== c.fire_room) { toast("불난 방의 문만 조건입니다"); return; } CUSTOM.rebuild({ door: !c.door_open }); }
    else if (ev.kind === "window") { if (ev.room !== c.fire_room) { toast("불난 방의 창만 조건입니다"); return; } CUSTOM.rebuild({ win: !c.window_open }); }
    else openFirePop(ev, "lv");
    return;
  }
  const go = (patch, msg) => {
    const n = { room: c.fire_room, spot: c.spot, door: c.door_open, win: c.window_open, growth: c.growth, q: c.q_mw, ...patch };
    const id = caseIdOf(c.plan, n.room, n.spot, n.door, n.win, n.growth, n.q);
    if (!CASE_BY_ID[id]) { toast("이 조합은 계산된 사례가 없습니다"); return; }
    lv.reveal = true; lvLoad(id); toast(msg);
  };
  if (ev.kind === "room") {
    if (!roomsWithCases(c.plan).includes(ev.room)) { toast(`${p.room_ko[ev.room]}: 화원 조건을 계산하지 않은 공간입니다`); return; }
    if (ev.room === c.fire_room) { openFirePop(ev, "lv"); return; }
    go({ room: ev.room, spot: 0 }, `불난 방 → ${p.room_ko[ev.room]} (청중에게 가리려면 '가림'을 누르고 재생)`);
  } else if (ev.kind === "door") {
    if (ev.room !== c.fire_room) { toast(`${p.room_ko[ev.room]} 문: 불난 방의 문만 조건입니다`); return; }
    go({ door: !c.door_open }, `불난 방 문 → ${c.door_open ? "닫힘" : "열림"}`);
  } else if (ev.kind === "window") {
    if (ev.room !== c.fire_room) { toast(`${p.room_ko[ev.room]} 창: 불난 방의 창만 조건입니다`); return; }
    go({ win: !c.window_open }, `불난 방 창 → ${c.window_open ? "닫힘" : "열림"}`);
  } else if (ev.kind === "fire") openFirePop(ev, "lv");
}

function lvTcBySlot() {
  const p = PLANS[lv.c.plan];
  return p.slots.map(r => r ? lv.c.tc[r].map(v => v / 10) : null);
}

function lvEnsurePreds(upto) {
  const tc = lvTcBySlot();
  for (let k = lv.preds.length; k <= upto; k++) lv.preds[k] = k < 10 ? null : model.predictAt(tc, k);
}
function setLoading(on, text) { $("lv-loading").classList.toggle("hidden", !on); if (text) $("lv-loading-text").textContent = text; }
// 전체 구간(최대 900초 × GRU 60스텝)을 한 번에 돌리면 1~2초 멈추므로 40초씩 끊어 계산하고 그동안 '계산 중'을 보여 준다
function lvEnsurePredsAsync(upto, done) {
  if (lv.preds.length > upto) { done(); return; }
  if (lv.job) { lv.job.done = done; return; }
  const job = lv.job = { c: lv.c, done };
  setLoading(true, "AI 전체 구간 계산 중…");
  const tc = lvTcBySlot();
  const step = () => {
    if (lv.job !== job || lv.c !== job.c) return;
    const end = Math.min(upto, lv.preds.length + 40);
    for (let k = lv.preds.length; k <= end; k++) lv.preds[k] = k < 10 ? null : model.predictAt(tc, k);
    $("lv-loading-text").textContent = `AI 전체 구간 계산 중… ${Math.round(lv.preds.length / (upto + 1) * 100)}%`;
    if (lv.preds.length > upto) { lv.job = null; setLoading(false); job.done(); }
    else setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
// 경고 기록은 '지금까지 재생한 시각'까지만 (비교표를 위해 끝까지 미리 계산해도 미래 경고가 새지 않게)
function lvLogUpTo(t) {
  for (let k = (lv.logT ?? -1) + 1; k <= t; k++) { lvThinkStep(k); lvLogEvents(k); }
  lv.logT = Math.max(lv.logT ?? -1, t);
}

// ── 'AI가 지금 하는 일': 매초 입력(센서)·내부(은닉 상태)·출력(세 예측)을 말로 적는다. 꾸민 문장이 아니라 그 시각의 실제 값으로 만든다
const fmtD = d => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}°C`;
function hiddenDelta(a, b) { if (!a || !b) return null; let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); }
function lvThinkStep(k) {
  const c = lv.c, p = PLANS[c.plan], pr = lv.preds[k];
  const say = (text, kind = "") => lv.thoughts.push({ t: k, text, kind });
  if (k === 0) { say(`센서 ${p.slots.filter(Boolean).length}개 연결. 화재 전 구간은 평상시 20°C로 채워 60초 창을 만듦`, "sys"); return; }
  if (k < 10) return;
  if (k === 10) say("첫 추론 — 이제부터 매초 최근 60초 창을 GRU에 넣어 남은 시간·플래시오버·화원 방을 동시에 계산", "sys");
  if (!pr) return;
  const T = (r, kk) => c.tc[r][Math.max(0, Math.min(kk, c.tc[r].length - 1))] / 10;
  const temps = p.slots.filter(Boolean).map(r => ({ r, T: T(r, k), d: T(r, k) - T(r, k - 10) }));
  const hot = temps.reduce((a, b) => b.T > a.T ? b : a), fast = temps.reduce((a, b) => b.d > a.d ? b : a);
  const quiet = hot.T < 30 && fast.d < 1.5;
  const prev = lv.preds[k - 10];
  const j = pr.room.indexOf(Math.max(...pr.room)), top = p.slots[j], pTop = pr.room[j];
  if (k % 5 === 0) {
    if (quiet) { if (k % 20 === 0) say(`모든 방 천장 온도 평상시(최고 ${hot.T.toFixed(0)}°C). 이상 신호 없음 — 계속 관찰`, "obs"); }
    else say(`${p.room_ko[hot.r]} 천장 ${hot.T.toFixed(0)}°C (${fmtD(hot.d)}/10초)` + (hot.r !== fast.r && fast.d >= 1.5 ? ` · ${p.room_ko[fast.r]}이(가) ${fmtD(fast.d)}/10초로 가장 빨리 오름` : hot.d >= 1.5 ? " — 가장 뜨겁고 가장 빨리 오름" : " — 상승 멈춤"), "obs");
  }
  if (k % 10 === 0 && !quiet) {
    const pp = prev ? prev.room[j] : null;
    const conf = pTop >= 0.9 ? "확신" : pTop >= 0.6 ? "유력" : "아직 불확실 — 방 간 온도 차가 작음";
    say(`화원 방 추정: ${p.room_ko[top]} ${(pTop * 100).toFixed(0)}%${pp != null ? ` (10초 전 ${(pp * 100).toFixed(0)}%)` : ""} — ${conf}`, "inf");
    const urg = p.slots.map((r, i) => r ? { r, ten: pr.ten[i], prevTen: prev ? prev.ten[i] : null } : null).filter(x => x && x.ten < 300).sort((a, b) => a.ten - b.ten)[0];
    if (urg) {
      const trend = urg.prevTen == null ? "" : urg.ten < urg.prevTen - 5 ? " · 줄어드는 중" : urg.ten > urg.prevTen + 5 ? " · 늘어남(온도 상승 둔화)" : " · 비슷";
      say(urg.ten < 5 ? `${p.room_ko[urg.r]}: 피난 불가로 판단 유지` : `${p.room_ko[urg.r]} 피난 불가까지 ${Math.round(urg.ten)}초${trend}` + (urg.ten > 60 && urg.ten <= 150 ? ` → 60초 경고까지 약 ${Math.round(urg.ten - 60)}초` : ""), "inf");
    } else say("모든 방 피난 가능 시간 5분 이상 — 당장 위험한 방 없음", "inf");
    const fo = foStatus(k, pr);
    if (fo.kind === "soon") say(`플래시오버 약 ${Math.round(fo.sec)}초 후 예상 (화원 방 상층 600°C)`, fo.sec < 60 ? "warn" : "inf");
    else if (fo.kind === "imminent") say("플래시오버 임박 — AI 남은 시간 5초 미만", "warn");
    else if (fo.kind === "guard") say(`천장 ${Math.round(lvHotT(k))}°C — 플래시오버 임박 판정 (온도 기준 보조)`, "warn");
    else if (fo.kind === "after" && !lv.flags.saidAfter) { lv.flags.saidAfter = k; say("플래시오버 발생 추정 — 경고 뒤 60초 경과. 이후 AI 출력은 학습 범위 밖이라 참고만", "sys"); }
  }
  if (k % 20 === 0 && !quiet) {
    const d = hiddenDelta(pr.h, lv.preds[k - 1] && lv.preds[k - 1].h);
    say(`GRU 은닉 상태 64차원 갱신 — 초당 변화 ${d == null ? "—" : d.toFixed(3)} (값이 클수록 새 정보가 많음)`, "sys");
  }
  if (k === Math.floor(c.t_end)) say("재생 끝 — FDS 정답과 비교표 작성", "done");
}
function lvThinkRender() {
  const body = $("lv-think-body"), st = $("lv-think-state"), dot = $("lv-think-dot");
  const t = Math.floor(lv.t), c = lv.c;
  const warn = Object.keys(lv.flags).some(f => f !== "room");
  const state = lv.t >= c.t_end ? "비교 중" : warn ? "경고 중" : t < 10 ? (lv.playing ? "수집 중" : "대기") : (lv.thoughts.some(x => x.kind === "inf") ? "추론 중" : "관찰 중");
  st.textContent = state; st.classList.toggle("warn", state === "경고 중");
  dot.classList.toggle("on", lv.playing);
  // 재생 중에는 매 프레임 불리므로, 새 줄이 생겼을 때만 DOM을 바꾼다 (매번 다시 그리면 등장 애니메이션이 계속 처음으로 돌아가 글이 안 보임)
  const key = `${lv.c.id}|${lv.thoughts.length}`;
  if (body.dataset.key === key) return;
  const prevN = body.dataset.key && body.dataset.key.split("|")[0] === lv.c.id ? +body.dataset.key.split("|")[1] : 0;
  body.dataset.key = key;
  const start = Math.max(0, lv.thoughts.length - 18);
  body.innerHTML = (lv.thoughts.length ? "" : `<div class="th idle">▶ 재생을 누르면 AI가 매초 무엇을 보고 어떻게 판단하는지 여기에 적힙니다.</div>`) +
    lv.thoughts.slice(start).map((x, i) => `<div class="th ${x.kind}${start + i >= prevN ? " new" : ""}"><span class="tt">${fmt(x.t)}</span><span>${x.text}</span></div>`).join("");
  body.scrollTop = 1e6;
}

// 화원 방(가장 뜨거운 방) 천장 온도 — 플래시오버 보조 판정용
function lvHotT(k) { const c = lv.c, p = PLANS[c.plan]; return Math.max(...p.slots.filter(Boolean).map(r => c.tc[r][Math.min(k, c.tc[r].length - 1)] / 10)); }
// 플래시오버 표시 한 곳에서 계산 (수치·생각 패널·경고 기록이 같은 말을 하도록)
//   AI 출력 + 보조 판정: 천장 500°C↑ = 임박(온도 기준), 경고 뒤 60초 = 발생 추정(그 뒤 출력은 학습 범위 밖)
function foStatus(k, pr) {
  if (!pr) return { text: "—", cls: "", kind: "none" };
  const warnAt = Math.min(lv.flags.fo60 ?? Infinity, lv.flags.foT ?? Infinity);
  if (k > warnAt + 60) return { text: "발생 추정", cls: "red", kind: "after" };
  if (lvHotT(k) >= 500) return { text: "임박 (천장 500°C↑)", cls: "red", kind: "guard" };
  if (pr.fo >= 300) return { text: "징후 없음", cls: "", kind: "none" };
  if (pr.fo < 5) return { text: "임박", cls: "red", kind: "imminent" };
  return { text: `약 ${Math.round(pr.fo)}초 후`, cls: pr.fo < 60 ? "red" : "", kind: "soon", sec: pr.fo };
}

function lvLogEvents(k) {
  const pr = lv.preds[k]; if (!pr) return;
  const p = PLANS[lv.c.plan];
  const add = (key, text, warn) => { if (lv.flags[key]) return; lv.flags[key] = k; lv.log.push({ t: k, text, warn }); if (warn) lv.thoughts.push({ t: k, text: `⚠ 경고 발령 — ${text}`, kind: "warn" }); };
  if (lvHotT(k) >= 500) add("foT", "화원 방 천장 500°C 초과 — 플래시오버 임박 (온도 기준 보조 판정)", true);
  const top = pr.room.indexOf(Math.max(...pr.room));
  if (pr.room[top] >= 0.9 && p.slots[top]) add("room", `화원 방 추정: ${p.room_ko[p.slots[top]]} (확률 ${Math.round(pr.room[top] * 100)}%)`, false);
  p.slots.forEach((r, j) => {
    if (!r) return;
    if (pr.ten[j] < 60) add(`w60_${r}`, `${p.room_ko[r]}: 60초 안에 피난 불가 예상`, true);
    if (pr.ten[j] < 5) add(`now_${r}`, `${p.room_ko[r]}: 피난 불가 판단`, true);
  });
  if (pr.fo < 60) add("fo60", `플래시오버 60초 안 예상 — 진입 금지 경고`, true);
  if (pr.fo < 5) add("fo5", `플래시오버 임박`, true);
}

function lvRender() {
  const c = lv.c, p = PLANS[c.plan], t = Math.floor(lv.t);
  lvEnsurePreds(t); lvLogUpTo(t);
  const pr = lv.preds[t];
  if (lv.viewPlan !== c.plan) {
    const prevMode = lv.view ? lv.view.mode : "3d";
    if (lv.view) lv.view.dispose();
    closePop();
    lv.view = makeView($("lv-svg"), $("lv-3d"), $("lv-2d"), p); lv.view.setMode(prevMode); lv.viewPlan = c.plan;
    lv.view.setPick(lvPick);
    viewModeSeg($("lv-viewmode"), lv.view, closePop);
  }
  $("lv-casenote").textContent = c.split === "test" ? "학습에 쓰지 않은 평가용 사례" : c.split === "new" ? "학습에 전혀 안 쓴 평면 — 평면 단위 평가" : c.split === "theory" ? "사용자 지정 평면 — FDS 정답 없음. 입력 온도는 구역 모델 근사, 비교표의 '정답'은 이론값(보수적)" : "⚠ 학습에 쓴 사례 — 참고용(평가 아님). 3D·평면도를 클릭해 조건을 바꾸면 이렇게 됩니다";
  const bar = $("lv-custombar"); bar.classList.toggle("hidden", c.split !== "theory");
  if (c.split === "theory") bar.innerHTML = `<b>사용자 지정 평면 시연</b> — 정답(FDS) 없음. 3D에서 방·문·창을 클릭하면 조건을 바꿔 다시 만듭니다. 비교표의 정답 자리는 이론값(보수적). <button class="btn secondary small" id="lv-toeditor" style="margin-left:8px">✎ 편집기로 돌아가기</button>`, $("lv-toeditor").onclick = () => CUSTOM.openEditor();
  const v = lv.view;
  v.setFire(lv.reveal ? c.fire_room : null, c.spot);
  for (const r of p.door_rooms) v.setDoor(r, lv.reveal ? (r === c.fire_room ? c.door_open : true) : true);
  for (const r in p.windows) v.setWindow(r, lv.reveal && r === c.fire_room && c.window_open);
  p.slots.forEach((r, j) => {
    if (!r) return;
    if (!pr) { v.setRoom(r, "#c9ced6", "센서 수집 중", smokeLevel(c, r, t)); return; }
    const rem = pr.ten[j] >= 300 ? null : pr.ten[j];
    const [color, text] = statusOf(rem, "피난 불가 (AI)");
    v.setRoom(r, color, pr.ten[j] >= 300 ? "피난 가능 (AI)" : text, smokeLevel(c, r, t));
  });
  const remaining = {}; p.slots.forEach((r, j) => { if (r) remaining[r] = !pr ? null : pr.ten[j] >= 300 ? null : pr.ten[j]; });
  goldenView($("lv-golden"), p, remaining, pr ? "AI 예측" : "센서 수집 중");
  const topJ = pr ? pr.room.indexOf(Math.max(...pr.room)) : -1;
  v.setAIMarker(pr && pr.room[topJ] > 0.5 && p.slots[topJ] ? p.slots[topJ] : null);
  $("lv-tlabel").textContent = fmt(t);
  $("lv-time").value = t; $("lv-time").max = c.t_end;
  $("lv-title").textContent = `${p.title} — AI가 본 방별 남은 시간`;

  // 화원 확률
  const rooms = p.slots.map((r, j) => r ? { r, pct: pr ? pr.room[j] : 0 } : null).filter(Boolean).sort((a, b) => b.pct - a.pct);
  $("lv-probs").innerHTML = rooms.map(x => `<div>${p.room_ko[x.r]}</div><div class="bar"><i style="width:${(x.pct * 100).toFixed(1)}%"></i></div><div class="num">${pr ? (x.pct * 100).toFixed(0) + "%" : "—"}</div>`).join("");

  // KPI
  const stat = (k, v, cls = "") => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  const fo = foStatus(t, pr);
  const topRoom = rooms[0];
  let html = stat("경과 시간", fmt(t)) +
    stat("AI: 플래시오버까지", fo.text, fo.cls) +
    stat("AI: 화원 방", pr ? `${p.room_ko[topRoom.r]} ${(topRoom.pct * 100).toFixed(0)}%` : "—");
  if (lv.reveal) html += stat("정답: 화원 방", `${p.room_ko[c.fire_room]}`, "ok") + stat("정답: 플래시오버", c.t_flashover == null ? "안 일어남" : fmt(c.t_flashover), "ok");
  $("lv-kpi").innerHTML = html;

  // 로그
  $("lv-log").innerHTML = lv.log.map(e => `<div class="${e.warn ? "warn" : ""}">${fmt(e.t)}  ${e.text}</div>`).join("") || `<div class="note">아직 경고 없음</div>`;
  $("lv-log").scrollTop = 1e6;

  lvChart(t);
  lvThinkRender();
  if (lv.reveal || lv.t >= c.t_end) lvResult(); else $("lv-result").innerHTML = `<div class="note">재생이 끝나거나 '정답 표시'를 켜면 비교표가 나옵니다.</div>`;
}

// 그래프 색: 색은 데이터에만 — AI가 지금 화원으로 보는 방만 강조색, 나머지는 회색 단계 (DESIGN.md)
const ROOM_GREYS_LIGHT = ["#4b5055", "#6b7075", "#858a8f", "#9aa0a6", "#afb4b9", "#c4c8cc", "#5d5f60"];
const ROOM_GREYS_DARK = ["#c9ccd1", "#aeb2b8", "#969aa0", "#7f8389", "#6a6e74", "#55595f", "#b4b8be"];
const roomColors = (fireIdx = -1) => {
  const greys = document.documentElement.dataset.theme === "dark" ? ROOM_GREYS_DARK : ROOM_GREYS_LIGHT;
  return greys.map((g, j) => (j === fireIdx ? cssVar("--accent", "#1b6c80") : g));
};
function lvChart(t) {
  const prNow = lv.preds && lv.preds[Math.floor(t)];
  const fireIdx = prNow && prNow.room ? prNow.room.indexOf(Math.max(...prNow.room)) : -1;
  const ROOM_COLORS = roomColors(fireIdx);
  const cv = $("lv-chart"), p = PLANS[lv.c.plan];
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  const L = 44, R = 10, T = 10, B = 24;
  const tmax = lv.c.t_end;
  let ymax = 100;
  p.slots.forEach(r => { if (r) for (let k = 0; k <= t && k < lv.c.tc[r].length; k++) ymax = Math.max(ymax, lv.c.tc[r][k] / 10); });
  ymax = Math.ceil(ymax / 100) * 100;
  const X = x => L + (x / tmax) * (w - L - R), Y = y => T + (1 - (y - 0) / ymax) * (h - T - B);
  g.strokeStyle = cssVar("--line", "#2a3140"); g.fillStyle = cssVar("--muted", "#9aa3b2"); g.font = "11px 'IBM Plex Sans KR', 'Malgun Gothic', sans-serif"; g.textAlign = "right";
  for (let y = 0; y <= ymax; y += ymax / 4) { g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(w - R, Y(y)); g.stroke(); g.fillText(y + "°", L - 4, Y(y) + 4); }
  g.textAlign = "center";
  for (let x = 0; x <= tmax; x += 60) { g.fillText(fmt(x), X(x), h - 6); }
  p.slots.forEach((r, j) => {
    if (!r) return;
    g.strokeStyle = ROOM_COLORS[j]; g.lineWidth = j === fireIdx ? 2.2 : 1.3; g.beginPath();
    const arr = lv.c.tc[r];
    for (let k = 0; k <= t && k < arr.length; k++) { const px = X(k), py = Y(arr[k] / 10); k ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
  });
  // 범례
  g.textAlign = "left"; let lx = L + 6;
  p.slots.forEach((r, j) => { if (!r) return; g.fillStyle = ROOM_COLORS[j]; g.fillRect(lx, T + 2, 10, 10); g.fillStyle = cssVar("--ink", "#eceae4"); g.fillText(p.room_ko[r], lx + 13, T + 11); lx += 13 + g.measureText(p.room_ko[r]).width + 10; });
  // 현재 시각 선
  g.strokeStyle = cssVar("--ink", "#131416"); g.lineWidth = 1; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(t), T); g.lineTo(X(t), h - B); g.stroke(); g.setLineDash([]);
}

function lvResult() {
  const c = lv.c, p = PLANS[c.plan];
  const tEnd = Math.floor(c.t_end);
  if (lv.preds.length <= tEnd) {   // 끝까지 계산이 안 돼 있으면 뒤에서 나눠 계산하고 끝나면 다시 그림
    $("lv-result").innerHTML = `<div class="note">AI 전체 구간 계산 중…</div>`;
    lvEnsurePredsAsync(tEnd, () => { if (lv.c === c && (lv.reveal || lv.t >= c.t_end)) lvResult(); });
    return;
  }
  const firstT = (cond) => { for (let k = 10; k < lv.preds.length; k++) if (lv.preds[k] && cond(lv.preds[k], k)) return k; return null; };
  const rows = p.slots.map((r, j) => {
    if (!r) return "";
    const actual = c.rooms[r].t_untenable;
    const w60 = firstT(pr => pr.ten[j] < 60), now = firstT(pr => pr.ten[j] < 5);
    let verdict;
    if (actual == null) verdict = now == null ? "✓ 안전으로 맞게 판단" : "✗ 헛경고";
    else if (w60 == null) verdict = "✗ 경고 놓침";
    else verdict = `경고 ${Math.round(actual - w60)}초 전`;
    return `<tr><td>${p.room_ko[r]}${r === c.fire_room ? " 🔥" : ""}</td><td class="num">${w60 == null ? "—" : fmt(w60)}</td><td class="num">${now == null ? "—" : fmt(now)}</td><td class="num"><b>${actual == null ? "안 옴" : fmt(actual)}</b></td><td>${verdict}</td></tr>`;
  }).join("");
  const at30 = lv.preds[30] || lv.preds[lv.preds.length - 1];
  const topIdx = at30 ? at30.room.indexOf(Math.max(...at30.room)) : -1;
  const foW = firstT((pr, k) => pr.fo < 60 || lvHotT(k) >= 500);   // AI 경고 또는 온도 기준 보조 판정
  const truth = c.split === "theory" ? "이론값(근사)" : "FDS 정답";
  $("lv-result-card").querySelector("h2").textContent = `AI 예측 vs ${truth}`;
  $("lv-result").innerHTML = `<table><tr><th>방</th><th class="num">AI "60초 안" 경고</th><th class="num">AI "피난 불가"</th><th class="num">${c.split === "theory" ? "이론 피난 불가" : "FDS 실제 피난 불가"}</th><th>판정</th></tr>${rows}</table>
    <table style="margin-top:10px"><tr><th></th><th>AI</th><th>${truth}</th></tr>
    <tr><td>화원 방 (화재 30초 시점)</td><td>${topIdx >= 0 && p.slots[topIdx] ? p.room_ko[p.slots[topIdx]] + ` (${Math.round(at30.room[topIdx] * 100)}%)` : "—"}</td><td>${p.room_ko[c.fire_room]} ${topIdx >= 0 && p.slots[topIdx] === c.fire_room ? "✓" : "✗"}</td></tr>
    <tr><td>플래시오버 "60초 안" 경고 (AI + 천장 500°C 보조)</td><td>${foW == null ? "경고 없음" : fmt(foW)}</td><td>${c.t_flashover == null ? "안 일어남" + (foW == null ? " ✓" : " (헛경고)") : fmt(c.t_flashover) + (foW == null ? " (놓침)" : ` (경고 ${Math.round(c.t_flashover - foW)}초 전)`)}</td></tr></table>`;
}

function lvLoad(id) {
  lv.c = CASE_BY_ID[id]; lv.t = 0; lv.preds = []; lv.log = []; lv.flags = {}; lv.logT = -1; lv.thoughts = []; lv.playing = false; lv.job = null;
  setLoading(false);
  lvSetPlayLabel();
  if (lv.refreshReveal) lv.refreshReveal();   // 목록 글자·'표시' 버튼을 현재 상태에 맞춤 (목록에 없는 사례면 '직접 고른 조건' 항목 추가)
  $("lv-case").value = id;
  lvPlanTabs();
  lvRender();
}

function lvSetPlayLabel() { $("lv-play").textContent = lv.playing ? "⏸ 멈춤" : "▶ 재생"; $("lv-play2").textContent = lv.playing ? "⏸" : "▶"; }
function lvTogglePlay() {
  if (lv.playing) { lv.playing = false; lvSetPlayLabel(); lvThinkRender(); return; }
  if (lv.t >= lv.c.t_end) { lv.t = 0; lv.log = []; lv.flags = {}; lv.preds = []; lv.logT = -1; lv.thoughts = []; lv.job = null; setLoading(false); }
  lv.playing = true; lv.last = performance.now(); lvSetPlayLabel();
  lv.raf = requestAnimationFrame(lvLoop);
}

function lvLoop(ts) {
  if (!lv.playing) return;
  const dt = (ts - lv.last) / 1000; lv.last = ts;
  lv.t = Math.min(lv.t + dt * lv.speed, lv.c.t_end);
  lvRender();
  if (lv.t >= lv.c.t_end) { lv.playing = false; lvSetPlayLabel(); lvThinkRender(); return; }
  lv.raf = requestAnimationFrame(lvLoop);
}

// 보기 창 위의 평면 탭: 유형 A / B / C(계산 전엔 비활성) / 사용자 지정(이론값)
function lvPlanTabs() {
  const items = Object.keys(PLANS).filter(k => !PLANS[k].custom).map(k => { const has = CASES.some(c => c.plan === k && (c.split === "test" || c.split === "new")); return { value: k, label: planShort(k) + (has ? "" : " · 계산 중"), disabled: !has }; });
  items.push({ value: "custom", label: "사용자 지정 (직접 그리기 · 이론값)" });
  seg($("lv-plantabs"), items, lv.custom || lv.c.plan === "custom" ? "custom" : lv.c.plan, v => {
    closePop();
    if (v === "custom") { CUSTOM.openEditor(); return; }
    lv.custom = false; $("lv-live-area").classList.remove("hidden"); $("lv-custom").classList.add("hidden");
    if (lv.c.plan !== v) {
      const first = CASES.filter(c => c.plan === v && (c.split === "test" || c.split === "new")).sort((a, b) => a.id.localeCompare(b.id))[0];
      lv.reveal = false; lvLoad(first.id);
    } else lvPlanTabs();
    if (lv.view) { lv.view.resize(); lvChart(Math.floor(lv.t)); }
  });
}

function lvSetup() {
  // 목록: 학습에 쓰지 않은 사례(평가용) + 학습에 전혀 안 쓴 평면의 사례. 클릭으로 고른 다른 사례는 '직접 고른 조건'으로 끝에 붙음
  const tests = CASES.filter(c => c.split === "test" || c.split === "new").sort((a, b) => a.id.localeCompare(b.id));
  const sel = $("lv-case");
  const fillCases = () => {
    const cur = lv.c ? lv.c.id : sel.value;
    sel.innerHTML = tests.map((c, i) => `<option value="${c.id}">${lvCaseLabel(c, i)}</option>`).join("");
    if (cur && !tests.some(c => c.id === cur)) sel.insertAdjacentHTML("beforeend", `<option value="${cur}">${lvCaseLabel(CASE_BY_ID[cur], null)}</option>`);
    if (cur) sel.value = cur;
  };
  fillCases();
  const preferred = tests.find(c => c.id === "bs_bigbr_s0_d1_w0_fast_2MW") || tests[0];
  sel.value = preferred.id;
  sel.onchange = () => lvLoad(sel.value);
  const speedRefresh = () => seg($("lv-speed"), [1, 5, 20].map(x => ({ value: x, label: `${x}배속` })), lv.speed, v => { lv.speed = +v; speedRefresh(); });
  speedRefresh();
  const revealRefresh = () => { seg($("lv-reveal"), [{ value: 0, label: "가림" }, { value: 1, label: "표시" }], lv.reveal ? 1 : 0, v => { lv.reveal = !!+v; revealRefresh(); lvRender(); }); fillCases(); };
  lv.refreshReveal = revealRefresh;
  revealRefresh();
  $("lv-play").onclick = lvTogglePlay;
  $("lv-play2").onclick = lvTogglePlay;
  fullscreenBtn("lv-full", "lv-card");
  $("lv-reset").onclick = () => lvLoad(sel.value);
  $("lv-random").onclick = () => {   // 평가용(학습 제외) 사례 중 무작위, 조건은 가린 채
    const pool = tests.filter(c => !lv.c || c.id !== lv.c.id);
    const c = pool[Math.floor(Math.random() * pool.length)];
    lv.reveal = false; lvLoad(c.id); toast("무작위 사례를 골랐습니다 — 조건은 가려져 있어요. ▶ 재생");
  };
  $("lv-time").oninput = e => { lv.t = +e.target.value; lvRender(); };
  window.addEventListener("resize", () => { if (lv.c) lvChart(Math.floor(lv.t)); });
  lvLoad(preferred.id);
}

// ───────────────────────── 시작 ─────────────────────────
async function init() {
  const [plans, cases, spec] = await Promise.all(["plans", "cases", "model"].map(n => fetch(`data/${n}.json?v=20261029a`).then(r => r.json())));
  PLANS = plans; CASES = cases; MODEL = spec; model = new GRUModel(spec);
  for (const c of CASES) CASE_BY_ID[c.id] = c;
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
    document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
    document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("on", s.id === `tab-${b.dataset.tab}`));
    if (b.dataset.tab === "live" && lv.c) { lvChart(Math.floor(lv.t)); lv.view.resize(); if (lv.custom) CUSTOM.redraw(); }
    if (b.dataset.tab === "scenario" && sc.view) sc.view.resize();
  });
  themeSeg();
  scSetup();
  fullscreenBtn("sc-full", "sc-card");
  lvSetup();
  window.PLANS = PLANS; window.model = model;   // custom.js(사용자 지정 이론값)에서 씀
  window.FC = { PLANS, CASES, model, sc, lv };   // 콘솔 점검용
}
init().catch(e => { document.body.insertAdjacentHTML("afterbegin", `<div class="banner red">데이터를 불러오지 못했습니다: ${e.message}. 이 페이지는 웹 서버(또는 GitHub Pages)에서 열어야 합니다.</div>`); console.error(e); });
