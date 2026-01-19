# Tra cứu phạt nguội

Dự án này cho phép nhanh chóng tạo server để tra cứu các vi phạm giao thông sử dụng số biển số xe. Sử dụng dữ liệu từ csgt.vn

## Tính năng

- Nhanh chóng tạo REST API để tra cứu vi phạm giao thông
- Auto retry nếu xác minh captcha thất bại
- Trích xuất và hiển thị thông tin vi phạm giao thông
- Tạo bot Telegram để tra cứu vi phạm giao thông

## Cài đặt

### Yêu cầu

- Node.js (phiên bản 14 hoặc cao hơn)
- npm (Trình quản lý gói Node)

### Các bước

1. Clone repository:

   ```sh
   git clone https://github.com/sumvipconbai/phatnguoi-api.git
   cd phatnguoi-api
   ```

2. Cài đặt các dependency:

   ```sh
   npm install
   ```

3. Tạo file `.env` và thêm token của bot Telegram:

   ```env
   TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
   ```

## Sử dụng

### Chạy server REST API

1. Chạy server:

   ```sh
   node server.js
   ```

2. Gửi yêu cầu GET đến endpoint `/api` với tham số `licensePlate` và `type` (tùy chọn):
   - `type=1`: Ô tô
   - `type=2`: Xe máy (mặc định)

   Ví dụ tra cứu xe máy:
   ```sh
   curl "http://localhost:3000/api?licensePlate=30H47465"
   ```

   Ví dụ tra cứu ô tô:
   ```sh
   curl "http://localhost:3000/api?licensePlate=30H47465&type=1"
   ```

### Chạy bot Telegram

1. Chạy bot:

   ```sh
   node src/telegramBot.js
   ```

2. Sử dụng lệnh `/tracuu` trong Telegram để tra cứu vi phạm giao thông:

   ```sh
   /tracuu 30H47465
   ```

3. Gõ biển số xe trực tiếp trong Telegram để tra cứu vi phạm giao thông:

   ```sh
   30H47465
   ```

## Cấu trúc dự án

- `src/apiCaller.js`: Chứa logic chính để tương tác với API tra cứu vi phạm giao thông.
- `src/extractTrafficViolations.js`: Hàm tiện ích để trích xuất thông tin vi phạm giao thông từ phản hồi API.
- `server.js`: Thiết lập server Express.js với endpoint REST API.
- `src/telegramBot.js`: Thiết lập bot Telegram để tra cứu vi phạm giao thông.

## Giấy phép

Dự án này được cấp phép theo Giấy phép MIT. Xem tệp [LICENSE](LICENSE) để biết chi tiết.
