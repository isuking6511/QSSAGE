import React, { useState, useEffect, useRef } from "react";
import {  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  SafeAreaView,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

export default function QRInterfaceWrapper() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const isHandlingRef = useRef(false);

  useEffect(() => {
    requestPermission();
  }, []);

  const handleBarcodeScanned = async (data: string) => {
    if (isHandlingRef.current) return; // 재진입 방지
    isHandlingRef.current = true;

    console.log("🔍 QR 코드 인식됨:", data);
    setScanned(true);
    setQrData(data);
    setIsAnalyzing(true);

    try {
      console.log("🌐 백엔드 URL 검사 요청 시작...");
      console.log("📤 요청 URL:", "http://192.168.10.162:3000/scan");
      console.log("📤 요청 데이터:", { url: data });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60초 타임아웃
      
      const response = await fetch("http://192.168.10.162:3000/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: data }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      console.log("📥 응답 상태:", response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("✅ 검사 결과:", result);
      const safe = (result as any).safe ?? (typeof (result as any).risk === 'string' ? (result as any).risk.includes('✅') : undefined);
      const reason = (result as any).reason ?? (
        typeof (result as any).risk === 'string'
          ? (result as any).risk + (
              Array.isArray((result as any).reasons) && (result as any).reasons.length
                ? ' - ' + (result as any).reasons.join(', ')
                : ''
            )
          : undefined
      );
      console.log("🔍 safe(derived) 값:", safe);
      console.log("🔍 reason(derived) 값:", reason);

      if (safe) {
        Alert.alert("🟢 안전한 링크입니다", reason || data);
      } else if (safe === false) {
        Alert.alert("🚨 피싱 위험이 있는 링크입니다!", reason || data);
      } else {
        Alert.alert("ℹ️ 결과 확인 필요", reason || data);
      }
    } catch (error) {
      console.error("❌ 오류 발생:", error);
      const message = error instanceof Error ? error.message : String(error);
      console.error("❌ 오류 상세:", message);
      Alert.alert("❌ 오류", `서버 연결 실패 또는 분석 중 에러: ${message}`);
    } finally {
      setIsAnalyzing(false);
      // 1) 스캐너 잠시 비활성화 후 재활성화 (중복 호출 방지)
      setTimeout(() => {
        isHandlingRef.current = false;
      }, 800); // 0.8초 디바운스
    }
  };

  const handleResetScanner = () => {
    setScanned(false);
    setQrData(null);
    setIsAnalyzing(false);
    isHandlingRef.current = false;
  };

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text>📷 카메라 권한이 필요합니다.</Text>
        <TouchableOpacity onPress={requestPermission}>
          <Text style={styles.button}>권한 요청</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!showScanner) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.title}>🎯 QR 피싱 탐지기</Text>
        <TouchableOpacity onPress={() => setShowScanner(true)}>
          <Text style={styles.button}>📷 스캔 시작하기</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <CameraView
        style={styles.camera}
        onBarcodeScanned={({ data }) =>
          scanned ? undefined : handleBarcodeScanned(data)
        }
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      >
        <View style={styles.overlay}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
      </CameraView>

      <View style={styles.bottomControls}>
        {isAnalyzing && (
          <Text style={styles.analyzingText}>🔍 URL 분석 중...</Text>
        )}
        <TouchableOpacity onPress={handleResetScanner} disabled={isAnalyzing}>
          <Text style={[styles.button, isAnalyzing && styles.disabledButton]}>
            🔁 다시 스캔
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Alert.alert("QR 데이터", qrData ?? "없음")}>
          <Text style={styles.button}>📤 결과 보기</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowScanner(false)}>
          <Text style={styles.button}>🏠 홈으로</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  camera: {
    width: "100%",
    height: "80%",
  },
  overlay: {
    position: "absolute",
    top: "40%",
    left: "50%",
    width: "80%",
    height: "50%",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: "-40%",
    marginTop: "-30%",
    backgroundColor: "transparent",
  },
  corner: {
    width: 40,
    height: 40,
    borderColor: "white",
    position: "absolute",
  },
  topLeft: {
    borderTopWidth: 5,
    borderLeftWidth: 5,
    top: 0,
    left: 0,
  },
  topRight: {
    borderTopWidth: 5,
    borderRightWidth: 5,
    top: 0,
    right: 0,
  },
  bottomLeft: {
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    bottom: 0,
    left: 0,
  },
  bottomRight: {
    borderBottomWidth: 5,
    borderRightWidth: 5,
    bottom: 0,
    right: 0,
  },
  bottomControls: {
    alignItems: "center",
    padding: 16,
  },
  button: {
    backgroundColor: "#333",
    color: "#fff",
    padding: 10,
    borderRadius: 6,
    fontSize: 16,
    textAlign: "center",
    marginVertical: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  analyzingText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  disabledButton: {
    backgroundColor: "#666",
    opacity: 0.5,
  },
});