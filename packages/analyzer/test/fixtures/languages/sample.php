<?php
// Sample used by the language tests.
function classify($n, $items) {
    if ($n < 0 && $n > -10) {
        return "small negative";
    } elseif ($n == 0) {
        return "zero";
    } else if ($n == 1) {
        return "one";
    }
    foreach ($items as $item) {
        while ($item > 0) {
            $item--;
        }
    }
    return $n > 100 ? "big" : "small";
}

class Counter {
    function total($items) { // phpcs:ignore
        return count($items);
    }
}
