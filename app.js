// FlashCount 웹 데모 — ① 시나리오(FDS 결과 열람) ② 실시간 AI 예측(브라우저에서 GRU 계산) ③ 설명
"use strict";

const S = 60;            // 1 m = 60 px
const PAD = 0.35;        // 평면 바깥 여백 (m)
let PLANS, CASES, MODEL, model;
const CASE_BY_ID = {};
const $ = id => document.getElementById(id);
const fmt = s => (s == null || isNaN(s)) ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const PLAN_SHORT = { lh: "신축 LH 84㎡형", bs: "구축 백송 5단지형" };
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
  const gFloor = el("g", {}), gRooms = el("g", {}), gSolid = el("g", {}), gDoors = el("g", {}), gWin = el("g", {}), gFire = el("g", {}), gText = el("g", {});
  for (const m of plan.meshes) rect(m, { fill: "#ffffff" }, gFloor);
  const rooms = {};
  for (const r in plan.rooms) {
    const node = rect(plan.rooms[r], { fill: "#cfe8d6", "fill-opacity": .9 }, gRooms);
    const [cx, cy] = plan.centers[r];
    const label = el("text", { x: X(cx), y: Y(cy) - 6, "text-anchor": "middle", class: "room-label" }, gText);
    label.textContent = plan.room_ko[r];
    const status = el("text", { x: X(cx), y: Y(cy) + 14, "text-anchor": "middle", class: "room-status" }, gText);
    rooms[r] = { node, status };
  }
  for (const s of plan.solids) {
    rect(s.xb, { fill: s.wall ? "#1b1d22" : "#8a8f98" }, gSolid);
    if (!s.wall && s.ko) {
      const t = el("text", { x: X((s.xb[0] + s.xb[1]) / 2), y: Y((s.xb[2] + s.xb[3]) / 2) + 4, "text-anchor": "middle", fill: "#fff", "font-size": 12 }, gSolid);
      t.textContent = s.ko;
    }
  }
  const doors = {};
  for (const r in plan.doors) {
    const xb = plan.doors[r];
    doors[r] = { node: rect(xb, { fill: "#ffffff" }, gDoors) };
    const t = el("text", { x: X((xb[0] + xb[1]) / 2), y: Y((xb[2] + xb[3]) / 2) + 4, "text-anchor": "middle", fill: "#b8431c", "font-size": 11 }, gDoors);
    t.textContent = "문";
    doors[r].text = t;
  }
  const wins = {};
  for (const r in plan.windows) {
    const xb = plan.windows[r];
    wins[r] = el("line", { x1: X(xb[0]), y1: Y(xb[2]), x2: X(xb[1]), y2: Y(xb[3]), stroke: "#2f6690", "stroke-width": 7 }, gWin);
  }
  const fire = el("g", { visibility: "hidden" }, gFire);
  const fireRect = el("rect", { width: .6 * S, height: .6 * S, fill: "#e8572a", rx: 4 }, fire);
  const fireText = el("text", { "text-anchor": "middle", fill: "#fff", "font-size": 12, "font-weight": 700 }, fire);
  fireText.textContent = "화원";
  const note = el("text", { x: 8, y: H - 8, "font-size": 12, fill: "#5f6672" }, gText);
  note.textContent = "파랑: 창   검정: 벽   회색: 계산에서 뺀 공간(욕실 등)";
  return {
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
      d.text.setAttribute("fill", open ? "#b8431c" : "#fff");
    },
    setWindow(room, open) {
      const w = wins[room]; if (!w) return;
      w.setAttribute("stroke", open ? "#90caf9" : "#2f6690");
      w.setAttribute("stroke-dasharray", open ? "8 6" : "");
    },
    setRoom(r, color, text) { rooms[r].node.setAttribute("fill", color); rooms[r].status.textContent = text; },
  };
}

