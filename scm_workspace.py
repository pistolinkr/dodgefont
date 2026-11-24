"""V1: 방향 SCM 작업공간. 개념마다 로지스틱 조건부확률 P(X_j=1 | 부모)를 두고
결합분포 = Π_j P(x_j | pa_j). do(X)는 X의 CPD를 상수로 교체 → 비후손에 영향 없음.

QWorkspace의 API(marginals/do/mutual_info/explain/commit)를 그대로 상속하고 probs만 바꾼다.
결합 강도 스케일은 gibbs와 맞춤: 로짓 이동 = 4·tau·strength, 규칙 = 2·tau·weight.
"""
from dataclasses import dataclass
from graphlib import TopologicalSorter
import numpy as np
from q_workspace import QWorkspace, demo_workspace


@dataclass(frozen=True)
class SCMWorkspace(QWorkspace):

    def __post_init__(self):
        g = {n: set() for n in self.names}
        for c in self.couplings:
            g[c.effect].add(c.cause)
        tuple(TopologicalSorter(g).static_order())     # 순환이면 CycleError

    def probs(self, given=None, couplings=None, rules=None):
        cs, rs = self._active()
        cs = cs if couplings is None else couplings
        rs = rs if rules is None else rules
        b = self._bits()
        pr = np.clip(np.asarray(self.priors, float), 1e-9, 1 - 1e-9)
        logit = np.tile(np.log(pr / (1 - pr)), (len(b), 1))
        for c in cs:
            logit[:, self.ix(c.effect)] += 4 * self.tau * c.strength * b[:, self.ix(c.cause)]
        # ponytail: 규칙은 then_ 의 CPD에 컴파일(방향 유지). 다중 전제 규칙은 CPD 상호작용항으로 확장
        for r in rs:
            logit[:, self.ix(r.then_)] += 2 * self.tau * r.weight * b[:, self.ix(r.if_)]
        p1 = 1 / (1 + np.exp(-logit))
        for k, v in self.clamped:                         # do(): CPD를 상수로
            p1[:, self.ix(k)] = v
        p = np.prod(np.where(b == 1, p1, 1 - p1), axis=1)
        if given:
            for k, v in given.items():
                p = p * (b[:, self.ix(k)] == v)
            p = p / p.sum()
        return p

    def descendants(self, x):
        out, stack = set(), [x]
        while stack:
            u = stack.pop()
            for c in self.couplings:
                if c.cause == u and c.effect not in out:
                    out.add(c.effect)
                    stack.append(c.effect)
        return out


def demo_scm(tau=0.5):
    g = demo_workspace("gibbs", tau=tau)
    return SCMWorkspace(g.names, g.priors, couplings=g.couplings, rules=g.rules, tau=tau)


