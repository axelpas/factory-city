/* Sample used by the language tests. */
const char *classify(int n, int *items, int count) {
    if (n < 0 && n > -10) {
        return "small negative";
    } else if (n == 0) {
        return "zero";
    } else if (n == 1) {
        return "one";
    }
    for (int i = 0; i < count; i++) {
        while (items[i] > 0) {
            items[i]--;
        }
    }
    return n > 100 ? "big" : "small";
}

int total(int count) { /* NOLINT */
    return count;
}
