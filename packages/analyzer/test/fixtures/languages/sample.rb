# Sample used by the language tests.
def classify(n, items)
  if n < 0 && n > -10
    return "small negative"
  elsif n == 0
    return "zero"
  elsif n == 1
    return "one"
  end
  for item in items
    while item > 0
      item -= 1
    end
  end
  n > 100 ? "big" : "small"
end

class Counter
  def total(items) # rubocop:disable Style/Something
    items.length
  end
end
