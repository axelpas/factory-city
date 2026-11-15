// Sample used by the language tests.
package sample

func classify(n int, items []int) string {
	if n < 0 && n > -10 {
		return "small negative"
	} else if n == 0 {
		return "zero"
	} else if n == 1 {
		return "one"
	}
	for _, item := range items {
		for item > 0 {
			item--
		}
	}
	if n > 100 { //nolint
		return "big"
	}
	return "small"
}

type Counter struct{}

func (c Counter) total(items []int) int {
	return len(items)
}
