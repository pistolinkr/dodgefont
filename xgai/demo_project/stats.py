"""작은 통계 유틸리티."""


def mean(xs):
    return sum(xs) / len(xs)


def median(xs):
    s = sorted(xs)
    mid = len(s) // 2
    return s[mid]


def normalize(xs):
    """평균을 0으로 맞춘다."""
    m = mean(xs)
    return [x - m for x in xs]
