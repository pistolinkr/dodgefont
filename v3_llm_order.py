"""V3: 백본 LLM(로컬 Gemma 4 E4B, ollama)의 순서 효과 자가 감사.

질문 쌍을 양쪽 순서로 묻고, 첫 토큰 logprob으로 순서별 4칸 결합확률을 **정확히** 계산:
  P(x, y) = P(첫 답=x) · P(둘째 답=y | 대화에 첫 답 x 포함)
그 뒤 order_effect의 게이트(C-joint / C-free / Q)를 그대로 적용.
에이전트는 C-joint(순서 무관)가 나와야 정상. 아니면 편향 플래그.
"""
import json
import urllib.request
import numpy as np
from order_effect import fit_all, qq

MODEL, URL = "gemma4-e4b-local", "http://localhost:11434/api/chat"
SYSTEM = "Answer with exactly one word: Yes or No."
N_VIRTUAL = 500    # 게이트용 가상 표본 (설문과 같은 규모)

PAIRS = {
    "Clinton/Gore": ("Do you generally think Bill Clinton is honest and trustworthy?",
                     "Do you generally think Al Gore is honest and trustworthy?"),
    "원자력/석탄": ("Is nuclear power safe?", "Is coal power safe?"),
    "육식/가죽": ("Is it acceptable to eat meat?", "Is it acceptable to wear leather?"),
    "감속/차선변경": ("Should an autonomous car slow down on a wet road?",
                  "Should an autonomous car change lanes on a wet road?"),
    "인플레/실업": ("Is a 2% inflation rate healthy for an economy?",
                "Is a 2% unemployment rate healthy for an economy?"),
    "업무메일/SNS": ("Is it acceptable for a company to monitor employees' work emails?",
                 "Is it acceptable for a company to monitor employees' personal social media?"),
}


def p_yes(messages):
    body = {"model": MODEL, "stream": False, "think": False, "logprobs": True, "top_logprobs": 20,
            "options": {"num_predict": 1, "temperature": 0}, "messages": messages}
    req = urllib.request.Request(URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
    top = json.load(urllib.request.urlopen(req, timeout=300))["logprobs"][0]["top_logprobs"]
    y = sum(np.exp(t["logprob"]) for t in top if t["token"].strip().lower() == "yes")
    n = sum(np.exp(t["logprob"]) for t in top if t["token"].strip().lower() == "no")
    return y / (y + n), y + n          # (정규화된 P(yes), yes/no가 차지한 확률질량)


def joint(q1, q2):
    sys_ = {"role": "system", "content": SYSTEM}
    p1, cov = p_yes([sys_, {"role": "user", "content": q1}])
    p2 = {}
    for ans in ("Yes", "No"):
        p2[ans], c = p_yes([sys_, {"role": "user", "content": q1}, {"role": "assistant", "content": ans},
                            {"role": "user", "content": q2}])
        cov = min(cov, c)
    return np.array([p1 * p2["Yes"], p1 * (1 - p2["Yes"]),
                     (1 - p1) * p2["No"], (1 - p1) * (1 - p2["No"])]), cov


if __name__ == "__main__":
    flags = {}
    for name, (qa, qb) in PAIRS.items():
        ab, cov1 = joint(qa, qb)
        ba, cov2 = joint(qb, qa)
        assert abs(ab.sum() - 1) < 1e-9 and abs(ba.sum() - 1) < 1e-9
        bics, _ = fit_all(np.round(ab * N_VIRTUAL), np.round(ba * N_VIRTUAL))
        win = min(bics, key=bics.get)
        flags[name] = win != "C-joint"
        dA = (ba[0] + ba[2]) - (ab[0] + ab[1])        # A를 나중에 물었을 때 − 먼저 물었을 때
        dB = (ab[0] + ab[2]) - (ba[0] + ba[1])
        print(f"\n[{name}]  yes/no 확률질량 최소 {min(cov1, cov2):.2f}")
        print(f"   A→B: {np.round(ab, 3)}   B→A: {np.round(ba, 3)}")
        print(f"   순서효과 ΔP(A=yes)={dA:+.3f}  ΔP(B=yes)={dB:+.3f}   QQ={qq(ab, ba):+.3f}")
        print(f"   게이트: {win}  {'⚠ 편향 플래그' if flags[name] else '정상 (순서 무관)'}")
    print(f"\n편향 플래그: {sum(flags.values())}/{len(flags)} 쌍  → {[k for k, v in flags.items() if v]}")
