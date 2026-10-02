import unittest

from ocr import mean_confidence, select_best_lines, should_use_fallback


class OcrFallbackTests(unittest.TestCase):
    def test_uses_average_line_confidence(self):
        self.assertAlmostEqual(mean_confidence([
            {"text": "one", "confidence": 0.8},
            {"text": "two", "confidence": 1.0},
        ]), 0.9)

    def test_requests_fallback_for_empty_or_low_confidence_results(self):
        self.assertTrue(should_use_fallback([], 0.8))
        self.assertTrue(should_use_fallback([{"text": "unclear", "confidence": 0.4}], 0.8))
        self.assertFalse(should_use_fallback([{"text": "clear", "confidence": 0.9}], 0.8))

    def test_selects_fallback_only_when_it_improves_confidence(self):
        primary = [{"text": "one", "confidence": 0.4}]
        better = [{"text": "one", "confidence": 0.9}]
        worse = [{"text": "one", "confidence": 0.2}]
        self.assertEqual(select_best_lines(primary, better), (better, "easyocr"))
        self.assertEqual(select_best_lines(primary, worse), (primary, "paddleocr"))
        self.assertEqual(select_best_lines([], better), (better, "easyocr"))


if __name__ == "__main__":
    unittest.main()