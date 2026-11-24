"""Q-User: 질문 k개에 대한 사람 응답을 d차원 실수 사영 모델로 예측 (V4: d=2 vs d=3).

질문 i = 단위벡터 q_i ("yes" 사영 = q_i q_iᵀ), 사용자 상태 = 단위벡터 ψ.
순서 (X→Y) 응답 확률: P(x, y) = ‖P_y^Y P_x^X ψ‖².
유효 파라미터 수: (d−1) + k(d−1) − d(d−1)/2   (회전 자유도 제거)
"""
import itertools
import numpy as np
from scipy.optimize import minimize

OUT = [(1, 1), (1, 0), (0, 1), (0, 0)]


def _proj(q, a, flip=False):
    """flip=False: yes = 1차원(q 방향), flip=True: yes = q의 직교여공간(d−1차원)."""
    P = np.outer(q, q)
    return P if (a == 1) != flip else np.eye(len(q)) - P


def seq_probs(psi, qs, i, j, flips=None):
    """질문 i 다음 j 순서의 4칸 확률."""
    f = flips or (False,) * len(qs)
    return np.array([np.sum((_proj(qs[j], y, f[j]) @ _proj(qs[i], x, f[i]) @ psi) ** 2) for x, y in OUT])


def unpack(theta, d, k):
    v = theta.reshape(k + 1, d)
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    return v[0], v[1:]


def n_params(d, k):
    return (d - 1) + k * (d - 1) - d * (d - 1) // 2


def loglik(theta, d, k, data, flips=None):
    psi, qs = unpack(theta, d, k)
    return sum(float(np.sum(c * np.log(np.clip(seq_probs(psi, qs, i, j, flips), 1e-12, None))))
               for (i, j), c in data.items())


def _best_of(f, dim, restarts, seed):
    rng = np.random.default_rng(seed)
    runs = [minimize(f, rng.normal(size=dim), method="L-BFGS-B") for _ in range(restarts)]
    r = min(runs, key=lambda r: r.fun)
    return -r.fun, r.x


def fit_q(data, d, k, flips=None, restarts=20, seed=0):
    return _best_of(lambda th: -loglik(th, d, k, data, flips), (k + 1) * d, restarts, seed)


def fit_classical(data, k):
    """C-joint: k개 이진변수의 결합분포 하나 (순서 무관). 쌍별 데이터로 로짓 2^k개 MLE."""
    cfg = np.array(list(itertools.product((1, 0), repeat=k)))

    def ll(z):
        p = np.exp(z - z.max()); p /= p.sum()
        tot = 0.0
        for (i, j), c in data.items():
            pij = np.array([p[(cfg[:, i] == x) & (cfg[:, j] == y)].sum() for x, y in OUT])
            tot += float(np.sum(c * np.log(np.clip(pij, 1e-12, None))))
        return tot
    L_joint, _ = _best_of(lambda z: -ll(z), 2 ** k, 5, 0)
    L_free = sum(float(np.sum(c * np.log(np.clip(c / c.sum(), 1e-12, None)))) for c in data.values())
    return L_joint, L_free


def compare(data, k):
    n = sum(c.sum() for c in data.values())
    bic = lambda kp, L: kp * np.log(n) - 2 * L
    Lj, Lf = fit_classical(data, k)
    res = {"C-joint": bic(2 ** k - 1, Lj), "C-free": bic(3 * len(data), Lf)}
    for d in (2, 3):
        res[f"Q{d}"] = bic(n_params(d, k), fit_q(data, d, k)[0])
    return res


def simulate(psi, qs, N, rng):
    k = len(qs)
    return {(i, j): rng.multinomial(N, seq_probs(psi, qs, i, j))
            for i in range(k) for j in range(k) if i != j}


if __name__ == "__main__":
    rng = np.random.default_rng(3)
    unit = lambda *x: np.array(x) / np.linalg.norm(x)
    k, N = 3, 1000
    scenarios = {
        # 질문 벡터 3개가 한 평면 위 → d=2로 충분
        "정답 d=2": (unit(.8, .6, 0), [unit(1, 0, 0), unit(.6, .8, 0), unit(-.3, 1, 0)]),
        # 질문 벡터 3개가 평면을 벗어남 → d=3 필요
        "정답 d=3": (unit(.6, .5, .62), [unit(1, 0, 0), unit(.5, .85, .2), unit(.3, -.2, .93)]),
    }
    winners = {}
    for name, (psi, qs) in scenarios.items():
        data = simulate(psi, qs, N, rng)
        res = compare(data, k)
        winners[name] = min(res, key=res.get)
        print(f"\n[{name}]  (질문 3개 × 순서 6가지 × {N}명)")
        for m_, b in sorted(res.items(), key=lambda kv: kv[1]):
            print(f"   {m_:8s} BIC={b:9.1f}{'  ← 선택' if m_ == winners[name] else ''}")

    # 자체 검증: QQ 등식은 d와 무관하게 모든 질문 쌍에서 성립
    psi, qs = scenarios["정답 d=3"]
    for i, j in itertools.permutations(range(3), 2):
        ab, ba = seq_probs(psi, qs, i, j), seq_probs(psi, qs, j, i)
        assert abs((ab[1] + ab[2]) - (ba[1] + ba[2])) < 1e-12
    assert n_params(2, 3) == 3 and n_params(3, 3) == 5
    assert winners["정답 d=2"] == "Q2"      # 필요 없는 차원은 BIC가 벌한다
    assert winners["정답 d=3"] == "Q3"      # 필요한 차원은 잡아낸다
    print("\nV4 검증 통과")
