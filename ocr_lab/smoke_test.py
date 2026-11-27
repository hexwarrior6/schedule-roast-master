import json
from ocr_lab.engine import smoke
result=smoke()
print(json.dumps(result,ensure_ascii=False))
assert result["ok"],"Synthetic end-to-end OCR/grid test failed"
