"""Q-워크스페이스 최소 프로토타입: 개념 1개 = 큐비트 1개, numpy 상태벡터 시뮬레이션.

mode="gibbs"   : 허수시간 진화 = 고전 팩터 그래프 사후분포 (비교 기준선, 간섭 없음)
mode="quantum" : 실시간 QAOA형 숙고 (위상 + X 혼합 → 간섭)
"""
from dataclasses import dataclass, replace
import math
import numpy as np


@dataclass(frozen=True)
class Coupling:      # cause → effect, Ising ZZ 결합
    cause: str
    effect: str
    strength: float
    provenance: str


@dataclass(frozen=True)
class Rule:          # if_ → then_ : (if_=1, then_=0) 구성에 벌점
    if_: str
    then_: str
    weight: float
    provenance: str


@dataclass(frozen=True)
class QWorkspace:
    names: tuple
    priors: tuple                 # 개념 존재 확률 p_j (CCW-Net ‖m_j‖)
    phases: tuple = None          # 목표 정렬 위상 φ_j
    fields: tuple = None          # 증거장 h_j (L1 예측오차)
    couplings: tuple = ()
    rules: tuple = ()
    clamped: tuple = ()           # do() 개입: ((name, v), ...)
    mode: str = "gibbs"
    layers: int = 4
    dt: float = 0.6
    tau: float = 1.0
    gammas: tuple = None          # 학습된 층별 γ_l (없으면 선형 램프)
    betas: tuple = None           # 학습된 층별 β_l

    # ---------- 내부 ----------
    @property
    def n(self):
        return len(self.names)

    def ix(self, name):
        return self.names.index(name)

    def _bits(self):
        # ponytail: (2^n, n) 비트 테이블, n≈20 넘으면 메모리 폭발 → 30큐비트는 비트연산/MPS로 교체
        return (np.arange(2 ** self.n)[:, None] >> np.arange(self.n)) & 1

    def _apply1(self, psi, j, U):
        psi = psi.reshape(2 ** (self.n - 1 - j), 2, 2 ** j)
        return np.einsum("ab,ibk->iak", U, psi).reshape(-1)

    def _active(self):
        cl = {k for k, _ in self.clamped}
        # do(X): X로 들어오는 결합 제거
        cs = [c for c in self.couplings if c.effect not in cl]
        rs = [r for r in self.rules if r.then_ not in cl]
        return cs, rs

    def _energy(self, couplings=None, rules=None):
        b = self._bits()
        s = 2 * b - 1                      # 존재 = +1
        h = np.zeros(self.n) if self.fields is None else np.asarray(self.fields)
        E = -s @ h
        for c in couplings:
            # 원인이 있을 때만 결과를 민다 (순수 ZZ는 '둘 다 없음'도 보상해 전부 0으로 쏠림)
            E = E - c.strength * b[:, self.ix(c.cause)] * s[:, self.ix(c.effect)]
        for r in rules:
            E = E + r.weight * b[:, self.ix(r.if_)] * (1 - b[:, self.ix(r.then_)])
        return E

    def _prepare(self):
        psi = np.zeros(2 ** self.n, complex)
        psi[0] = 1
        cl = dict(self.clamped)
        ph = np.zeros(self.n) if self.phases is None else self.phases
        for j, name in enumerate(self.names):
            p = cl.get(name, self.priors[j])
            t = 2 * np.arcsin(np.sqrt(p))
            psi = self._apply1(psi, j, np.array([[np.cos(t / 2), -np.sin(t / 2)],
                                                 [np.sin(t / 2), np.cos(t / 2)]]))
            psi = self._apply1(psi, j, np.diag([np.exp(-0.5j * ph[j]), np.exp(0.5j * ph[j])]))
        return psi

    # ---------- 공개 API ----------
    def run(self, couplings=None, rules=None):
        cs, rs = self._active()
        cs = cs if couplings is None else couplings
        rs = rs if rules is None else rules
        psi, E = self._prepare(), self._energy(cs, rs)
        if self.mode == "gibbs":
            psi = psi * np.exp(-self.tau * E)
        else:
            cl = {k for k, _ in self.clamped}
            L = self.layers if self.gammas is None else len(self.gammas)
            for l in range(1, L + 1):
                if self.gammas is None:
                    g = self.dt * (l - 0.5) / L
                    be = self.dt * (1 - (l - 0.5) / L)
                else:
                    g, be = self.gammas[l - 1], self.betas[l - 1]
                psi = np.exp(-1j * g * E) * psi
                RX = np.array([[np.cos(be), -1j * np.sin(be)], [-1j * np.sin(be), np.cos(be)]])
                for j, name in enumerate(self.names):
                    if name not in cl:           # 개입된 슬롯은 고정
                        psi = self._apply1(psi, j, RX)
        return psi / np.linalg.norm(psi)

    def probs(self, given=None, **kw):
        """given={name: v} → 관측 조건화 (사영 + 재정규화)."""
        p = np.abs(self.run(**kw)) ** 2
        if given:
            b = self._bits()
            for k, v in given.items():
                p = p * (b[:, self.ix(k)] == v)
            p = p / p.sum()
        return p

    def marginals(self, given=None, **kw):
        return dict(zip(self.names, self.probs(given, **kw) @ self._bits()))

    def do(self, **vals):
        """인과 개입: 슬롯 고정 + 유입 결합 제거. 새 워크스페이스 반환."""
        return replace(self, clamped=tuple(dict(self.clamped, **vals).items()))

    def mutual_info(self, a, b):
        p, bits = self.probs(), self._bits()
        i, j = self.ix(a), self.ix(b)
        J = np.array([[p[(bits[:, i] == x) & (bits[:, j] == y)].sum() for y in (0, 1)] for x in (0, 1)])
        pi, pj = J.sum(1), J.sum(0)
        nz = J > 0
        return float((J[nz] * np.log2(J[nz] / np.outer(pi, pj)[nz])).sum())

    def explain(self, target):
        """출처별 Shapley 기여. 합 = P(target | 출처 전부) − P(target | 출처 없음).
        단일 절제와 달리 중복 경로(엣지+규칙이 같은 길을 덮음)에도 기여를 공정하게 나눔."""
        cs, rs = self._active()
        src = [("c", c) for c in cs] + [("r", r) for r in rs]
        m = len(src)
        # ponytail: 정확 Shapley = 2^m 평가. 출처 ~15개 넘으면 순열 샘플링으로 교체
        v = np.empty(2 ** m)
        for mask in range(2 ** m):
            on = [s for i, (_, s) in enumerate(src) if mask >> i & 1]
            v[mask] = self.marginals(couplings=[s for s in on if isinstance(s, Coupling)],
                                     rules=[s for s in on if isinstance(s, Rule)])[target]
        masks = np.arange(2 ** m)
        size = np.array([bin(x).count("1") for x in masks])
        w = np.array([math.factorial(k) * math.factorial(m - k - 1) / math.factorial(m) for k in range(m)])
        out = []
        for i, (kind, s) in enumerate(src):
            S = masks[(masks >> i & 1) == 0]
            phi = float(np.sum(w[size[S]] * (v[S | 1 << i] - v[S])))
            path = f"{s.cause}→{s.effect}" if kind == "c" else f"rule {s.if_}⇒{s.then_}"
            out.append((s.provenance, path, phi))
        return sorted(out, key=lambda t: -abs(t[2]))

    def commit(self, residual=(0.0, 0.0, 0.0), tau_veto=0.2):
        """SOAR 커밋 = 최빈 결합 구성 측정. 잔여(ε_CLT, ε_open, ε_mon)는 거부권만."""
        if max(residual) > tau_veto:
            return {"status": "VETO", "reason": f"잔여 질량 {max(residual):.2f} > {tau_veto}"}
        p = self.probs()
        k = int(p.argmax())
        return {"status": "COMMIT", "p": float(p[k]),
                "active": [n for j, n in enumerate(self.names) if k >> j & 1]}


