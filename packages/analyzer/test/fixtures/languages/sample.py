# Sample used by the language tests.
import os  # noqa


def classify(n, items):
    if n < 0 and n > -10:
        return "small negative"
    elif n == 0:
        return "zero"
    elif n == 1:
        return "one"
    for item in items:
        while item > 0:
            item -= 1
    return "big" if n > 100 else "small"


class Counter:
    def total(self, items):
        return len(items)