// 남은 시간 → 색·글자
function statusOf(remaining, passedText = "피난 불가") {
  if (remaining == null) return ["#cfe8d6", "안전"];
  if (remaining < 5) return ["#e53935", passedText];
  if (remaining <= 60) return ["#ffab40", `${Math.round(remaining)}초 남음`];
  if (remaining <= 180) return ["#ffe082", `${Math.round(remaining)}초 남음`];
  return ["#cfe8d6", `${Math.round(remaining)}초 남음`];
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
  if (!p.fire[sc.room]) sc.room = Object.keys(p.fire)[0];
  if (sc.spot >= p.fire[sc.room].length) sc.spot = 0;
  if (!p.door_rooms.includes(sc.room)) sc.door = true;
  return CASE_BY_ID[`${sc.plan}_${sc.room}_s${sc.spot}_d${sc.door ? 1 : 0}_w${sc.win ? 1 : 0}_${sc.growth}_${sc.q}MW`];
}

function scRender() {
  const p = PLANS[sc.plan], c = scCase();
  const isDoor = p.door_rooms.includes(sc.room);
  const isCook = sc.room === p.cooktop[0] && sc.spot === p.cooktop[1];
  seg($("sc-plan"), [{ value: "lh", label: "신축 (LH트릴로채 84㎡형)" }, { value: "bs", label: "구축 (백송마을5단지형)" }], sc.plan, v => { sc.plan = v; sc.t = 0; scRender(); });
  seg($("sc-room"), Object.keys(p.fire).map(r => ({ value: r, label: p.room_ko[r] })), sc.room, v => { sc.room = v; sc.spot = 0; sc.t = 0; scRender(); });
  const spots = p.fire[sc.room];
  seg($("sc-spot"), spots.map((_, i) => ({ value: i, label: spots.length > 1 ? `화원 ${i + 1}` : "1곳" })), sc.spot, v => { sc.spot = +v; sc.t = 0; scRender(); });
  $("sc-spot-note").textContent = isCook ? "조리대(가스레인지) 위치 → 조리 화재 곡선(기름 불 100 kW 유지 후 확대)" : spots.length > 1 ? "넓은 공간은 마주 보는 두 벽(TV·소파) 가운데" : "";
  seg($("sc-door"), [{ value: 1, label: "열림", disabled: !isDoor }, { value: 0, label: "닫힘", disabled: !isDoor }], sc.door ? 1 : 0, v => { sc.door = !!+v; sc.t = 0; scRender(); });
  $("sc-door-note").textContent = isDoor ? "" : "거실·주방은 문이 없는 열린 공간";
  seg($("sc-win"), [{ value: 0, label: "닫힘" }, { value: 1, label: "열림" }], sc.win ? 1 : 0, v => { sc.win = !!+v; sc.t = 0; scRender(); });
  seg($("sc-growth"), [{ value: "medium", label: "보통" }, { value: "fast", label: "빠름" }, { value: "ultrafast", label: "매우 빠름" }], sc.growth, v => { sc.growth = v; sc.t = 0; scRender(); });
  $("sc-growth-note").textContent = "t² 화재 성장 곡선: 보통 = 소파류, 빠름 = 매트리스·커튼, 매우 빠름 = 포장재·가연성 액체 수준";
  seg($("sc-q"), [{ value: 2, label: "2 MW" }, { value: 4, label: "4 MW" }], sc.q, v => { sc.q = +v; sc.t = 0; scRender(); });
  $("sc-caseid").textContent = `케이스 ${c.id}` + (c.split === "test" ? " · AI 학습에 쓰지 않은 평가용" : "");
  $("sc-title").textContent = `${p.title} — ${p.room_ko[sc.room]} 화재`;

  if (sc.viewPlan !== sc.plan) { sc.view = makePlanView($("sc-svg"), p); sc.viewPlan = sc.plan; }
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
  const a = isDoor ? (sc.door ? "문 열림 (현재)" : "문 닫힘 (현재)") : (sc.win ? "창 열림 (현재)" : "창 닫힘 (현재)");
  const b = isDoor ? (sc.door ? "문 닫힘" : "문 열림") : (sc.win ? "창 닫힘" : "창 열림");
  const cmpRows = Object.keys(p.rooms).map(r => `<tr><td>${p.room_ko[r]}${r === sc.room ? " 🔥" : ""}</td><td class="num">${fmt(c.rooms[r].t_untenable)}</td><td class="num">${fmt(o.rooms[r].t_untenable)}</td></tr>`).join("");
  $("sc-compare-card").querySelector("h2").textContent = isDoor ? "불난 방의 문을 닫으면?" : "창을 열면?";
  $("sc-compare").innerHTML = `<table><tr><th>피난 불가 시각</th><th class="num">${a}</th><th class="num">${b}</th></tr>${cmpRows}<tr><td>플래시오버</td><td class="num">${fmt(c.t_flashover)}</td><td class="num">${fmt(o.t_flashover)}</td></tr></table>
    <div class="note" style="margin-top:6px">${isDoor ? "침실 화재 228건 전체: 문을 닫으면 다른 방 피난 불가 0%, 열면 100%(중앙값 1분 20초)." : "창이 닫힌 집은 플래시오버 뒤 산소가 바닥나 불이 약해집니다(창 닫힘 75%). 다만 그 방문을 갑자기 열면 역화 위험이 있습니다."}</div>`;
}

