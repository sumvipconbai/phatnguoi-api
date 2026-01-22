# File: src/ocr_solver.py
import ddddocr
import sys
import os
from PIL import Image

# --- ĐOẠN VÁ LỖI QUAN TRỌNG (FIX LỖI PILLOW MỚI) ---
try:
    if not hasattr(Image, 'ANTIALIAS'):
        Image.ANTIALIAS = Image.Resampling.LANCZOS
except AttributeError:
    pass
# ---------------------------------------------------

def solve():
    # Khởi tạo ddddocr (đã bỏ show_ad=False để tránh lỗi)
    try:
        ocr = ddddocr.DdddOcr()
    except Exception as e:
        # Nếu lỗi init thì in rỗng để Nodejs biết
        return

    # Lấy đường dẫn ảnh từ tham số dòng lệnh
    if len(sys.argv) < 2:
        return

    image_path = sys.argv[1]
    
    if not os.path.exists(image_path):
        return
    
    try:
        with open(image_path, 'rb') as f:
            img_bytes = f.read()
        
        # Giải captcha
        res = ocr.classification(img_bytes)
        
        # In kết quả ra màn hình (stdout) để Node.js bắt lấy
        print(res)
        
    except Exception:
        pass

if __name__ == "__main__":
    solve()