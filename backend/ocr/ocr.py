import os
import sys
import numpy as np
from PIL import Image

os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "False")

from paddleocr import PaddleOCR

image = np.array(Image.open(sys.argv[1]).convert("RGB"))
results = PaddleOCR(
	use_doc_orientation_classify=False,
	use_doc_unwarping=False,
	use_textline_orientation=True,
	lang="en",
).predict(input=image)
print("\n".join(results[0].get("rec_texts", []) if results else []))
