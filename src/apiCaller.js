import axios from "axios";
import Tesseract from "tesseract.js";
import qs from "qs";
import fs from "fs";
import tough from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import { extractTrafficViolations } from "./extractTrafficViotations.js";
import dns from "dns";
import sharp from "sharp"; // Cần cài: npm install sharp

const { CookieJar } = tough;
// --- THÊM ĐOẠN NÀY ĐỂ FIX LỖI KẾT NỐI ---
// 1. Bỏ qua lỗi SSL (nếu server CSGT bị lỗi chứng chỉ)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// 2. Ưu tiên dùng IPv4 (Fix lỗi ECONNRESET)
try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (e) {
  // Bỏ qua nếu Node.js đời cũ chưa hỗ trợ hàm này
}
// ------------------------------------------

/**
 * Configuration constants
 */
const CONFIG = {
  BASE_URL: "https://www.csgt.vn",
  CAPTCHA_PATH: "/lib/captcha/captcha.class.php",
  FORM_ENDPOINT: "/?mod=contact&task=tracuu_post&ajax",
  RESULTS_URL: "https://www.csgt.vn/tra-cuu-phuong-tien-vi-pham.html",
  MAX_RETRIES: 8,
  HEADERS: {
    // Cập nhật User-Agent mới nhất (Chrome 120+)
    USER_AGENT:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ACCEPT:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    CONTENT_TYPE: "application/x-www-form-urlencoded",
  },
};

/**
 * Creates and configures an axios instance with cookie support
 * @returns {Object} Configured axios instance
 */
function createAxiosInstance() {
  const jar = new CookieJar();
  const instance = axios.create({
    jar,
    withCredentials: true,
    baseURL: CONFIG.BASE_URL,
    headers: {
      "User-Agent": CONFIG.HEADERS.USER_AGENT,
      Accept: CONFIG.HEADERS.ACCEPT,
      // Giữ lại 2 dòng này để giả lập trình duyệt thật
      "Referer": "https://www.csgt.vn/tra-cuu-phuong-tien-vi-pham.html", 
      "Origin": "https://www.csgt.vn"
    },
    timeout: 15000 // Tăng timeout lên 15s
  });
  return wrapper(instance);
}

/**
 * Preprocesses captcha image for better OCR accuracy
 * @param {Buffer} imageBuffer - Raw image buffer
 * @param {number} configIndex - Index of preprocessing configuration
 * @returns {Promise<Buffer>} Processed image buffer
 */
async function preprocessCaptchaImage(imageBuffer, configIndex = 0) {
  try {
    let processedImage;
    
    if (configIndex === 0) {
      // Config 1: Xử lý mạnh - TỐI ƯU: Giảm threshold xuống 130
      processedImage = await sharp(imageBuffer)
        .resize(600, 200, { 
          fit: 'fill',
          kernel: sharp.kernel.lanczos3
        })
        .grayscale()
        .normalize()
        .linear(1.5, -(128 * 0.5))
        .median(3)
        .threshold(130) // Giảm từ 140 -> 130 để giữ nhiều chi tiết hơn
        .toBuffer();
    } else if (configIndex === 1) {
      // Config 2: Xử lý vừa
      processedImage = await sharp(imageBuffer)
        .resize(500, 180, { fit: 'fill' })
        .grayscale()
        .normalize()
        .threshold(120)
        .toBuffer();
    } else {
      // Config 3: Xử lý nhẹ với sharpen
      processedImage = await sharp(imageBuffer)
        .resize(450, 160)
        .grayscale()
        .sharpen()
        .toBuffer();
    }
    
    return processedImage;
  } catch (error) {
    console.error("Image preprocessing failed:", error.message);
    return imageBuffer;
  }
}

/**
 * Cleans and validates captcha text
 * @param {string} text - Raw OCR output
 * @returns {string} Cleaned captcha text
 */
function cleanCaptchaText(text) {
  let cleaned = text
    .trim()
    .replace(/\s+/g, '') // Loại bỏ khoảng trắng
    .replace(/[^a-zA-Z0-9]/g, '') // Chỉ giữ chữ và số
    .toLowerCase(); // QUAN TRỌNG: Captcha csgt.vn là chữ THƯỜNG!
  
  return cleaned;
}

/**
 * Fetches and processes captcha image with multiple OCR attempts
 * @param {Object} instance - Axios instance
 * @returns {Promise<string>} Recognized captcha text
 */
