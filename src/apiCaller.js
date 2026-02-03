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
  // API chính thức CSGT (nguồn chính xác nhất)
  BASE_URL: "https://www.csgt.vn",
  CAPTCHA_PATH: "/lib/captcha/captcha.class.php",
  FORM_ENDPOINT: "/?mod=contact&task=tracuu_post&ajax",
  RESULTS_URL: "https://www.csgt.vn/tra-cuu-phuong-tien-vi-pham.html",
  
  // API backup (ưu tiên cho ô tô - nhanh hơn)
  BACKUP_API_URL: "https://api.checkphatnguoi.vn/phatnguoi",
  
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

// ============================================
// TỰ ĐỘNG PHÁT HIỆN LOẠI XE
// ============================================
function detectVehicleType(plate) {
  // Loại bỏ ký tự đặc biệt và khoảng trắng
  const cleanPlate = plate.replace(/[-.\s]/g, '').toUpperCase();
  
  // Pattern 1: Xe máy kiểu cũ - 2 số + 1 chữ + 1 chữ/số + 5 số
  // Ví dụ: 29A1, 30B2, 51F3 + 12345
  const oldMotorbikePattern = /^(\d{2})([A-Z])(\d)(\d{5})$/;
  
  // Pattern 2: Xe máy kiểu mới - 2 số + 2 chữ cái + 5 số
  // Ví dụ: 29AA, 30AB, 51AC + 12345
  const newMotorbikePattern = /^(\d{2})([A-Z]{2})(\d{5})$/;
  
  // Pattern 3: Ô tô - 2 số + 1-2 chữ cái (không phải 2 chữ giống xe máy) + 5 số
  // Ví dụ: 30A, 51C, 80LD + 12345
  const carPattern = /^(\d{2})([A-Z]{1,2})(\d{5})$/;
  
  // Kiểm tra xe máy kiểu cũ (29A112345)
  if (oldMotorbikePattern.test(cleanPlate)) {
    const match = cleanPlate.match(oldMotorbikePattern);
    const letter = match[2];
    const digit = match[3];
    
    // Xe máy kiểu cũ: chữ cái + 1 chữ số (A1, B2, C3...)
    console.log(`   🔍 Phát hiện: Xe máy (format cũ: ${match[1]}-${letter}${digit})`);
    return 2;
  }
  
  // Kiểm tra xe máy kiểu mới (29AA12345)
  if (newMotorbikePattern.test(cleanPlate)) {
    const match = cleanPlate.match(newMotorbikePattern);
    const letters = match[2];
    
    // Danh sách chữ cái hợp lệ cho xe máy
    const validMotorbikeLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'S', 'T', 'U', 'V', 'X', 'Y', 'Z'];
    
    // Kiểm tra cả 2 chữ cái có trong danh sách xe máy không
    if (validMotorbikeLetters.includes(letters[0]) && validMotorbikeLetters.includes(letters[1])) {
      console.log(`   🔍 Phát hiện: Xe máy (format mới: ${match[1]}-${letters})`);
      return 2;
    }
  }
  
  // Kiểm tra ô tô
  if (carPattern.test(cleanPlate)) {
    const match = cleanPlate.match(carPattern);
    const letters = match[2];
    
    // Nếu có 2 chữ cái đặc biệt cho ô tô (LD, KT, NG...) -> chắc chắn là ô tô
    const carSpecialSeries = ['LD', 'KT', 'NG', 'HC', 'CD', 'NN'];
    if (letters.length === 2 && carSpecialSeries.includes(letters)) {
      console.log(`   🔍 Phát hiện: Ô tô (series đặc biệt: ${letters})`);
      return 1;
    }
    
    // Nếu chỉ 1 chữ cái -> chắc chắn là ô tô
    if (letters.length === 1) {
      console.log(`   🔍 Phát hiện: Ô tô (format: ${match[1]}-${letters})`);
      return 1;
    }
    
    // Nếu 2 chữ cái nhưng không phải series xe máy -> coi là ô tô
    const validMotorbikeLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'S', 'T', 'U', 'V', 'X', 'Y', 'Z'];
    if (!(validMotorbikeLetters.includes(letters[0]) && validMotorbikeLetters.includes(letters[1]))) {
      console.log(`   🔍 Phát hiện: Ô tô (series: ${letters})`);
      return 1;
    }
  }
  
  // Mặc định: xe máy (vì xe máy phổ biến hơn)
  console.log(`   ⚠️ Không xác định được loại xe, mặc định: Xe máy`);
  return 2;
}

