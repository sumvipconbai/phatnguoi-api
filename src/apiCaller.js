import axios from "axios";
import Tesseract from "tesseract.js";
import qs from "qs";
import fs from "fs";
import tough from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import { extractTrafficViolations } from "./extractTrafficViotations.js";
import dns from "dns";

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
 * Fetches and processes captcha image
 * @param {Object} instance - Axios instance
 * @returns {Promise<string>} Recognized captcha text
 */
async function getCaptcha(instance) {
  try {
    const image = await instance.get(CONFIG.CAPTCHA_PATH, {
      responseType: "arraybuffer",
    });

    // Optional: save captcha for debugging
    // fs.writeFileSync("captcha.jpg", Buffer.from(image.data), "binary");

    const captchaResult = await Tesseract.recognize(image.data, "eng", {
      tessedit_char_whitelist: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  });
    return captchaResult.data.text.trim();
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
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<Object|null>} Extracted traffic violations or null on failure
 */
// Thêm vehicleType = 2 (mặc định là xe máy nếu không truyền)
export async function callAPI(plate, vehicleType = 2, retries = CONFIG.MAX_RETRIES) { // Mặc định là 2
  try {
    console.log("Fetching traffic violations for plate:", plate, "Type:", vehicleType);
    const instance = createAxiosInstance();
    const captcha = await getCaptcha(instance);

    // SỬA: Phải truyền vehicleType vào đây
    const response = await postFormData(instance, plate, captcha, vehicleType);

    if (response.data === 404) {
      if (retries > 0) {
        console.log(`Captcha verification failed. Retrying...`);
        //await sleep(1000); // Thêm delay trước khi thử lại (500ms)
        // SỬA: Đệ quy cũng phải truyền vehicleType
        return callAPI(plate, vehicleType, retries - 1);
      } else {
        throw new Error("Maximum retry attempts reached.");
      }
    }

    // SỬA: Phải truyền vehicleType vào đây nữa
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
