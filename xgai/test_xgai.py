"""API 호출 없이 xgai의 안전장치·장부·게이트·보고서를 검증. 모델이 할 법한 호출 순서를 손으로 재현."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from xgai import Workspace, make_tools, prepare, write_report  # noqa: E402

DEMO = Path(__file__).parent / "demo_project"

tmp = Path(tempfile.mkdtemp())
orig, work = prepare(str(DEMO), tmp)
refuse = [False]
ws = Workspace(work, ask=lambda _: "n" if refuse[0] else "y", orig=orig)

# 1. 샌드박스 탈출 차단
for bad in ("../../etc/passwd", "/etc/passwd"):
    try:
        ws.read_file(bad)
        raise AssertionError("샌드박스 밖 읽기가 허용됨")
    except ValueError:
        pass

# 2. 관측: 테스트 실패 확인. pipefail 때문에 `| tail` 로도 실패가 숨겨지지 않음
out = ws.run("python3 -m unittest 2>&1 | tail -5", "현재 상태 확인")
assert ws.last_exit != 0 and "FAILED" in out

# 3. 중첩: 경쟁 가설 두 개
ws.hypothesis("H1", "median이 짝수 길이에서 가운데 두 값의 평균을 안 냄", 0.7, "open", "stats.py:11, [run#0]")
dist = ws.hypothesis("H2", "테스트 기대값 2.5가 틀림", 0.3, "open", "test_stats.py:13")
assert "H1: 0.70" in dist and "H2: 0.30" in dist

# 4. 변경 없이 커밋 → 거부
try:
    ws.commit("H1", "x", "python3 -m unittest")
    raise AssertionError("변경 없이 커밋됨")
except ValueError:
    pass

# 5. 잘못된 수정 → 검증 실패 → 커밋 거부
ws.edit_file("stats.py", "return s[mid]", "return s[mid - 1]")
r = ws.commit("H1", "잘못된 수정", "python3 -m unittest")
assert r.startswith("커밋 거부") and ws.committed is None

# 6. 사용자 거부 → 실행 안 됨, 커밋도 안 됨
refuse[0] = True
r = ws.commit("H1", "거부될 커밋", "python3 -m unittest")
assert ws.committed is None and "거부" in r
refuse[0] = False

# 7. 올바른 수정
ws.edit_file("stats.py", "return s[mid - 1]",
             "return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2")
ws.hypothesis("H2", "테스트 기대값 2.5가 틀림", 0.0, "refuted", "통계 정의상 [1,2,3,4]의 중앙값은 2.5")

# 8. 수정과 무관한 검증(원본에서도 통과) → 반사실 검증이 거부
for weak in ("python3 -c 'pass'", "python3 -m unittest || true"):
    r = ws.commit("H1", "약한 검증", weak)
    assert ws.committed is None and "원본에서도 통과" in r, (weak, r)

# 9. 진짜 검증: 수정본 통과 + 원본 실패 → 커밋 (붕괴)
r = ws.commit("H1", "짝수 길이 median 수정", "python3 -m unittest")
assert ws.committed and ws.committed["orig_exit"] not in (None, 0), r
assert ws.hyps["H1"]["status"] == "committed"

# 10. 사용자 원본은 그대로
assert "return s[mid]\n" in (DEMO / "stats.py").read_text()

# 11. 보고서·패치
rep = write_report(ws, orig, tmp / "out", "테스트 실패 고치기", "요약", 0.0, "커밋 성공 (검증 통과)")
patch = (tmp / "out" / "changes.patch").read_text()
text = rep.read_text()
assert "+    return s[mid] if len(s) % 2" in patch and "stats.py" in patch
assert "| `H2` |" in text and "refuted" in text and "반사실 검증: 같은 명령이 수정 전 원본에서 exit" in text

# 12. 도구 정의가 SDK에서 만들어짐 (API 호출 없음)
assert len(make_tools(ws)) == 7

print("모든 오프라인 검증 통과")
