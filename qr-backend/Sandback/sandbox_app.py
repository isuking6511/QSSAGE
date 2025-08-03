from flask import Flask, request, render_template_string
import os
import requests

app = Flask(__name__)

def is_url_safe(url: str) -> bool:
    try:
        print(f"[샌드박스] URL 접속 시도 중: {url}")
        response = requests.get(url, timeout=3)
        print(f"[샌드박스] 응답 코드: {response.status_code}")
    except Exception as e:
        print(f"[샌드박스] 접속 실패: {e}")
        return False

    # 간단한 필터 (여기선 "phishing"이 안 들어있고 응답 코드가 200이면 안전하다고 가정)
    return "phishing" not in url.lower() and response.status_code == 200

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
                    <h2> 안전한 URL. 리다이렉트 중...</h2>
                </body>
            </html>
        """, target=url)
    else:
        return render_template_string("""
            <html>
                <body>
                    <h2> ! 위험한 URL.</h2>
                </body>
            </html>
        """)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)