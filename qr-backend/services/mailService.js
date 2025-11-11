import nodemailer from "nodemailer";

export async function sendMail({ to, subject, text, attachments = [] }) {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASS) {
    throw new Error("메일 계정 환경변수가 설정되지 않았습니다.");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.ADMIN_EMAIL,
      pass: process.env.ADMIN_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: process.env.ADMIN_EMAIL,
    to,
    subject,
    text,
    attachments,
  });

  console.log(`📨 메일 전송 완료 → ${to}`);
  return info;
}