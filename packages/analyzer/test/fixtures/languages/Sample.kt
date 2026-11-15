// Sample used by the language tests.
fun classify(n: Int, items: List<Int>): String {
    if (n < 0 && n > -10) {
        return "small negative"
    } else if (n == 0) {
        return "zero"
    } else if (n == 1) {
        return "one"
    }
    for (value in items) {
        var item = value
        while (item > 0) {
            item--
        }
    }
    if (n > 100) {
        return "big"
    }
    return "small"
}

class Counter {
    @Suppress("unused")
    fun total(items: List<Int>): Int {
        return items.size
    }
}
