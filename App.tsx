import React, { useState, useEffect } from "react";
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

  useEffect(() => {
    requestPermission();
  }, []);

  const handleBarcodeScanned = async (data: string) => {
    console.log("🔍 QR 코드 인식됨:", data);
    setScanned(true);
    setQrData(data);

    try {
      console.log("🌐 백엔드 URL 검사 요청 시작...");
      const response = await fetch("http://10.96.216.121:3000/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: data }),
      });

      const result = await response.json();
      console.log("✅ 검사 결과:", result);

      if (result.safe) {
        Alert.alert("🟢 안전한 링크입니다", result.reason || data);
      } else {
        Alert.alert("🚨 피싱 위험이 있는 링크입니다!", result.reason || data);
      }
    } catch (error) {
      console.error("❌ 오류 발생:", error);
      Alert.alert("❌ 오류", "서버 연결 실패 또는 분석 중 에러");
    }
  };

  const handleResetScanner = () => {
    setScanned(false);
    setQrData(null);
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
        <TouchableOpacity onPress={handleResetScanner}>
          <Text style={styles.button}>🔁 다시 스캔</Text>
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
});