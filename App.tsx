import React, { useState, useEffect, useRef } from "react";
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
import { CameraView, useCameraPermissions } from "expo-camera";

export default function QRInterfaceWrapper() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showScanner, setShowScanner] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const isHandlingRef = useRef(false);

  // 신고 모달 상태
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [coords, setCoords] = useState<{lat: number; lng: number} | null>(null);

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
      const res = await fetch("http://192.168.10.162:3000/report", {
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
      <SafeAreaView style={styles.centered}>
        <Text style={styles.title}>🎯 QR 피싱 탐지기</Text>
        <TouchableOpacity onPress={() => setShowScanner(true)}>
          <Text style={styles.button}>📷 스캔 시작하기</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowReports(true)}>
          <Text style={styles.button}>🗺️ 숨은 피싱 장소 찾기</Text>
        </TouchableOpacity>
        {showReports && <MapScreen onClose={() => setShowReports(false)} />}
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

function MapScreen({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("http://192.168.10.162:3000/reports");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!aborted) setReports(Array.isArray(json.reports) ? json.reports : []);
      } catch (e) {
        if (!aborted) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, []);

  let MapViewComp: any = null;
  let MarkerComp: any = null;
  try {
    const maps = require('react-native-maps');
    MapViewComp = maps.default || maps.MapView;
    MarkerComp = maps.Marker;
  } catch (e) {
    return (
      <View style={styles.reportsOverlay}>
        <View style={styles.reportsCard}>
          <Text style={styles.modalTitle}>🗺️ 피싱 신고 지도</Text>
          <Text style={{ marginBottom: 12 }}>지도 모듈이 설치되지 않았습니다.</Text>
          <Text style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            설치: npm i react-native-maps
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.button}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const points = reports.filter(r => r?.location?.lat && r?.location?.lng);
  const initialRegion = points.length > 0 ? {
    latitude: Number(points[0].location.lat),
    longitude: Number(points[0].location.lng),
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  } : {
    latitude: 37.5665, // 서울 기본
    longitude: 126.9780,
    latitudeDelta: 0.3,
    longitudeDelta: 0.3,
  };

  return (
    <View style={styles.reportsOverlay}>
      <View style={styles.mapCard}>
        <Text style={styles.modalTitle}>🗺️ 피싱 신고 지도</Text>
        {loading ? (
          <View style={{ height: 400, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 10 }}>지도 로딩 중...</Text>
          </View>
        ) : error ? (
          <View style={{ height: 400, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: 'red', textAlign: 'center' }}>불러오기 실패: {error}</Text>
            <TouchableOpacity onPress={onClose} style={{ marginTop: 10 }}>
              <Text style={styles.button}>닫기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={{ width: '100%', height: 400, borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
              <MapViewComp style={{ flex: 1 }} initialRegion={initialRegion}>
                {points.map((r) => (
                  <MarkerComp
                    key={r.id}
                    coordinate={{ latitude: Number(r.location.lat), longitude: Number(r.location.lng) }}
                    title="피싱 신고"
                    description={r.note || r.url}
                    pinColor="red"
                  />
                ))}
              </MapViewComp>
            </View>
            <Text style={{ fontSize: 14, color: '#666', marginBottom: 10 }}>
              총 {points.length}개의 피싱 신고 위치
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.button}>닫기</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

function ReportsScreen({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("http://192.168.10.162:3000/reports");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!aborted) setReports(Array.isArray(json.reports) ? json.reports : []);
      } catch (e) {
        if (!aborted) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, []);

  return (
    <View style={styles.reportsOverlay}>
      <View style={styles.reportsCard}>
        <Text style={styles.modalTitle}>🗺️ 신고 목록</Text>
        {loading ? (
          <ActivityIndicator />
        ) : error ? (
          <Text style={{ color: 'red' }}>불러오기 실패: {error}</Text>
        ) : (
          <View style={{ maxHeight: 360 }}>
            {reports.length === 0 ? (
              <Text>아직 신고가 없습니다.</Text>
            ) : (
              reports.map((r) => (
                <View key={r.id} style={styles.reportItem}>
                  <Text numberOfLines={1} style={styles.reportUrl}>{r.url}</Text>
                  <Text style={styles.reportMeta}>
                    {r.location?.lat && r.location?.lng
                      ? `(${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)})`
                      : '좌표 없음'} • {new Date(r.createdAt).toLocaleString()}
                  </Text>
                  {r.note ? <Text style={styles.reportNote}>{r.note}</Text> : null}
                  {r.location?.lat && r.location?.lng ? (
                    <TouchableOpacity
                      onPress={() => {
                        const lat = Number(r.location.lat);
                        const lng = Number(r.location.lng);
                        const label = encodeURIComponent('신고 위치');
                        const google = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                        const apple = `http://maps.apple.com/?ll=${lat},${lng}&q=${label}`;
                        const url = Platform.select({ ios: apple, default: google });
                        if (url) Linking.openURL(url);
                      }}
                    >
                      <Text style={styles.button}>🧭 지도에서 열기</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            )}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.button}>닫기</Text>
          </TouchableOpacity>
          {!loading && !error && reports.some(r => r?.location?.lat && r?.location?.lng) ? (
            <TouchableOpacity onPress={() => setShowMap(true)}>
              <Text style={styles.button}>🗺️ 인앱 지도에서 보기</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {showMap && (
        <MapOverlay reports={reports} onClose={() => setShowMap(false)} />
      )}
    </View>
  );
}

function MapOverlay({ reports, onClose }: { reports: any[]; onClose: () => void }) {
  let MapViewComp: any = null;
  let MarkerComp: any = null;
  try {
    const maps = require('react-native-maps');
    MapViewComp = maps.default || maps.MapView;
    MarkerComp = maps.Marker;
  } catch (e) {
    return (
      <View style={styles.reportsOverlay}>
        <View style={styles.reportsCard}>
          <Text style={styles.modalTitle}>지도 모듈 미설치</Text>
          <Text style={{ marginBottom: 12 }}>패키지 설치 후 이용 가능합니다.</Text>
          <Text style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            설치: npm i react-native-maps
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.button}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const points = reports.filter(r => r?.location?.lat && r?.location?.lng);
  const first = points[0];
  const initialRegion = first ? {
    latitude: Number(first.location.lat),
    longitude: Number(first.location.lng),
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  } : {
    latitude: 37.5665, // 서울 기본
    longitude: 126.9780,
    latitudeDelta: 0.3,
    longitudeDelta: 0.3,
  };

  return (
    <View style={styles.reportsOverlay}>
      <View style={styles.mapCard}>
        <Text style={styles.modalTitle}>신고 지도</Text>
        <View style={{ width: '100%', height: 360, borderRadius: 10, overflow: 'hidden' }}>
          <MapViewComp style={{ flex: 1 }} initialRegion={initialRegion}>
            {points.map((r) => (
              <MarkerComp
                key={r.id}
                coordinate={{ latitude: Number(r.location.lat), longitude: Number(r.location.lng) }}
                title={r.url}
                description={r.note || new Date(r.createdAt).toLocaleString()}
              />
            ))}
          </MapViewComp>
        </View>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.button}>닫기</Text>
        </TouchableOpacity>
      </View>
    </View>
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