# ---------------- 데모 + 자체 검증 ----------------
def demo_workspace(mode="gibbs", **kw):
    names = ("rain", "wet_road", "slippery", "night", "low_vis",
             "car_brakes", "pedestrian", "slow_down", "change_lane", "honk")
    priors = (.7, .5, .3, .2, .3, .4, .1, .5, .3, .1)
    C = Coupling
    couplings = (
        C("rain", "wet_road", 1.0, "clt:edge#101"),
        C("wet_road", "slippery", .8, "clt:edge#205"),
        C("night", "low_vis", .7, "clt:edge#311"),
        C("slippery", "slow_down", .9, "clt:edge#1182"),
        C("low_vis", "slow_down", .6, "clt:edge#1190"),
        C("car_brakes", "slow_down", 1.0, "clt:edge#1204"),
        C("pedestrian", "slow_down", .8, "clt:edge#1222"),
        C("car_brakes", "change_lane", .3, "clt:edge#1301"),
        C("slippery", "change_lane", -.6, "clt:edge#1302"),
        C("pedestrian", "honk", -.5, "mem:ep#88"),
    )
    rules = (Rule("slippery", "slow_down", 2.0, "rule:R12"),)
    return QWorkspace(names, priors, couplings=couplings, rules=rules, mode=mode, **kw)


