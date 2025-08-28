// Shippo client initializer (SDK v2.x)
import dotenv from "dotenv";
dotenv.config();

import { Shippo } from "shippo";

const apiKey = process.env.SHIPPO_API_KEY;
if (!apiKey) {
  console.warn("⚠️ SHIPPO_API_KEY is not set. Shippo requests will return 401 until configured.");
}

// Per Shippo v2 SDK, pass an options object with apiKeyHeader
let shippoClient;
try {
  shippoClient = new Shippo({
    apiKeyHeader: apiKey || "",
    // shippoApiVersion: "2018-02-08", // optional
  });
} catch (err) {
  console.error("❌ Failed to construct Shippo client:", err);
}

export { shippoClient };