// ============================================
// API BACKUP - Ưu tiên cho ô tô (nhanh, không cần captcha)
// ============================================
async function callBackupAPI(plate, vehicleType = 2) {
  try {
    const cleanPlate = plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    const postData = qs.stringify({
      'bienso': cleanPlate,
      'xe': vehicleType.toString()
    });
    
    const response = await axios.post(CONFIG.BACKUP_API_URL, postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Referer': 'https://checkphatnguoi.vn/',
        'Origin': 'https://checkphatnguoi.vn'
      },
      timeout: 15000
    });

    if (response.status === 200 && response.data !== undefined) {
      const json = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      
      if (json.status !== undefined) {
        if (json.status === 2 && json.data === null) {
          console.log("   ✅ API backup: Không có vi phạm");
          return [];
        } else if (json.status === 1 || json.status === 0) {
          console.log("   ✅ API backup: Tìm thấy vi phạm");
          return json.data || [];
        }
      }
      
      if (json.violations || json.data || Array.isArray(json)) {
        console.log("   ✅ API backup: Thành công");
        return json;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// ============================================
// API CHÍNH - Nguồn chính xác từ CSGT (có Captcha)
// ============================================
async function callPrimaryAPI(plate, vehicleType = 2, retries = CONFIG.MAX_RETRIES) {
  try {
    const instance = createAxiosInstance();

    // 1. Vào trang chủ lấy Cookie
    try { await instance.get(CONFIG.RESULTS_URL); } catch (e) {}

    // 2. Giải Captcha
    const captcha = await getCaptcha(instance);

    if (!captcha || captcha.length < 4) { 
       if (retries > 0) return callPrimaryAPI(plate, vehicleType, retries - 1);
       return null;
    }

    // 3. Gửi Form
    const response = await postFormData(instance, plate, captcha, vehicleType);

    // 4. Kiểm tra phản hồi
    if (response.data === 404 || !response.data) {
      if (retries > 0) {
        console.log(`   ❌ Captcha sai (${captcha}). Đang thử lại...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return callPrimaryAPI(plate, vehicleType, retries - 1);
      } else {
        console.log("   ❌ Thất bại: Đã hết lượt thử.");
        return null;
      }
    }

    console.log("   ✅ Captcha chính xác! Đang tải dữ liệu...");

    // 5. Lấy kết quả
    const resultsResponse = await getViolationResults(instance, plate, vehicleType);
    const violations = extractTrafficViolations(resultsResponse.data);

    return violations;

  } catch (error) {
    if (error.message.includes('timeout') && retries > 0) {
         console.log("   ⚠️ Mạng chậm (Timeout). Đang thử lại...");
         return callPrimaryAPI(plate, vehicleType, retries - 1);
    }
    console.error(`   ❌ Lỗi API chính: ${error.message}`);
    return null;
  }
}

// ============================================
// API CHÍNH THỨC - Chỉ dùng CSGT cho cả ô tô và xe máy
// ============================================
export async function callAPI(plate, vehicleType = null, retries = CONFIG.MAX_RETRIES) {
  // Tự động phát hiện loại xe nếu không được cung cấp
  if (vehicleType === null || vehicleType === undefined) {
    vehicleType = detectVehicleType(plate);
  }
  
  // Chỉ hiện log tên biển số khi bắt đầu tra cứu lần đầu
  if (retries === CONFIG.MAX_RETRIES) {
      const vehicleName = vehicleType === 1 ? "Ô tô" : "Xe máy";
      console.log(`➤ Tra cứu: ${plate} (${vehicleName})`);
  }

  // Tra cứu từ CSGT (nguồn chính thức duy nhất)
  console.log("   🔍 Đang tra cứu từ CSGT (nguồn chính thức)...");
  const primaryResult = await callPrimaryAPI(plate, vehicleType, retries);
  
  if (primaryResult !== null) {
    return primaryResult;
  }

  console.log("   ❌ Không thể tra cứu từ CSGT");
  return null;
}