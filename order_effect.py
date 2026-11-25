"""순서 효과 실험: 질문 A, B를 'A→B' 순서와 'B→A' 순서로 물었을 때의 응답 분포.

모델 3개를 BIC로 비교 (낮을수록 좋음):
  C-joint  (고전, 3 params) : 하나의 결합분포 p(a,b). 순서 효과 원리적으로 0.
  C-free   (고전, 6 params) : 순서마다 별도 분포. 뭐든 맞추지만 아무것도 예측 못 함.
  Q        (양자, 2 params) : 상태각 φ + 질문 B의 기저각 θ. 비가환 사영 → 순서 효과,
                              대신 QQ 등식(무파라미터 예측)을 반드시 만족해야 함.
"""
import numpy as np

N = 1000                    # 순서별 응답자 수
rng = np.random.default_rng(1)
OUT = [(1, 1), (1, 0), (0, 1), (0, 0)]   # (첫 질문, 둘째 질문) 응답, 1=yes


def proj(angle):
    v = np.array([np.cos(angle), np.sin(angle)])
    P = np.outer(v, v)
    return {1: P, 0: np.eye(2) - P}


def q_probs(phi, theta):
    """반환: (AB 순서 4칸, BA 순서 4칸) 확률. A 기저각 0, B 기저각 θ."""
    psi = np.array([np.cos(phi), np.sin(phi)])
    A, B = proj(0.0), proj(theta)
    ab = [np.sum((B[y] @ A[x] @ psi) ** 2) for x, y in OUT]
    ba = [np.sum((A[y] @ B[x] @ psi) ** 2) for x, y in OUT]
    return np.array(ab), np.array(ba)


def qq(ab, ba):
    """QQ 등식: [P(Ay,Bn)+P(An,By)]_AB − [P(By,An)+P(Bn,Ay)]_BA = 0 (양자 모델은 항상)."""
    return (ab[1] + ab[2]) - (ba[1] + ba[2])


def ll(counts, p):
    return float(np.sum(counts * np.log(np.clip(p, 1e-12, None))))


def fit_all(c_ab, c_ba):
    n = c_ab.sum() + c_ba.sum()
    bic = lambda k, L: k * np.log(n) - 2 * L
    # C-free: 순서별 경험분포
    L_free = ll(c_ab, c_ab / c_ab.sum()) + ll(c_ba, c_ba / c_ba.sum())
    # C-joint: BA 칸을 (a,b)로 재배열해 합산. BA의 OUT[i]=(b,a) → (a,b) 인덱스: [0,2,1,3]
    joint = (c_ab + c_ba[[0, 2, 1, 3]]) / n
    L_joint = ll(c_ab, joint) + ll(c_ba, joint[[0, 2, 1, 3]])
    # Q: 2D 격자 탐색 (ponytail: 격자, 파라미터 늘면 경사법으로)
    g = np.linspace(0, np.pi, 361)
    best = max(((ll(c_ab, a) + ll(c_ba, b), f, t) for f in g for t in g
                for a, b in [q_probs(f, t)]), key=lambda x: x[0])
    return {"C-joint": bic(3, L_joint), "C-free": bic(6, L_free), "Q": bic(2, best[0])}, best[1:]


def sample(ab, ba):
    return rng.multinomial(N, ab / ab.sum()), rng.multinomial(N, ba / ba.sum())


SCENARIOS = {
    # 1. 정답이 양자형: 순서 효과 있음 + QQ 성립
    "양자형 순서효과": q_probs(0.6, 0.9),
    # 2. 순서 효과는 있지만 QQ 위반 (고전적 순서 의존 과정)
    "QQ 위반 순서효과": (np.array([.40, .10, .10, .40]), np.array([.20, .30, .30, .20])),
    # 3. 순서 효과 없음: 하나의 결합분포
    "순서효과 없음": (lambda j: (j, j[[0, 2, 1, 3]]))(np.array([.35, .15, .25, .25])),
}

if __name__ == "__main__":
    winners = {}
    for name, (ab, ba) in SCENARIOS.items():
        c_ab, c_ba = sample(ab, ba)
        bics, (phi, theta) = fit_all(c_ab, c_ba)
        winners[name] = min(bics, key=bics.get)
        pA_first, pA_second = (c_ab[0] + c_ab[1]) / N, (c_ba[0] + c_ba[2]) / N
        print(f"\n[{name}]  P(A=yes) 먼저={pA_first:.3f} / 나중={pA_second:.3f}"
              f"   관측 QQ={qq(c_ab / N, c_ba / N):+.3f}")
        for m, v in sorted(bics.items(), key=lambda kv: kv[1]):
            print(f"   {m:8s} BIC={v:9.1f}{'  ← 선택' if m == winners[name] else ''}")
        print(f"   Q 적합: φ={phi:.2f}, θ={theta:.2f}")

    # 자체 검증
    ab, ba = q_probs(0.6, 0.9)
    assert abs(qq(ab, ba)) < 1e-12 and abs(ab.sum() - 1) < 1e-12   # QQ는 양자 모델의 항등식
    assert winners["양자형 순서효과"] == "Q"
    assert winners["QQ 위반 순서효과"] != "Q"                         # 반증 가능해야 의미 있음
    assert winners["순서효과 없음"] == "C-joint"
    print("\n검증 통과")
