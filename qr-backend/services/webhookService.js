import "dotenv/config";
import axios from "axios";

export async function sendWebhook(report) {
  console.log("📡 sendWebhook() 실행됨:", report.url);

  const url = process.env.WEBHOOK_URL;
  if (!url) {
    console.error("❌ WEBHOOK_URL이 설정되지 않음");
    return;
  }

  try {
    const res = await axios.post(url, {
      content: `🚨 **피싱 신고 발생** 🚨\n🔗 URL: ${report.url}\n📍 위치: ${report.location || "미상"}\n🕒 시간: ${report.detected_at}`,
    });
    console.log("✅ Webhook 전송 완료:", res.status);
  } catch (err) {
    console.error("❌ Webhook 전송 실패:", err.message);
    console.error("응답:", err.response?.data);
  }
}
