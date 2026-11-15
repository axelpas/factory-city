// Sample used by the language tests.
class Sample
{
    static string Classify(int n, int[] items)
    {
        if (n < 0 && n > -10)
        {
            return "small negative";
        }
        else if (n == 0)
        {
            return "zero";
        }
        else if (n == 1)
        {
            return "one";
        }
        foreach (var value in items)
        {
            var item = value;
            while (item > 0)
            {
                item--;
            }
        }
        return n > 100 ? "big" : "small";
    }

#pragma warning disable CS0168
    int Total(int[] items)
    {
        return items.Length;
    }
}
