import axios from "axios";

// 새 피싱 신고 발생 시 Slack/Discord으로 웹훅 발송
export async function sendWebhook(report) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("⚠️ WEBHOOK_URL이 설정되지 않았습니다.");
    return;
  }

  const message = {
    content: `🚨 **피싱 신고 발생** 🚨\n\n🔗 URL: ${report.url}\n📍 위치: ${report.location || "알 수 없음"}\n🕒 시간: ${report.detected_at}`,
  };

  try {
    await axios.post(webhookUrl, message);
    console.log(`📨 웹훅 전송 완료 → ${report.url}`);
  } catch (err) {
    console.error("❌ 웹훅 전송 실패:", err.message);
  }
}