if __name__ == "__main__":
    s, g = demo_scm(), demo_workspace("gibbs", tau=0.5)

    # 1. 유효한 결합분포: 재정규화 없이 합 = 1
    assert abs(s.probs().sum() - 1) < 1e-12

    # 2. V1 통과 기준: 충돌자 누수 없음
    c0 = s.do(slippery=0).marginals()["car_brakes"]
    c1 = s.do(slippery=1).marginals()["car_brakes"]
    assert abs(c0 - c1) < 1e-12, (c0, c1)

    # 3. 일반화: 모든 개념 X, 값 v에 대해 do(X=v)는 X의 비후손 주변확률을 바꾸지 않음
    base = s.marginals()
    worst = 0.0
    for x in s.names:
        for v in (0, 1):
            m = s.do(**{x: v}).marginals()
            for n in set(s.names) - s.descendants(x) - {x}:
                worst = max(worst, abs(m[n] - base[n]))
    assert worst < 1e-12, worst

    # 4. 원인에 개입하면 결과가 올바른 방향으로 변함 (결합 10개 전부)
    for c in s.couplings:
        d = s.do(**{c.cause: 1}).marginals()[c.effect] - s.do(**{c.cause: 0}).marginals()[c.effect]
        assert np.sign(d) == np.sign(c.strength), (c, d)

    # 5. 관측 ≠ 개입: 결과 관측은 원인을 갱신, 결과 개입은 안 함
    assert s.marginals({"wet_road": 1})["rain"] > base["rain"]
    assert abs(s.do(wet_road=1).marginals()["rain"] - base["rain"]) < 1e-12

    # 6. 순환 그래프 거부
    from q_workspace import Coupling
    try:
        SCMWorkspace(("a", "b"), (.5, .5), couplings=(Coupling("a", "b", 1, "x"), Coupling("b", "a", 1, "y")))
        raise AssertionError("순환이 통과됨")
    except Exception as e:
        assert type(e).__name__ == "CycleError"

    # 비교 출력: gibbs(무방향) vs SCM(방향)
    gb = g.marginals()
    gw = 0.0
    for x in g.names:
        for v in (0, 1):
            m = g.do(**{x: v}).marginals()
            for n in set(g.names) - s.descendants(x) - {x}:
                gw = max(gw, abs(m[n] - gb[n]))
    g0, g1 = g.do(slippery=0).marginals()["car_brakes"], g.do(slippery=1).marginals()["car_brakes"]
    print(f"{'':8s} {'P(car_brakes|do(slip=0))':>25s} {'do(slip=1)':>11s} {'비후손 최대 누수':>14s}")
    print(f"{'gibbs':8s} {g0:25.3f} {g1:11.3f} {gw:14.3f}")
    print(f"{'SCM':8s} {c0:25.3f} {c1:11.3f} {worst:14.1e}")
    print(f"\nP(rain)={base['rain']:.3f}  관측 P(rain|wet=1)={s.marginals({'wet_road': 1})['rain']:.3f}"
          f"  개입 P(rain|do(wet=1))={s.do(wet_road=1).marginals()['rain']:.3f}")
    print("SCM 주변확률:", {k: round(float(v), 3) for k, v in base.items()})
    print("커밋:", s.commit())
    print("\nV1 검증 통과")

    # ---------------- V5: 중복 경로 귀인 ----------------
    T = "slow_down"
    cs, rs = s._active()
    single = {c.provenance: base[T] - s.marginals(couplings=[x for x in cs if x is not c])[T] for c in cs}
    single.update({r.provenance: base[T] - s.marginals(rules=[x for x in rs if x is not r])[T] for r in rs})
    ex = s.explain(T)
    phi = {p: d for p, _, d in ex}
    none = s.marginals(couplings=[], rules=[])[T]
    group = base[T] - s.marginals(couplings=[c for c in cs if c.provenance != "clt:edge#1182"], rules=[])[T]

    print(f"\n{T} 귀인: 단일 절제 vs Shapley  (P 전체={base[T]:.3f}, 출처 없음={none:.3f})")
    for p, path, d in ex:
        print(f"   {p:16s} {path:28s} 단일 {single[p]:+.3f}   Shapley {d:+.3f}")
    print(f"그룹 절제 {{edge#1182, R12}} = {group:+.3f}  vs 단일 합 = {single['clt:edge#1182'] + single['rule:R12']:+.3f}")

    # 1. 효율성: Shapley 합 = 전체 − 출처 없음
    assert abs(sum(phi.values()) - (base[T] - none)) < 1e-12
    # 2. 널 플레이어: slow_down의 조상 경로에 없는 출처는 정확히 0
    for p in ("clt:edge#1301", "clt:edge#1302", "mem:ep#88"):
        assert abs(phi[p]) < 1e-12, (p, phi[p])
    # 3. 중복 경로: 단일 절제는 둘을 과소평가, 그룹 절제 > 단일 합
    assert group > single["clt:edge#1182"] + single["rule:R12"]
    assert phi["clt:edge#1182"] > single["clt:edge#1182"] and phi["rule:R12"] > single["rule:R12"]
    # 4. 직접 엣지가 상위 4위 안에 복귀
    assert "clt:edge#1182" in [p for p, _, _ in ex[:4]]
    print("\nV5 검증 통과")
