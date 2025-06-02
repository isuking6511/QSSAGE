/*
// utils/checkUrlSafety.ts
export async function checkUrlSafety(url: string): Promise<boolean> {
    const apiKey = "AIzaSyDNqScrJdd0ZMkDyUgJLxdntdUggyjkPYQ"; 
    const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`;
  
    const body = {
      client: {
        clientId: "my-qr-app",
        clientVersion: "1.0.0",
      },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url }],
      },
    };
  
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
  
      const json = await res.json();
      return !json.matches;
    } catch (error) {
      console.error("URL 검사 실패", error);
      return true; // 오류가 발생했을 때는 일단 안전하다고 간주
    }
  }
*/