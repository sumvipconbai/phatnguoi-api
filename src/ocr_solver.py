# File: src/ocr_solver.py
import ddddocr
import sys
import os
from PIL import Image
# --- BƯỚC 1: CHẶN IN QUẢNG CÁO ---
# Chuyển hướng toàn bộ thông báo ra "hư vô" (devnull) trước khi load thư viện
old_stdout = sys.stdout
sys.stdout = open(os.devnull, 'w')

# --- BƯỚC 2: IMPORT VÀ INIT THƯ VIỆN ---
import ddddocr
from PIL import Image

# Vá lỗi ANTIALIAS cho Docker (như cũ)
try:
    if not hasattr(Image, 'ANTIALIAS'):
        Image.ANTIALIAS = Image.Resampling.LANCZOS
except AttributeError:
    pass

# Khởi tạo model (Lúc này nó sẽ in quảng cáo nhưng bị chặn không hiện ra)
try:
    ocr = ddddocr.DdddOcr()
except:
    pass

# --- BƯỚC 3: KHÔI PHỤC QUYỀN IN ---
# Trả lại quyền in ra màn hình để in kết quả Captcha
sys.stdout = old_stdout

# --- BƯỚC 4: XỬ LÝ CHÍNH ---
def solve():
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
        
        # In kết quả duy nhất (Node.js sẽ chỉ nhận được cái này)
        print(res)
        
    except Exception:
        pass

if __name__ == "__main__":
    solve()