function scTick() {
  const p = PLANS[sc.plan], c = scCase(), t = sc.t;
  for (const r in p.rooms) {
    const tu = c.rooms[r].t_untenable;
    const [color, text] = statusOf(tu == null ? null : tu - t);
    sc.view.setRoom(r, color, text);
  }
  $("sc-tlabel").textContent = fmt(t);
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
const lv = { c: null, t: 0, playing: false, speed: 5, reveal: false, preds: [], log: [], flags: {}, view: null, viewPlan: null, raf: null, last: 0 };

function lvCaseLabel(c) {
  const p = PLANS[c.plan];
  return `${PLAN_SHORT[c.plan]} · ${p.room_ko[c.fire_room]} 화재${c.cooktop ? "(조리)" : ""} · 문 ${p.door_rooms.includes(c.fire_room) ? (c.door_open ? "열림" : "닫힘") : "없음"} · 창 ${c.window_open ? "열림" : "닫힘"} · ${GROWTH_KO[c.growth]} · ${c.q_mw} MW`;
}

function lvTcBySlot() {
  const p = PLANS[lv.c.plan];
  return p.slots.map(r => r ? lv.c.tc[r].map(v => v / 10) : null);
}

function lvEnsurePreds(upto) {
  const tc = lvTcBySlot();
  for (let k = lv.preds.length; k <= upto; k++) {
    lv.preds[k] = k < 10 ? null : model.predictAt(tc, k);
    lvLogEvents(k);
  }
}

function lvLogEvents(k) {
  const pr = lv.preds[k]; if (!pr) return;
  const p = PLANS[lv.c.plan];
  const add = (key, text, warn) => { if (lv.flags[key]) return; lv.flags[key] = k; lv.log.push({ t: k, text, warn }); };
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
  lvEnsurePreds(t);
  const pr = lv.preds[t];
  if (lv.viewPlan !== c.plan) { lv.view = makePlanView($("lv-svg"), p); lv.viewPlan = c.plan; }
  const v = lv.view;
  v.setFire(lv.reveal ? c.fire_room : null, c.spot);
  for (const r of p.door_rooms) v.setDoor(r, lv.reveal ? (r === c.fire_room ? c.door_open : true) : true);
  for (const r in p.windows) v.setWindow(r, lv.reveal && r === c.fire_room && c.window_open);
  p.slots.forEach((r, j) => {
    if (!r) return;
    if (!pr) { v.setRoom(r, "#e9ecef", "센서 수집 중"); return; }
    const rem = pr.ten[j] >= 300 ? null : pr.ten[j];
    const [color, text] = statusOf(rem, "피난 불가 (AI)");
    v.setRoom(r, color, pr.ten[j] >= 300 ? "안전 (AI)" : text);
  });
  $("lv-tlabel").textContent = fmt(t);
  $("lv-time").value = t; $("lv-time").max = c.t_end;
  $("lv-title").textContent = `${p.title} — AI가 본 방별 남은 시간`;

  // 화원 확률
  const rooms = p.slots.map((r, j) => r ? { r, pct: pr ? pr.room[j] : 0 } : null).filter(Boolean).sort((a, b) => b.pct - a.pct);
  $("lv-probs").innerHTML = rooms.map(x => `<div>${p.room_ko[x.r]}</div><div class="bar"><i style="width:${(x.pct * 100).toFixed(1)}%"></i></div><div class="num">${pr ? (x.pct * 100).toFixed(0) + "%" : "—"}</div>`).join("");

  // KPI
  const stat = (k, v, cls = "") => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  // 플래시오버 뒤 구간은 학습 목표에서 뺐으므로(발생 30초 뒤부터) 경고 후 60초가 지나면 '발생 추정'으로 고정
  const foTxt = !pr ? "—" : (lv.flags.fo60 != null && t > lv.flags.fo60 + 60) ? "발생 추정" : pr.fo >= 300 ? "징후 없음" : pr.fo < 5 ? "임박" : `약 ${Math.round(pr.fo)}초 후`;
  const topRoom = rooms[0];
  let html = stat("경과 시간", fmt(t)) +
    stat("AI: 플래시오버까지", foTxt, pr && pr.fo < 60 ? "red" : "") +
    stat("AI: 화원 방", pr ? `${p.room_ko[topRoom.r]} ${(topRoom.pct * 100).toFixed(0)}%` : "—");
  if (lv.reveal) html += stat("정답: 화원 방", `${p.room_ko[c.fire_room]}`, "ok") + stat("정답: 플래시오버", c.t_flashover == null ? "안 일어남" : fmt(c.t_flashover), "ok");
  $("lv-kpi").innerHTML = html;

  // 로그
  $("lv-log").innerHTML = lv.log.map(e => `<div class="${e.warn ? "warn" : ""}">${fmt(e.t)}  ${e.text}</div>`).join("") || `<div class="note">아직 경고 없음</div>`;
  $("lv-log").scrollTop = 1e6;

  lvChart(t);
  if (lv.reveal || lv.t >= c.t_end) lvResult(); else $("lv-result").innerHTML = `<div class="note">재생이 끝나거나 '정답 표시'를 켜면 비교표가 나옵니다.</div>`;
}

const ROOM_COLORS = ["#b8431c", "#2f6690", "#2e8b57", "#8e44ad", "#e67e22", "#7f8c8d", "#1b1d22"];
function lvChart(t) {
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
  g.strokeStyle = "#e2e5ea"; g.fillStyle = "#5f6672"; g.font = "11px Malgun Gothic"; g.textAlign = "right";
  for (let y = 0; y <= ymax; y += ymax / 4) { g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(w - R, Y(y)); g.stroke(); g.fillText(y + "°", L - 4, Y(y) + 4); }
  g.textAlign = "center";
  for (let x = 0; x <= tmax; x += 60) { g.fillText(fmt(x), X(x), h - 6); }
  p.slots.forEach((r, j) => {
    if (!r) return;
    g.strokeStyle = ROOM_COLORS[j]; g.lineWidth = 2; g.beginPath();
    const arr = lv.c.tc[r];
    for (let k = 0; k <= t && k < arr.length; k++) { const px = X(k), py = Y(arr[k] / 10); k ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
  });
  // 범례
  g.textAlign = "left"; let lx = L + 6;
  p.slots.forEach((r, j) => { if (!r) return; g.fillStyle = ROOM_COLORS[j]; g.fillRect(lx, T + 2, 10, 10); g.fillStyle = "#1b1d22"; g.fillText(p.room_ko[r], lx + 13, T + 11); lx += 13 + g.measureText(p.room_ko[r]).width + 10; });
  // 현재 시각 선
  g.strokeStyle = "#b8431c"; g.lineWidth = 1; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(t), T); g.lineTo(X(t), h - B); g.stroke(); g.setLineDash([]);
}

function lvResult() {
  const c = lv.c, p = PLANS[c.plan];
  lvEnsurePreds(Math.floor(c.t_end));
  const firstT = (cond) => { for (let k = 10; k < lv.preds.length; k++) if (lv.preds[k] && cond(lv.preds[k])) return k; return null; };
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
  const foW = firstT(pr => pr.fo < 60);
  $("lv-result").innerHTML = `<table><tr><th>방</th><th class="num">AI "60초 안" 경고</th><th class="num">AI "피난 불가"</th><th class="num">FDS 실제 피난 불가</th><th>판정</th></tr>${rows}</table>
    <table style="margin-top:10px"><tr><th></th><th>AI</th><th>FDS 정답</th></tr>
    <tr><td>화원 방 (화재 30초 시점)</td><td>${topIdx >= 0 && p.slots[topIdx] ? p.room_ko[p.slots[topIdx]] + ` (${Math.round(at30.room[topIdx] * 100)}%)` : "—"}</td><td>${p.room_ko[c.fire_room]} ${topIdx >= 0 && p.slots[topIdx] === c.fire_room ? "✓" : "✗"}</td></tr>
    <tr><td>플래시오버 "60초 안" 경고</td><td>${foW == null ? "경고 없음" : fmt(foW)}</td><td>${c.t_flashover == null ? "안 일어남" + (foW == null ? " ✓" : " (헛경고)") : fmt(c.t_flashover) + (foW == null ? " (놓침)" : ` (경고 ${Math.round(c.t_flashover - foW)}초 전)`)}</td></tr></table>`;
}

function lvLoad(id) {
  lv.c = CASE_BY_ID[id]; lv.t = 0; lv.preds = []; lv.log = []; lv.flags = {}; lv.playing = false;
  $("lv-play").textContent = "▶ 재생";
  lvRender();
}

function lvLoop(ts) {
  if (!lv.playing) return;
  const dt = (ts - lv.last) / 1000; lv.last = ts;
  lv.t = Math.min(lv.t + dt * lv.speed, lv.c.t_end);
  lvRender();
  if (lv.t >= lv.c.t_end) { lv.playing = false; $("lv-play").textContent = "▶ 재생"; return; }
  lv.raf = requestAnimationFrame(lvLoop);
}

function lvSetup() {
  const tests = CASES.filter(c => c.split === "test").sort((a, b) => a.id.localeCompare(b.id));
  const sel = $("lv-case");
  sel.innerHTML = tests.map(c => `<option value="${c.id}">${lvCaseLabel(c)}</option>`).join("");
  const preferred = tests.find(c => c.id === "bs_bigbr_s0_d1_w0_fast_2MW") || tests[0];
  sel.value = preferred.id;
  sel.onchange = () => lvLoad(sel.value);
  const speedRefresh = () => seg($("lv-speed"), [1, 5, 20].map(x => ({ value: x, label: `${x}배속` })), lv.speed, v => { lv.speed = +v; speedRefresh(); });
  speedRefresh();
  const revealRefresh = () => seg($("lv-reveal"), [{ value: 0, label: "가림" }, { value: 1, label: "표시" }], lv.reveal ? 1 : 0, v => { lv.reveal = !!+v; revealRefresh(); lvRender(); });
  revealRefresh();
  $("lv-play").onclick = () => {
    if (lv.playing) { lv.playing = false; $("lv-play").textContent = "▶ 재생"; return; }
    if (lv.t >= lv.c.t_end) { lv.t = 0; lv.log = []; lv.flags = {}; lv.preds = []; }
    lv.playing = true; lv.last = performance.now(); $("lv-play").textContent = "⏸ 멈춤";
    lv.raf = requestAnimationFrame(lvLoop);
  };
  $("lv-reset").onclick = () => lvLoad(sel.value);
  $("lv-time").oninput = e => { lv.t = +e.target.value; lvRender(); };
  window.addEventListener("resize", () => { if (lv.c) lvChart(Math.floor(lv.t)); });
  lvLoad(preferred.id);
}

// ───────────────────────── 시작 ─────────────────────────
async function init() {
  const [plans, cases, spec] = await Promise.all(["plans", "cases", "model"].map(n => fetch(`data/${n}.json`).then(r => r.json())));
  PLANS = plans; CASES = cases; MODEL = spec; model = new GRUModel(spec);
  for (const c of CASES) CASE_BY_ID[c.id] = c;
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
    document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
    document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("on", s.id === `tab-${b.dataset.tab}`));
    if (b.dataset.tab === "live" && lv.c) lvChart(Math.floor(lv.t));
  });
  scSetup();
  lvSetup();
  window.FC = { PLANS, CASES, model, sc, lv };   // 콘솔 점검용
}
init().catch(e => { document.body.insertAdjacentHTML("afterbegin", `<div class="banner red">데이터를 불러오지 못했습니다: ${e.message}. 이 페이지는 웹 서버(또는 GitHub Pages)에서 열어야 합니다.</div>`); console.error(e); });
