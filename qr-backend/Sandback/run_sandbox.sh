#!/bin/bash

# 1. 사용할 URL 입력
TARGET_URL=$1

# 2. URL 입력 안 했을 경우 안내
if [ -z "$TARGET_URL" ]; then
  echo "❌ [에러] 검사할 URL을 입력하세요."
  echo "   예시: ./run_sandbox.sh https://naver.com"
  exit 1
fi

# 3. Flask 앱 코드 생성
cat <<EOF > sandbox_app.py
from flask import Flask, request, render_template_string
import os

app = Flask(__name__)

def is_url_safe(url: str) -> bool:
    return "phishing" not in url.lower()

@app.route("/")
def check_url():
    url = os.environ.get("TARGET_URL", None)
    if not url:
        return "URL이 없습니다.", 400

    if is_url_safe(url):
        return render_template_string("""
            <html>
                <head>
                    <meta http-equiv="refresh" content="1;url={{ target }}">
                </head>
                <body>
                    <h2>🔒 안전한 URL입니다. 잠시 후 이동합니다...</h2>
                </body>
            </html>
        """, target=url)
    else:
        return render_template_string("""
            <html>
                <body>
                    <h2>⚠️ 이 URL은 위험할 수 있어 차단되었습니다.</h2>
                </body>
            </html>
        """)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
EOF

# 4. Docker 이미지 빌드 (필요 시)
echo "📦 Docker 이미지 빌드 중..."
docker build -t qr-sandbox-image .

# 5. Docker 컨테이너 실행 (샌드박싱 실행)
echo "샌드박싱 URL: $TARGET_URL"
docker run --rm -e TARGET_URL="$TARGET_URL" -p 5050:5000 qr-sandbox-image
# 6. 결과 확인 안내
echo ""
echo "🔍 브라우저에서 http://localhost:5000 으로 접속하여 결과를 확인하세요."