if __name__ == "__main__":
    for mode in ("gibbs", "quantum"):
        ws = demo_workspace(mode)
        m = ws.marginals()

        # 1. 정규화
        assert abs(ws.probs().sum() - 1) < 1e-9
        # 2. 결합·규칙 없으면 곱 상태 → 상호정보 0
        bare = replace(ws, couplings=(), rules=())
        assert bare.mutual_info("rain", "wet_road") < 1e-9
        # 3. 결과에 개입해도 원인은 안 변함: do(wet_road=0) == do(wet_road=1) 에서 P(rain)
        r0 = ws.do(wet_road=0).marginals()["rain"]
        r1 = ws.do(wet_road=1).marginals()["rain"]
        assert abs(r0 - r1) < 1e-9, (mode, r0, r1)
        # 4. 원인에 개입하면 결과가 변함 (quantum은 방향 보장 없음 → 크기만)
        w0 = ws.do(rain=0).marginals()["wet_road"]
        w1 = ws.do(rain=1).marginals()["wet_road"]
        assert (w1 - w0 if mode == "gibbs" else abs(w1 - w0)) > 0.05, (mode, w0, w1)
        # 5. 잔여 거부권
        assert ws.commit(residual=(0.3, 0, 0))["status"] == "VETO"

        print(f"\n===== mode={mode} =====")
        print("주변확률:", {k: round(v, 3) for k, v in m.items()})
        print(f"P(rain)={m['rain']:.3f} | 관측 P(rain|wet_road=1)={ws.marginals({'wet_road': 1})['rain']:.3f}"
              f" | 개입 P(rain|do(wet_road=1))={r1:.3f}")
        print(f"P(wet_road|do(rain=0))={w0:.3f}  P(wet_road|do(rain=1))={w1:.3f}")
        print(f"MI(rain;wet_road)={ws.mutual_info('rain', 'wet_road'):.3f} bit")
        print("slow_down 설명 (출처, 경로, 절제시 Δ):")
        for prov, path, d in ws.explain("slow_down")[:4]:
            print(f"   {prov:16s} {path:28s} {d:+.3f}")
        print("커밋:", ws.commit())
        # 알려진 한계: Ising 결합은 무방향 → 충돌자(slow_down) 경유로 개입이 역류
        c0 = ws.do(slippery=0).marginals()["car_brakes"]
        c1 = ws.do(slippery=1).marginals()["car_brakes"]
        print(f"[한계] P(car_brakes|do(slippery=0))={c0:.3f} vs do(=1)={c1:.3f}  (인과적으로는 같아야 함)")

    # gibbs 고유 검증: 관측 조건화는 원인 확률을 올리고, 규칙은 위반 구성을 억제
    g = demo_workspace("gibbs")
    assert g.marginals({"wet_road": 1})["rain"] > g.marginals()["rain"]
    b = g._bits()
    viol = lambda w: w.probs()[(b[:, w.ix("slippery")] == 1) & (b[:, w.ix("slow_down")] == 0)].sum()
    assert viol(g) < viol(replace(g, rules=()))
    print("\n모든 검증 통과")
