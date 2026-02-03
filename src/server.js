import express from "express";
import { callAPI } from "./apiCaller.js";

const app = express();
const port = 3000;

app.get("/api", async (req, res) => {
  // Lấy tham số type (tùy chọn - nếu không có sẽ tự động phát hiện)
  const { licensePlate, type } = req.query;

  if (!licensePlate) {
    return res.status(400).json({ error: "License plate is required" });
  }

  try {
    // Truyền type vào hàm callAPI (null nếu không có -> tự động phát hiện)
    const vehicleType = type ? parseInt(type) : null;
    const violations = await callAPI(licensePlate, vehicleType);

    if (violations !== null) {
      res.json({ 
        licensePlate, 
        vehicleType: vehicleType || "auto-detected",
        violations 
      });
    } else {
      res.status(404).json({ error: "No violations found or unable to query" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
