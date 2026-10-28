// 사용자 지정: 방 크기·개구부·화재 조건을 직접 넣으면 FDS 정답 없이 '이론값(상관식)'을 보수적으로 계산하고,
// 그 이론 온도 곡선을 센서 입력처럼 AI에 넣었을 때의 반응을 참고로 보여 준다.
//   플래시오버 열방출률  Thomas: Q_fo = 7.8·A_T + 378·A_o·√H_o [kW]           (SFPE 핸드북)
//   상층 온도           MQH:    ΔT = 6.85·(Q² / (A_o√H_o · h_k·A_T))^(1/3)    h_k = √(kρc/t) (석고보드)
//   연기층 하강          Heskestad 플룸 유량으로 방을 채움 (유출 없음 가정 → 빠른 쪽 = 보수적)
//   화재 성장           t² (보통·빠름·매우 빠름), 최대 열방출률에서 유지
// 정답(FDS)이 없는 추정치이므로 화면에 '이론값'이라고 명시한다.
"use strict";

const CUSTOM = (() => {
  const ALPHA = { medium: 0.01172, fast: 0.0469, ultrafast: 0.1876 };   // kW/s²
  const KRC = 0.48 * 1440 * 840;                                          // 석고보드 kρc [W²·s/m⁴·K²]
  const ROLE = [["living", "거실"], ["kitchen", "주방·식당"], ["master", "안방"], ["br1", "침실"]];
  const st = { W: 4.4, D: 5.0, H: 2.4, door: true, doorW: 0.9, doorH: 2.0, win: false, winW: 1.8, winH: 1.2, growth: "fast", q: 2000, role: 0 };
  let root = null, last = null;

  function compute() {
    const Ao = (st.door ? st.doorW * st.doorH : 0) + (st.win ? st.winW * st.winH : 0);
    const AoH0 = (st.door ? st.doorW * st.doorH * Math.sqrt(st.doorH) : 0) + (st.win ? st.winW * st.winH * Math.sqrt(st.winH) : 0);
    const sealed = AoH0 < 1e-6;
    const AoH = sealed ? 0.03 * Math.sqrt(0.3) : AoH0;                   // 밀폐: 문틈 누기 0.03 m² 가정
    const AT = 2 * st.W * st.D + 2 * st.H * (st.W + st.D) - Ao;
    const Qfo = 7.8 * AT + 378 * AoH;
    const alpha = ALPHA[st.growth];
    const Q = t => Math.min(alpha * t * t, st.q);
    const tfoThomas = Qfo <= st.q ? Math.sqrt(Qfo / alpha) : null;
    const Afloor = st.W * st.D;
    const T = [], Z = [], QQ = [];
    let z = st.H, tDet = null, tUnt = null, tLayer = null, tFo600 = null;
    for (let t = 0; t <= 900; t++) {
      const q = Q(t);
      const hk = Math.sqrt(KRC / Math.max(t, 1)) / 1000;                   // kW/m²K
      const dT = q > 0 ? 6.85 * Math.cbrt(q * q / (AoH * hk * AT)) : 0;
      const Tup = Math.min(20 + dT, 1200);
      const qc = 0.7 * q, zp = Math.max(0.1, z - 0.4);
      const mp = qc > 0 ? 0.071 * Math.cbrt(qc) * Math.pow(zp, 5 / 3) + 0.0018 * qc : 0;   // kg/s
      const rho = 353 / (Tup + 273);
      if (z > 0.5) z = Math.max(0.5, z - mp / (rho * Afloor));
      T.push(Tup); Z.push(z); QQ.push(q);
      if (tDet == null && Tup >= 70) tDet = t;
      if (tLayer == null && z <= 1.8) tLayer = t;
      if (tUnt == null && z <= 1.8 && Tup >= 60) tUnt = t;
      if (tFo600 == null && Tup >= 600) tFo600 = t;
    }
    const cands = [tfoThomas, tFo600].filter(v => v != null);
    const tfo = cands.length ? Math.min(...cands) : null;
    // AI 반응(참고): 이론 상층 온도를 그 역할 슬롯의 천장 센서 값으로 넣음
    const ai = { ten60: null, now: null, fo60: null, room30: null, roomP30: 0, tenAt: [] };
    if (window.model && window.PLANS) {
      const slots = PLANS.lh.slots, idx = ROLE[st.role][0] === "br1" ? 3 : st.role;
      const tcBySlot = slots.map((r, j) => j === idx ? T : (r ? T.map(() => 20) : null));
      for (let k = 10; k <= 900; k += 5) {
        const pr = model.predictAt(tcBySlot, k);
        ai.tenAt.push([k, pr.ten[idx]]);
        if (ai.ten60 == null && pr.ten[idx] < 60) ai.ten60 = k;
        if (ai.now == null && pr.ten[idx] < 5) ai.now = k;
        if (ai.fo60 == null && pr.fo < 60) ai.fo60 = k;
        if (k === 30) { const j = pr.room.indexOf(Math.max(...pr.room)); ai.room30 = slots[j]; ai.roomP30 = pr.room[j]; }
      }
    }
    return { Ao, AoH, AT, Qfo, tfoThomas, tFo600, tfo, tDet, tUnt, tLayer, T, Z, QQ, sealed, ai };
  }

  const fmtT = s => s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const css = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);

  function drawChart(r) {
    const cv = root.querySelector("#cu-chart"); if (!cv) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const L = 46, R = 46, Tm = 12, B = 24, tmax = 900;
    const X = t => L + t / tmax * (w - L - R);
    const ymaxT = Math.max(700, Math.ceil(Math.max(...r.T) / 100) * 100);
    const YT = v => Tm + (1 - v / ymaxT) * (h - Tm - B);
    const YZ = v => Tm + (1 - v / st.H) * (h - Tm - B);
    g.font = "11px Pretendard, Malgun Gothic"; g.strokeStyle = css("--line", "#ccc"); g.fillStyle = css("--muted", "#777");
    g.textAlign = "right";
    for (let v = 0; v <= ymaxT; v += ymaxT / 4) { g.beginPath(); g.moveTo(L, YT(v)); g.lineTo(w - R, YT(v)); g.stroke(); g.fillText(v + "°", L - 4, YT(v) + 4); }
    g.textAlign = "left";
    for (let v = 0; v <= st.H; v += 0.6) g.fillText(v.toFixed(1) + " m", w - R + 4, YZ(v) + 4);
    g.textAlign = "center";
    for (let t = 0; t <= tmax; t += 120) g.fillText(fmtT(t), X(t), h - 6);
    const line = (arr, Y, color, dash) => { g.strokeStyle = color; g.lineWidth = 2; g.setLineDash(dash || []); g.beginPath(); arr.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke(); g.setLineDash([]); };
    line(r.T, YT, css("--ember", "#e8552a"));
    line(r.Z, YZ, css("--sky", "#2b6fd6"), [6, 4]);
    const mark = (t, label, color) => { if (t == null) return; g.strokeStyle = color; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(t), Tm); g.lineTo(X(t), h - B); g.stroke(); g.setLineDash([]); g.fillStyle = color; g.textAlign = "left"; g.fillText(label, X(t) + 3, Tm + 10); };
    mark(r.tUnt, "피난 불가(이론)", css("--danger", "#d93636"));
    mark(r.tfo, "플래시오버(이론)", css("--amber", "#c77d00"));
    g.fillStyle = css("--ink", "#222"); g.textAlign = "left";
    g.fillText("— 상층 온도 (°C)   - - 연기층 높이 (m)", L + 6, h - B - 6);
  }

  function render() {
    const r = last = compute();
    const stat = (k, v, sub, cls = "") => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div>${sub ? `<div class="k">${sub}</div>` : ""}</div>`;
    const ai = r.ai;
    const aiRoomOk = ai.room30 === ROLE[st.role][0];
    root.innerHTML = `
      <div class="banner">사용자 지정은 <b>FDS 정답이 없습니다.</b> 대신 소방공학에서 쓰는 상관식(SFPE 핸드북)으로 <b>이론값을 보수적(빠른 쪽)으로</b> 계산하고, 그 이론 온도를 센서 입력처럼 AI에 넣었을 때의 반응을 참고로 보여 줍니다. 새 평면을 정식으로 넣으려면 방 배치를 입력해 FDS 시뮬레이션을 돌려야 합니다(PC 한 대, 1건 약 1시간).</div>
      <div class="custom-grid">
        <div class="card">
          <h2>불난 방 조건</h2>
          ${rangeRow("방 가로 (m)", "W", 2.5, 8, 0.1)}
          ${rangeRow("방 세로 (m)", "D", 2.5, 8, 0.1)}
          <div class="field"><label>방 역할 (AI 입력 자리)</label><div class="seg" id="cu-role"></div></div>
          <div class="field"><label>문 (폭 ${st.doorW} m × 높이 ${st.doorH} m)</label><div class="seg" id="cu-door"></div></div>
          <div class="field"><label>창 (높이 ${st.winH} m)</label><div class="seg" id="cu-win"></div></div>
          ${st.win ? rangeRow("창 폭 (m)", "winW", 0.6, 4, 0.1) : ""}
          <div class="field"><label>불이 커지는 속도</label><div class="seg" id="cu-growth"></div></div>
          <div class="field"><label>최대 열방출률</label><div class="seg" id="cu-q"></div></div>
          <div class="note">층고 2.4 m, 벽 석고보드, 가구 없음, t² 성장. 조리 화재의 초기 정체 구간은 넣지 않음(보수적).</div>
        </div>
        <div>
          <div class="card">
            <h2>이론값 (정답 아님 · 보수적 추정)</h2>
            <div class="theory-cards">
              ${stat("플래시오버 필요 열방출률", `${Math.round(r.Qfo).toLocaleString()} kW`, "Thomas 상관식")}
              ${stat("플래시오버 시각 (이론)", r.tfo == null ? "안 일어남" : fmtT(r.tfo), r.tfo == null ? `최대 ${st.q / 1000} MW로는 부족` : (r.tfoThomas != null && r.tfoThomas <= (r.tFo600 ?? 1e9) ? "Thomas 열방출률 도달" : "MQH 상층 600°C"), r.tfo == null ? "ok" : "red")}
              ${stat("불난 방 피난 불가 (이론)", fmtT(r.tUnt), "연기층 1.8 m↓ & 60°C↑", "red")}
              ${stat("열감지기 작동 (이론)", fmtT(r.tDet), "상층 70°C 도달")}
            </div>
            <canvas class="chart" id="cu-chart" style="height:240px"></canvas>
            <div class="formula">A_T = ${r.AT.toFixed(1)} m² · A_o√H_o = ${r.AoH.toFixed(2)} m^2.5${r.sealed ? " (밀폐 → 누기 0.03 m² 가정)" : ""} · α = ${ALPHA[st.growth]} kW/s² · Q_max = ${st.q} kW<br>Q_fo = 7.8·A_T + 378·A_o√H_o · ΔT = 6.85·(Q²/(A_o√H_o·h_k·A_T))^(1/3), h_k = √(kρc/t)</div>
          </div>
          <div class="card">
            <h2>이 이론 온도를 넣었을 때 AI 반응 (참고)</h2>
            <table>
              <tr><th></th><th class="num">AI</th><th class="num">이론값</th><th>비고</th></tr>
              <tr><td>불난 방 추정 (30초)</td><td class="num">${ai.room30 ? (PLANS.lh.room_ko[ai.room30] || ai.room30) + ` ${(ai.roomP30 * 100).toFixed(0)}%` : "—"}</td><td class="num">${ROLE[st.role][1]}</td><td>${ai.room30 ? (aiRoomOk ? "✓ 일치" : "✗ 불일치") : ""}</td></tr>
              <tr><td>"60초 안 피난 불가" 경고</td><td class="num">${fmtT(ai.ten60)}</td><td class="num">${r.tUnt == null ? "—" : fmtT(Math.max(0, r.tUnt - 60))}</td><td>${ai.ten60 != null && r.tUnt != null ? `차이 ${Math.round(ai.ten60 - (r.tUnt - 60))}초` : ""}</td></tr>
              <tr><td>피난 불가 판단</td><td class="num">${fmtT(ai.now)}</td><td class="num">${fmtT(r.tUnt)}</td><td>${ai.now != null && r.tUnt != null ? `차이 ${Math.round(ai.now - r.tUnt)}초` : ""}</td></tr>
              <tr><td>플래시오버 "60초 안" 경고</td><td class="num">${fmtT(ai.fo60)}</td><td class="num">${r.tfo == null ? "—" : fmtT(Math.max(0, r.tfo - 60))}</td><td>${r.tfo == null ? "이론상 안 일어남" : ai.fo60 == null ? "AI 경고 없음" : `차이 ${Math.round(ai.fo60 - (r.tfo - 60))}초`}</td></tr>
            </table>
            <div class="note" style="margin-top:8px">AI는 FDS(전산유체역학)로 만든 온도 패턴으로 학습했고, 여기 입력은 구역 모델 상관식의 매끈한 곡선이라 실제 센서와 다릅니다. 두 값의 차이는 'AI가 틀렸다'가 아니라 '입력이 다르다'로 읽어야 합니다. 정식 평가는 ①·② 탭의 FDS 사례에서.</div>
          </div>
        </div>
      </div>`;
    const segs = (id, items, value, on) => seg(root.querySelector(id), items, value, v => { on(v); render(); });
    segs("#cu-role", ROLE.map((r, i) => ({ value: i, label: r[1] })), st.role, v => st.role = +v);
    segs("#cu-door", [{ value: 1, label: "열림" }, { value: 0, label: "닫힘" }], st.door ? 1 : 0, v => st.door = !!+v);
    segs("#cu-win", [{ value: 0, label: "닫힘" }, { value: 1, label: "열림" }], st.win ? 1 : 0, v => st.win = !!+v);
    segs("#cu-growth", ["medium", "fast", "ultrafast"].map(g => ({ value: g, label: GROWTH_KO[g] })), st.growth, v => st.growth = v);
    segs("#cu-q", [2000, 4000].map(q => ({ value: q, label: `${q / 1000} MW` })), st.q, v => st.q = +v);
    root.querySelectorAll("[data-key]").forEach(inp => {
      inp.oninput = () => { const v = parseFloat(inp.value); if (!isNaN(v)) { st[inp.dataset.key] = v; const other = root.querySelector(`[data-key="${inp.dataset.key}"]:not([type="${inp.type}"])`); if (other) other.value = v; } };
      inp.onchange = () => render();
    });
    drawChart(r);
  }
  function rangeRow(label, key, min, max, step) {
    return `<div class="field"><label>${label}</label><div class="num-row"><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${st[key]}"><input type="number" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${st[key]}"></div></div>`;
  }
  function show(container) { root = container; render(); }
  function redraw() { if (root && last) drawChart(last); }
  return { show, redraw, compute, state: st };
})();
