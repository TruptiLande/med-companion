import os
import json
import sys
import numpy as np
from PIL import Image

os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "False"

from paddleocr import PaddleOCR

try:
	CONFIDENCE_THRESHOLD = float(os.environ.get("OCR_CONFIDENCE_THRESHOLD", "0.8"))
	if not 0 <= CONFIDENCE_THRESHOLD <= 1:
		raise ValueError
except ValueError:
	CONFIDENCE_THRESHOLD = 0.8


def mean_confidence(lines):
	scores = [line["confidence"] for line in lines if line["confidence"] is not None]
	return sum(scores) / len(scores) if scores else 0.0


def should_use_fallback(lines, threshold):
	return not lines or mean_confidence(lines) < threshold


def select_best_lines(primary, fallback):
	if fallback and (not primary or mean_confidence(fallback) > mean_confidence(primary)):
		return fallback, "easyocr"
	return primary, "paddleocr"


def recognize(image):
	result = PaddleOCR(
		use_doc_orientation_classify=False,
		use_doc_unwarping=False,
		use_textline_orientation=True,
		lang="en",
	).predict(input=image)
	paddle_result = result[0] if result else {}
	texts = paddle_result.get("rec_texts", [])
	scores = paddle_result.get("rec_scores", [])
	paddle_lines = [
		{"text": text, "confidence": float(scores[index]) if index < len(scores) else None}
		for index, text in enumerate(texts)
	]
	selected_lines = paddle_lines
	selected_engine = "paddleocr"
	warnings = []
	paddle_confidence = mean_confidence(paddle_lines)

	if should_use_fallback(paddle_lines, CONFIDENCE_THRESHOLD):
		try:
			import easyocr

			reader = easyocr.Reader(["en"], gpu=False, verbose=False)
			fallback = reader.readtext(image)
			easy_lines = [
				{"text": text, "confidence": float(score)}
				for _, text, score in fallback
			]
			selected_lines, selected_engine = select_best_lines(paddle_lines, easy_lines)
			if not easy_lines:
				warnings.append("EasyOCR did not recognize text.")
		except Exception as error:
			warnings.append(f"EasyOCR fallback unavailable: {type(error).__name__}.")

	confidence = mean_confidence(selected_lines)
	text = "\n".join(line["text"] for line in selected_lines)
	return {
		"text": text,
		"lines": selected_lines,
		"confidence": round(confidence, 4),
		"threshold": CONFIDENCE_THRESHOLD,
		"engine": selected_engine,
		"needsReview": confidence < CONFIDENCE_THRESHOLD,
		"warnings": warnings,
	}


def main():
	if len(sys.argv) != 2:
		raise SystemExit("Usage: ocr.py <image-path>")
	image = np.array(Image.open(sys.argv[1]).convert("RGB"))
	print(json.dumps(recognize(image), ensure_ascii=False))


if __name__ == "__main__":
	main()
