// Sample used by the language tests.
func classify(n: Int, items: [Int]) -> String {
    if n < 0 && n > -10 {
        return "small negative"
    } else if n == 0 {
        return "zero"
    } else if n == 1 {
        return "one"
    }
    for value in items {
        var item = value
        while item > 0 {
            item -= 1
        }
    }
    return n > 100 ? "big" : "small"
}

class Counter {
    func total(items: [Int]) -> Int { // swiftlint:disable:this identifier_name
        return items.count
    }
}
