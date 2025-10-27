import React, { useState, useEffect, useRef, useMemo } from "react";
import {  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  SafeAreaView,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { CameraView, useCameraPermissions } from "expo-camera";

export default function QRInterfaceWrapper() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const isHandlingRef = useRef(false);

  // 신고 모달 상태
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [coords, setCoords] = useState<{lat: number; lng: number} | null>(null);

  const apiBaseUrl = useMemo(() => {
    // 1) app.json(expo.extra) > 2) process.env
    const fromExtra = (Constants as any)?.expoConfig?.extra?.EXPO_PUBLIC_API_URL;
    const fromEnv = process.env.EXPO_PUBLIC_API_URL;
    const fromConfig = fromExtra || fromEnv;
    if (fromConfig && /^https?:\/\//.test(fromConfig)) return String(fromConfig).replace(/\/$/, '');
    // Try to derive from Metro host (works on real device in same LAN)
    const hostUri = (Constants as any)?.expoConfig?.hostUri || (Constants as any)?.manifest?.debuggerHost;
    if (hostUri && typeof hostUri === 'string') {
      const host = hostUri.split(':')[0];
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return `http://${host}:3000`;
      }
    }
    // Fallback to localhost (emulator only)
    if (Platform.OS === 'ios') return 'http://127.0.0.1:3000';
    return 'http://10.0.2.2:3000'; // Android emulator
  }, []);

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
      console.log("📤 요청 URL:", `${apiBaseUrl}/scan`);
      console.log("📤 요청 데이터:", { url: data });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60초 타임아웃
      
      const response = await fetch(`${apiBaseUrl}/scan`, {
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
        Alert.alert(
          "✅ 안전한 링크입니다", 
          "이 QR 코드는 안전한 것으로 확인되었습니다.",
          [{ text: "확인" }]
        );
      } else if (safe === false) {
        Alert.alert(
          "⚠️ 주의! 피싱 사이트로 의심됩니다!", 
          "이 링크는 위험할 수 있습니다. 접속을 권장하지 않습니다.",
          [
            { text: "취소", style: "cancel" },
            { text: "그래도 열기", onPress: () => Linking.openURL(data) }
          ]
        );
      } else {
        Alert.alert(
          "ℹ️ 검사 결과를 확인할 수 없습니다", 
          "알 수 없는 결과입니다. 주의해서 접속하세요.",
          [{ text: "확인" }]
        );
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

  const openReport = async () => {
    // 간단 위치 정보 획득 시도 (권한 불필요한 대체: 빈 값 가능)
    try {
      if (navigator && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition((pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }, () => setCoords(null), { maximumAge: 60000, timeout: 3000 });
      }
    } catch {}
    setReportOpen(true);
  };

  const sendReport = async () => {
    if (!qrData) {
      Alert.alert('신고 불가', 'QR 데이터가 없습니다.');
      return;
    }
    try {
      setReportSending(true);
      const payload = { url: qrData, note: reportNote, location: coords };
      const res = await fetch(`${apiBaseUrl}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log('🚩 신고 완료:', json);
      Alert.alert('신고 완료', '신고가 접수되었습니다. 감사합니다.');
      setReportOpen(false);
      setReportNote("");
    } catch (e) {
      Alert.alert('신고 실패', String(e instanceof Error ? e.message : e));
    } finally {
      setReportSending(false);
    }
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
      <SafeAreaView style={[styles.container, { paddingHorizontal: 20, paddingTop: 32 }]}>
        <View style={{ alignItems: 'center' }}>
          <View style={styles.heroIconBox} />
          <Text style={styles.heroTitle}>QR 피싱 탐지기</Text>
          <Text style={styles.heroSubtitle}>QR Phishing Detector</Text>

          <Text style={styles.heroTagline}>안전한 QR 코드 스캔으로</Text>
          <Text style={[styles.heroTagline, { marginTop: 2 }]}>피싱 위험으로부터 보호하세요</Text>
          <Text style={styles.heroCaption}>알고리즘 기반 실시간 보안 검사</Text>

          <View style={{ width: '100%', marginTop: 24 }}>
            <View style={styles.infoCard}>
              <View style={styles.infoIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.infoTitle}>실시간 위험 탐지</Text>
                <Text style={styles.infoDesc}>악성 링크 경고 알림</Text>
              </View>
            </View>

            <View style={[styles.infoCard, { backgroundColor: '#eaf8f2' }]}>
              <View style={[styles.infoIcon, { backgroundColor: '#2bb673' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.infoTitle}>개인정보 보호</Text>
                <Text style={styles.infoDesc}>피싱으로부터 개인정보 보호</Text>
              </View>
            </View>
          </View>

          <View style={{ width: '100%', marginTop: 28 }}>
            <TouchableOpacity onPress={() => setShowScanner(true)} activeOpacity={0.85}>
              <View style={styles.primaryCta}>
                <Text style={styles.primaryCtaText}>스캔 시작하기</Text>
              </View>
            </TouchableOpacity>
            <Text style={styles.permissionHint}>카메라 권한이 필요합니다</Text>
          </View>
        </View>
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
        <TouchableOpacity onPress={openReport} disabled={!qrData}>
          <Text style={styles.button}>🚩 신고하기</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowScanner(false)}>
          <Text style={styles.button}>🏠 홈으로</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={reportOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🚩 신고하기</Text>
            <Text style={styles.modalLabel}>URL</Text>
            <Text style={styles.modalUrl}>{qrData}</Text>
            <Text style={styles.modalLabel}>설명(선택)</Text>
            <TextInput
              style={styles.input}
              placeholder="어디에서 보았는지, 부착 위치 등"
              value={reportNote}
              onChangeText={setReportNote}
              multiline
            />
            {reportSending ? (
              <ActivityIndicator />
            ) : (
              <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'center' }}>
                <TouchableOpacity onPress={() => setReportOpen(false)}>
                  <Text style={styles.button}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={sendReport}>
                  <Text style={styles.button}>제출</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  heroIconBox: {
    width: 160,
    height: 160,
    borderRadius: 32,
    backgroundColor: '#6f7bf7',
    marginTop: 24,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#111827',
    marginTop: 8,
  },
  heroSubtitle: {
    fontSize: 18,
    color: '#6b7280',
    marginTop: 6,
    marginBottom: 20,
  },
  heroTagline: {
    fontSize: 18,
    color: '#1f2937',
    textAlign: 'center',
  },
  heroCaption: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 10,
    marginBottom: 8,
    textAlign: 'center',
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
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#eef4ff',
    marginBottom: 12,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: '#4f46e5',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  infoDesc: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  analyzingText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  primaryCta: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#0ea5e9',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCtaText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  disabledButton: {
    backgroundColor: "#666",
    opacity: 0.5,
  },
  permissionHint: {
    textAlign: 'center',
    color: '#9ca3af',
    marginTop: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 6,
  },
  modalUrl: {
    fontSize: 14,
    color: '#111',
  },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  reportsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  reportsCard: {
    width: '90%',
    maxWidth: 500,
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
  },
  mapCard: {
    width: '90%',
    maxWidth: 560,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 15,
    alignItems: 'center',
  },
  reportItem: {
    width: '100%',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  reportUrl: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  reportMeta: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  reportNote: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
  },
});