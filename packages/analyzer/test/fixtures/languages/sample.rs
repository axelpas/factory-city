// Sample used by the language tests.
fn classify(n: i32, items: &[i32]) -> &'static str {
    if n < 0 && n > -10 {
        return "small negative";
    } else if n == 0 {
        return "zero";
    } else if n == 1 {
        return "one";
    }
    for item in items {
        let mut left = *item;
        while left > 0 {
            left -= 1;
        }
    }
    if n > 100 {
        return "big";
    }
    "small"
}

struct Counter;

impl Counter {
    #[allow(dead_code)]
    fn total(&self, items: &[i32]) -> usize {
        items.len()
    }
}
