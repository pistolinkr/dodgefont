"""V2: 실제 설문 순서효과 데이터에 Q-User(QQ 게이트) 적용.

출처: Aerts & Sassoli de Bianchi, arXiv:1508.03686 Eq.(26), Eq.(39)
      (원자료 Gallup 1997 / Moore 2002, 확률은 Wang & Busemeyer 2013, "모름" 응답 제외)
가정: 총 N≈1000, 순서별 500명 (논문에 정확한 분할 없음) → 확률 × 500 반올림.
"""
import numpy as np
from order_effect import fit_all, qq
from quser import fit_q, n_params

N_PER_ORDER = 500
SURVEYS = {
    # (첫 질문 yes/no × 둘째 질문 yes/no) 순: (y,y),(y,n),(n,y),(n,n)
    "Clinton/Gore": ([.4899, .0447, .1767, .2887],    # Clinton 먼저
                     [.5625, .1991, .0255, .2129]),   # Gore 먼저
    "Rose/Jackson": ([.3379, .3241, .0178, .3202],    # Rose 먼저
                     [.4156, .0671, .1234, .3939]),   # Jackson 먼저
}

if __name__ == "__main__":
    for name, (ab, ba) in SURVEYS.items():
        ab, ba = np.array(ab), np.array(ba)
        c_ab, c_ba = np.round(ab * N_PER_ORDER), np.round(ba * N_PER_ORDER)
        q = qq(ab, ba)
        d1, d2 = ab[1] + ab[2], ba[1] + ba[2]
        z = q / np.sqrt(d1 * (1 - d1) / N_PER_ORDER + d2 * (1 - d2) / N_PER_ORDER)
        bics, (phi, theta) = fit_all(c_ab, c_ba)
        # d=3: 2차원의 "P(B|A=yes)+P(B|A=no)=1" 제약이 풀림 (유효 파라미터 3개)
        data = {(0, 1): c_ab, (1, 0): c_ba}
        n = c_ab.sum() + c_ba.sum()
        L3, _ = fit_q(data, d=3, k=2)
        bics["Q3"] = n_params(3, 2) * np.log(n) - 2 * L3
        # Q3r: 질문별로 yes 부분공간을 1차원 또는 2차원으로 (4가지 중 최선, 이산 선택은 BIC 미반영)
        best = max(((fit_q(data, 3, 2, flips=f)[0], f) for f in [(a, b) for a in (0, 1) for b in (0, 1)]),
                   key=lambda t: t[0])
        bics["Q3r"] = n_params(3, 2) * np.log(n) - 2 * best[0]
        ranks = "/".join("2" if f else "1" for f in best[1])
        bics["Q2"] = bics.pop("Q")
        win = min(bics, key=bics.get)
        a_first, a_second = ab[0] + ab[1], ba[0] + ba[2]
        b_first, b_second = ba[0] + ba[1], ab[0] + ab[2]
        q1, q2 = name.split("/")
        print(f"\n[{name}]")
        print(f"   P({q1}=yes) 먼저 {a_first:.3f} / 나중 {a_second:.3f}    "
              f"P({q2}=yes) 먼저 {b_first:.3f} / 나중 {b_second:.3f}")
        print(f"   QQ = {q:+.4f}  (z = {z:+.2f}, |z|<1.96 이면 QQ 등식 기각 못 함)")
        for m, b in sorted(bics.items(), key=lambda kv: kv[1]):
            print(f"   {m:8s} BIC={b:8.1f}{'  ← 선택' if m == win else ''}")
        print(f"   (Q3r yes 부분공간 차원 {q1}/{q2} = {ranks})")
        print(f"   QQ 게이트: {'통과 → Q-User(' + win + ') 사용' if win.startswith('Q') else '불통과 → ' + win + ' 사용'}")