async function getCaptcha(instance) {
  try {
    const image = await instance.get(CONFIG.CAPTCHA_PATH, {
      responseType: "arraybuffer",
    });

    const imageBuffer = Buffer.from(image.data);
    
    // Thử nhiều cấu hình khác nhau - CHỮ THƯỜNG + SỐ
    const configs = [
      {
        psm: Tesseract.PSM.SINGLE_LINE,
        whitelist: "abcdefghijklmnopqrstuvwxyz0123456789"
      },
      {
        psm: Tesseract.PSM.SINGLE_WORD,
        whitelist: "abcdefghijklmnopqrstuvwxyz0123456789"
      },
      {
        psm: Tesseract.PSM.SINGLE_LINE,
        whitelist: "0123456789abcdefghijklmnopqrstuvwxyz"
      }
    ];

    let bestResult = null;
    let bestConfidence = 0;
    const MIN_ACCEPTABLE_CONFIDENCE = 70; // Ngưỡng tin cậy chấp nhận được

    // Thử tất cả config và chọn kết quả tốt nhất
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      const processedImage = await preprocessCaptchaImage(imageBuffer, i);

      const result = await Tesseract.recognize(processedImage, "eng", {
        logger: (m) => {},
        tessedit_pageseg_mode: config.psm,
        tessedit_char_whitelist: config.whitelist,
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
      });

      const confidence = result.data.confidence;
      const text = cleanCaptchaText(result.data.text);

      console.log(`  Config ${i + 1}: "${text}" (confidence: ${confidence.toFixed(1)}%)`);

      // Ưu tiên captcha có độ dài 5-6 ký tự và confidence cao
      if (text.length >= 5 && text.length <= 6 && confidence > bestConfidence) {
        bestResult = text;
        bestConfidence = confidence;
      }

      // TỐI ƯU: Nếu đạt confidence cao ngay từ đầu, dừng sớm
      if (bestResult && bestConfidence >= MIN_ACCEPTABLE_CONFIDENCE && bestResult.length === 6) {
        console.log(`  ⚡ Early stop - High confidence detected!`);
        break;
      }
    }

    if (!bestResult) {
      // Fallback: lấy kết quả đầu tiên
      const processedImage = await preprocessCaptchaImage(imageBuffer, 0);
      const result = await Tesseract.recognize(processedImage, "eng", {
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyz0123456789",
      });
      bestResult = cleanCaptchaText(result.data.text);
      bestConfidence = result.data.confidence;
    }

    const warningIcon = bestConfidence < 60 ? "⚠" : bestConfidence >= 75 ? "✓" : "→";
    console.log(`${warningIcon} Final captcha: "${bestResult}" (confidence: ${bestConfidence.toFixed(1)}%)`);
    
    if (bestResult.length < 5 || bestResult.length > 6) {
      console.warn(`⚠ Unusual length: ${bestResult.length} chars (expected 5-6)`);
    }

    return bestResult;
  } catch (error) {
    throw new Error(`Failed to get or process captcha: ${error.message}`);
  }
}

/**
 * Submits form data with plate number and captcha
 * @param {Object} instance - Axios instance
 * @param {string} plate - License plate number
 * @param {string} captcha - Recognized captcha text
 * @returns {Promise<Object>} API response
 */
async function postFormData(instance, plate, captcha, vehicleType) {
  const formData = qs.stringify({
    BienKS: plate,
    Xe: vehicleType ? vehicleType.toString() : "2",
    captcha,
    ipClient: "9.9.9.91",
    cUrl: "1",
  });

  return instance.post(CONFIG.FORM_ENDPOINT, formData, {
    headers: {
      "Content-Type": CONFIG.HEADERS.CONTENT_TYPE,
    },
  });
}

/**
 * Fetches traffic violation results
 * @param {Object} instance - Axios instance
 * @param {string} plate - License plate number
 * @returns {Promise<Object>} Results page response
 */
async function getViolationResults(instance, plate, vehicleType) {
  return instance.get(`${CONFIG.RESULTS_URL}?&LoaiXe=${vehicleType}&BienKiemSoat=${plate}`);
}

/**
 * Main function to call the traffic violation API
 * @param {string} plate - License plate number
 * @param {number} vehicleType - Vehicle type (1: car, 2: motorcycle)
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<Object|null>} Extracted traffic violations or null on failure
 */
export async function callAPI(plate, vehicleType = 2, retries = CONFIG.MAX_RETRIES) {
  try {
    console.log(`Attempt ${CONFIG.MAX_RETRIES - retries + 1}: Fetching for ${plate} (Type: ${vehicleType})`);
    const instance = createAxiosInstance();
    const captcha = await getCaptcha(instance);

    const response = await postFormData(instance, plate, captcha, vehicleType);

    if (response.data === 404) {
      if (retries > 0) {
        console.log(`❌ Captcha failed. Retrying... (${retries} attempts left)`);
        // TỐI ƯU: Tăng delay lên 800ms để tránh rate limit
        await new Promise(resolve => setTimeout(resolve, 800));
        return callAPI(plate, vehicleType, retries - 1);
      } else {
        throw new Error("Maximum retry attempts reached.");
      }
    }

    const resultsResponse = await getViolationResults(instance, plate, vehicleType);
    const violations = extractTrafficViolations(resultsResponse.data);

    return violations;
  } catch (error) {
    console.error(
      `Error fetching traffic violations for plate ${plate}:`,
      error.message
    );
    return null;
  }
}
