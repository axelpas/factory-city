// Sample used by the language tests.
class Sample {
    static String classify(int n, int[] items) {
        if (n < 0 && n > -10) {
            return "small negative";
        } else if (n == 0) {
            return "zero";
        } else if (n == 1) {
            return "one";
        }
        for (int item : items) {
            while (item > 0) {
                item--;
            }
        }
        return n > 100 ? "big" : "small";
    }

    @SuppressWarnings("unchecked")
    int total(int[] items) {
        return items.length;
    }
}
