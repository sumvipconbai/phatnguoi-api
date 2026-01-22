import axios from "axios";
import qs from "qs";
import fs from "fs";
import path from "path";
import tough from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import { extractTrafficViolations } from "./extractTrafficViotations.js";
import dns from "dns";
import { execSync } from "child_process";

const { CookieJar } = tough;

// --- CẤU HÌNH FIX LỖI MẠNG ---
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (e) {}

const CONFIG = {
  BASE_URL: "https://www.csgt.vn",
  CAPTCHA_PATH: "/lib/captcha/captcha.class.php",
  FORM_ENDPOINT: "/?mod=contact&task=tracuu_post&ajax",
  RESULTS_URL: "https://www.csgt.vn/tra-cuu-phuong-tien-vi-pham.html",
  MAX_RETRIES: 3, 
  HEADERS: {
    USER_AGENT:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ACCEPT:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    CONTENT_TYPE: "application/x-www-form-urlencoded",
  },
};

function createAxiosInstance() {
  const jar = new CookieJar();
  const instance = axios.create({
    jar,
    withCredentials: true,
    baseURL: CONFIG.BASE_URL,
    headers: {
      "User-Agent": CONFIG.HEADERS.USER_AGENT,
      Accept: CONFIG.HEADERS.ACCEPT,
      "Referer": CONFIG.RESULTS_URL,
      "Origin": "https://www.csgt.vn", // Quan trọng để tránh lỗi 403/Timeout khi POST
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1"
    },
    // --- FIX LỖI: Tăng timeout lên 60 giây ---
    timeout: 60000 
  });
  return wrapper(instance);
}

function solveCaptchaWithPython(imageBuffer) {
  const tempFileName = `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
  const tempFilePath = path.resolve("src", tempFileName);

  try {
    fs.writeFileSync(tempFilePath, imageBuffer);
    const pythonScriptPath = path.resolve("src", "ocr_solver.py");
    
    // Lưu ý: Nếu vẫn lỗi, thử đổi 'python' thành 'python3'
    const command = `python "${pythonScriptPath}" "${tempFilePath}"`;
    const stdout = execSync(command, { encoding: 'utf-8' });
    return stdout.trim().toLowerCase();

  } catch (error) {
    console.error("Lỗi khi gọi Python OCR:", error.message);
    return "";
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch(e) {}
    }
  }
}

async function getCaptcha(instance) {
  try {
    const image = await instance.get(CONFIG.CAPTCHA_PATH, {
      responseType: "arraybuffer",
      headers: {
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });

    const imageBuffer = Buffer.from(image.data);
    const text = solveCaptchaWithPython(imageBuffer);
    
    const icon = text.length === 6 ? "✓" : "⚠";
    console.log(`   ${icon} Captcha OCR: "${text}"`);

    return text;
  } catch (error) {
    throw new Error(`Failed to get captcha: ${error.message}`);
  }
}

async function postFormData(instance, plate, captcha, vehicleType) {
  const formData = qs.stringify({
    BienKS: plate,
    Xe: vehicleType ? vehicleType.toString() : "2",
    captcha,
    ipClient: "113.161.76.54", // IP ngẫu nhiên Việt Nam để đỡ bị chặn
    cUrl: "1",
  });

  return instance.post(CONFIG.FORM_ENDPOINT, formData, {
    headers: {
      "Content-Type": CONFIG.HEADERS.CONTENT_TYPE,
      "X-Requested-With": "XMLHttpRequest" // Header quan trọng cho request AJAX
    },
  });
}

async function getViolationResults(instance, plate, vehicleType) {
  return instance.get(`${CONFIG.RESULTS_URL}?&LoaiXe=${vehicleType}&BienKiemSoat=${plate}`);
}

export async function callAPI(plate, vehicleType = 2, retries = CONFIG.MAX_RETRIES) {
  try {
    // Chỉ hiện log tên biển số khi bắt đầu tra cứu lần đầu
    if (retries === CONFIG.MAX_RETRIES) {
        console.log(`➤ Tra cứu: ${plate} (Loại xe: ${vehicleType})`);
    }

    const instance = createAxiosInstance();

    // 1. Vào trang chủ lấy Cookie
    try { await instance.get(CONFIG.RESULTS_URL); } catch (e) {}

    // 2. Giải Captcha
    const captcha = await getCaptcha(instance);

    if (!captcha || captcha.length < 4) { 
       if (retries > 0) return callAPI(plate, vehicleType, retries - 1);
       return null;
    }

    // 3. Gửi Form
    const response = await postFormData(instance, plate, captcha, vehicleType);

    // 4. Kiểm tra phản hồi
    // Nếu server trả về 404 hoặc không có data -> Thường là do sai Captcha
    if (response.data === 404 || !response.data) {
      if (retries > 0) {
        console.log(`   ❌ Captcha sai (${captcha}). Đang thử lại...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Nghỉ 2s
        return callAPI(plate, vehicleType, retries - 1);
      } else {
        console.log("   ❌ Thất bại: Đã hết lượt thử.");
        return null;
      }
    }

    // --- ĐÚNG YÊU CẦU CỦA BẠN ---
    console.log("   ✅ Captcha chính xác! Đang tải dữ liệu...");

    // 5. Lấy kết quả ngầm (không in ra console)
    const resultsResponse = await getViolationResults(instance, plate, vehicleType);
    const violations = extractTrafficViolations(resultsResponse.data);

    return violations;

  } catch (error) {
    // Xử lý lỗi Timeout
    if (error.message.includes('timeout') && retries > 0) {
         console.log("   ⚠️ Mạng chậm (Timeout). Đang thử lại...");
         return callAPI(plate, vehicleType, retries - 1);
    }
    console.error(`   ❌ Lỗi hệ thống: ${error.message}`);
    return null;
  }
}