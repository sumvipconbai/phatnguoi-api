import express from "express";
import { callAPI } from "./apiCaller.js";

const app = express();
const port = 3000;

app.get("/api", async (req, res) => {
  // Lấy thêm tham số type, mặc định là 2 (xe máy) nếu không nhập
  const { licensePlate, type = 2 } = req.query;

  if (!licensePlate) {
    return res.status(400).json({ error: "License plate is required" });
  }

  try {
    // Truyền type vào hàm callAPI
    const violations = await callAPI(licensePlate, type);

    if (violations) {
      res.json({ licensePlate, type, violations }); // Trả về cả type để check
    } else {
      res.status(404).json({ error: "No violations found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
