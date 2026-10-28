// 학습된 GRU를 브라우저에서 그대로 계산한다 (PyTorch nn.GRU와 같은 식).
//   r = σ(W_ir x + b_ir + W_hr h + b_hr)
//   z = σ(W_iz x + b_iz + W_hz h + b_hz)
//   n = tanh(W_in x + b_in + r ∘ (W_hn h + b_hn))
//   h' = (1 − z) ∘ n + z ∘ h          (게이트 순서 r, z, n)
// 입력: 최근 60초 × 방 7칸의 정규화 온도 (T − 20) / 100.  출력: 방별 피난 불가까지 남은 초, 플래시오버까지 남은 초, 화원 방 확률.

class GRUModel {
  constructor(spec) {
    this.win = spec.win;
    this.slots = spec.slots;
    this.horizon = spec.horizon;
    this.hidden = spec.hidden;
    this.layers = spec.layers;
    this.w = spec.weights;
  }

  static sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  // y = W x + b  (W: [rows][cols])
  static matvec(W, x, b) {
    const out = new Float64Array(W.length);
    for (let i = 0; i < W.length; i++) {
      let s = b ? b[i] : 0;
      const row = W[i];
      for (let j = 0; j < row.length; j++) s += row[j] * x[j];
      out[i] = s;
    }
    return out;
  }

  gruStep(layer, x, h) {
    const H = this.hidden;
    const gi = GRUModel.matvec(this.w[`gru.weight_ih_l${layer}`], x, this.w[`gru.bias_ih_l${layer}`]);
    const gh = GRUModel.matvec(this.w[`gru.weight_hh_l${layer}`], h, this.w[`gru.bias_hh_l${layer}`]);
    const hn = new Float64Array(H);
    for (let k = 0; k < H; k++) {
      const r = GRUModel.sigmoid(gi[k] + gh[k]);
      const z = GRUModel.sigmoid(gi[H + k] + gh[H + k]);
      const n = Math.tanh(gi[2 * H + k] + r * gh[2 * H + k]);
      hn[k] = (1 - z) * n + z * h[k];
    }
    return hn;
  }

  // seq: [win][slots] 정규화 입력
  forward(seq) {
    let hs = [];
    for (let l = 0; l < this.layers; l++) hs.push(new Float64Array(this.hidden));
    for (let t = 0; t < seq.length; t++) {
      let x = seq[t];
      for (let l = 0; l < this.layers; l++) {
        hs[l] = this.gruStep(l, x, hs[l]);
        x = hs[l];
      }
    }
    const z = hs[this.layers - 1];
    const ten = Array.from(GRUModel.matvec(this.w["head_ten.weight"], z, this.w["head_ten.bias"]), v => GRUModel.sigmoid(v) * this.horizon);
    const fo = GRUModel.sigmoid(GRUModel.matvec(this.w["head_fo.weight"], z, this.w["head_fo.bias"])[0]) * this.horizon;
    const logits = GRUModel.matvec(this.w["head_room.weight"], z, this.w["head_room.bias"]);
    const m = Math.max(...logits);
    const ex = Array.from(logits, v => Math.exp(v - m));
    const s = ex.reduce((a, b) => a + b, 0);
    return { ten, fo, room: ex.map(v => v / s) };
  }

  // tcBySlot: 슬롯별 온도 배열(°C, 1초 간격, 없는 방은 null). now: 현재 시각(초). 화재 전 구간은 평상시(0)로 채움
  predictAt(tcBySlot, now) {
    const seq = [];
    for (let k = now - this.win; k < now; k++) {
      const row = new Float64Array(this.slots);
      if (k >= 0) {
        for (let j = 0; j < this.slots; j++) {
          const arr = tcBySlot[j];
          if (arr && k < arr.length) row[j] = (arr[k] - 20) / 100;
        }
      }
      seq.push(row);
    }
    return this.forward(seq);
  }
}
