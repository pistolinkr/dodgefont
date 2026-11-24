"""quantum 모드의 층별 γ·β를 gibbs(고전) 분포에 맞춰 학습하고, 학습에 안 쓴 do-개입으로 일반화를 평가."""
from dataclasses import replace
import numpy as np
from q_workspace import demo_workspace

L, TAU, STEPS, LR, EPS = 6, 0.5, 200, 0.05, 1e-4
rng = np.random.default_rng(0)

target = demo_workspace("gibbs", tau=TAU)
names = target.names
interventions = [{k: v} for k in names for v in (0, 1)]
idx = rng.permutation(len(interventions))
train_iv = [interventions[i] for i in idx[:10]]
test_iv = [interventions[i] for i in idx[10:]]


def with_params(theta, ws=None):
    ws = ws or demo_workspace("quantum")
    return replace(ws, gammas=tuple(theta[:L]), betas=tuple(theta[L:]))


def kl(p, q):
    return float(np.sum(p * (np.log(p + 1e-12) - np.log(q + 1e-12))))


def loss(theta, ivs):
    q = with_params(theta)
    total = kl(target.probs(), q.probs())
    for iv in ivs:
        total += kl(target.do(**iv).probs(), q.do(**iv).probs())
    return total / (1 + len(ivs))


def train(ivs):
    # 초기값 = 선형 램프 (학습 전 quantum 모드와 동일)
    t = (np.arange(L) + 0.5) / L
    theta = np.concatenate([0.6 * t, 0.6 * (1 - t)])
    m = v = np.zeros_like(theta)
    for step in range(1, STEPS + 1):
        g = np.array([(loss(theta + EPS * e, ivs) - loss(theta - EPS * e, ivs)) / (2 * EPS)
                      for e in np.eye(len(theta))])          # ponytail: 유한차분, 파라미터 수백 개면 autodiff로
        m = 0.9 * m + 0.1 * g
        v = 0.999 * v + 0.001 * g * g
        theta = theta - LR * (m / (1 - 0.9 ** step)) / (np.sqrt(v / (1 - 0.999 ** step)) + 1e-8)
    return theta


def evaluate(q, ivs):
    """학습에 안 쓴 개입들: KL 평균, 주변확률 MAE, 직접 결합의 인과 방향 일치율."""
    kls = [kl(target.do(**iv).probs(), q.do(**iv).probs()) for iv in ivs]
    mae = np.mean([abs(target.do(**iv).marginals()[n] - q.do(**iv).marginals()[n])
                   for iv in ivs for n in names])
    agree = []
    for c in target.couplings:
        dt = target.do(**{c.cause: 1}).marginals()[c.effect] - target.do(**{c.cause: 0}).marginals()[c.effect]
        dq = q.do(**{c.cause: 1}).marginals()[c.effect] - q.do(**{c.cause: 0}).marginals()[c.effect]
        agree.append(np.sign(dt) == np.sign(dq))
    return np.mean(kls), mae, np.mean(agree)


if __name__ == "__main__":
    t = (np.arange(L) + 0.5) / L
    ramp = with_params(np.concatenate([0.6 * t, 0.6 * (1 - t)]))
    theta_a = train([])            # A: 개입 없이 기본 상태만으로 학습
    theta_b = train(train_iv)      # B: 개입 10개 포함해 학습
    qa, qb = with_params(theta_a), with_params(theta_b)

    print(f"학습 손실(KL, 기본상태)  램프={loss(ramp_theta := np.concatenate([0.6*t, 0.6*(1-t)]), []):.3f}"
          f"  A={loss(theta_a, []):.3f}  B={loss(theta_b, []):.3f}")
    print(f"{'':10s} {'테스트 KL':>10s} {'주변 MAE':>10s} {'인과방향 일치':>12s}")
    for label, q in (("램프", ramp), ("A(기본만)", qa), ("B(+개입)", qb)):
        k, mae, ag = evaluate(q, test_iv)
        print(f"{label:10s} {k:10.3f} {mae:10.3f} {ag:12.0%}")
    print("γ_A =", np.round(theta_a[:L], 3), " β_A =", np.round(theta_a[L:], 3))
    print("γ_B =", np.round(theta_b[:L], 3), " β_B =", np.round(theta_b[L:], 3))

    # 자체 검증: 학습은 학습 손실을 줄여야 한다
    assert loss(theta_a, []) < loss(ramp_theta, [])
    assert loss(theta_b, train_iv) < loss(ramp_theta, train_iv)
    print("검증 통과")
