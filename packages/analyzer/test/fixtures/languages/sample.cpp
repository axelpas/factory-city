// Sample used by the language tests.
#include <string>
#include <vector>

std::string classify(int n, std::vector<int> items) {
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

class Counter {
public:
    int total(std::vector<int> items) { // NOLINT
        return static_cast<int>(items.size());
    }
};
