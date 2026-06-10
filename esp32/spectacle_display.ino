#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>

// ── WiFi credentials ─────────────────────────────────────
const char *WIFI_SSID = "iQOO Z10R 5G";
const char *WIFI_PASSWORD = "123456789";

// ── Flask server (Cloud Deployment URL) ────────────────────
// Example for Render: "your-app.onrender.com"
const char *FLASK_HOST = "face-frame.onrender.com";
const int FLASK_PORT = 443;  // Use 443 for HTTPS, 80 for HTTP
const bool USE_HTTPS = true; // Set to true if FLASK_PORT is 443

// ── OLED configuration ───────────────────────────────────
#define SCREEN_W 128
#define SCREEN_H 64
#define OLED_RESET -1  // no reset pin
#define OLED_ADDR 0x3C // common SSD1306 I2C address

Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, OLED_RESET);

// ── Slide data ───────────────────────────────────────────
struct SlideData {
  String faceShape;
  String eyeShape;
  float pd;
  String frameSize;
  String frameStyle;
};

SlideData g_data;
bool g_dataReady = false;
int g_currentSlide = 0;

// ── Web server for receiving POST /data ──────────────────
#include <WebServer.h>
WebServer server(80);

// ── Timing ───────────────────────────────────────────────
unsigned long lastFetch = 0;
unsigned long lastSlideSwap = 0;
const unsigned long FETCH_INTERVAL = 1500UL; // 1.5 s auto-refresh (much faster)
const unsigned long SLIDE_INTERVAL = 1500UL; // 1.5 s per slide

// ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  // ── OLED init ──
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("SSD1306 init failed – check wiring");
    while (true)
      delay(1000);
  }

  showBootScreen();

  // ── WiFi ──
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print('.');
    tries++;
    showConnecting(tries);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected! IP: " + WiFi.localIP().toString());
    showIP(WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi failed – running in offline mode");
    showError("WiFi Failed");
  }

  // ── HTTP server endpoints ──
  server.on("/data", HTTP_POST, handlePostData);
  server.on("/data", HTTP_OPTIONS, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(204);
  });
  server.on("/health", HTTP_GET, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", "{\"status\":\"ok\"}");
  });
  server.begin();
  Serial.println("HTTP server started on port 80");

  delay(1500);
}

// ─────────────────────────────────────────────────────────
void loop() {
  server.handleClient();

  // ── Auto-fetch from Flask ──
  // Polls the cloud backend for the latest results
  if (WiFi.status() == WL_CONNECTED &&
      (millis() - lastFetch > FETCH_INTERVAL || lastFetch == 0)) {
    fetchLatestResults();
    lastFetch = millis();
  }

  // ── Slide rotation ──
  if (g_dataReady) {
    if (millis() - lastSlideSwap > SLIDE_INTERVAL) {
      showSlide(g_currentSlide);
      g_currentSlide = (g_currentSlide + 1) % 4;
      lastSlideSwap = millis();
    }
  } else {
    if (millis() - lastSlideSwap > 1000) {
      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(0, 28);
      display.println("Waiting for scan...");
      display.display();
      lastSlideSwap = millis();
    }
  }
}

// ─────────────────────────────────────────────────────────
//  Receive JSON POSTed by Flask /sendtoesp32
// ─────────────────────────────────────────────────────────
void handlePostData() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"no body\"}");
    return;
  }

  String body = server.arg("plain");
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);

  if (err) {
    server.send(400, "application/json", "{\"error\":\"invalid json\"}");
    return;
  }

  parseJsonToData(doc);
  server.send(200, "application/json", "{\"ok\":true}");
  Serial.println("Data received via POST /data");
}

// ─────────────────────────────────────────────────────────
//  Fetch latest scan from Flask GET /results/latest
// ─────────────────────────────────────────────────────────
void fetchLatestResults() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  String protocol = USE_HTTPS ? "https://" : "http://";
  String url = protocol + String(FLASK_HOST) + ":" + String(FLASK_PORT) +
               "/history?limit=1";

  HTTPClient http;

  if (USE_HTTPS) {
    WiFiClientSecure *client = new WiFiClientSecure;
    client->setInsecure(); // Accept any HTTPS certificate
    http.begin(*client, url);
  } else {
    http.begin(url);
  }

  http.setTimeout(2500); // Shorter timeout so it doesn't block
  int code = http.GET();

  if (code == 200) {
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      if (doc["scans"].size() > 0) {
        parseJsonToData(doc["scans"][0]);
      } else {
        g_dataReady = false; // No data in database (cleared)
      }
    }
  } else {
    Serial.printf("Flask fetch failed: %d\n", code);
  }
  http.end();
}

// ─────────────────────────────────────────────────────────
//  Parse JSON document into SlideData
// ─────────────────────────────────────────────────────────
void parseJsonToData(JsonVariantConst doc) {
  g_data.faceShape = doc["face_shape"] | "Unknown";
  g_data.eyeShape = doc["eye_shape"] | "Unknown";
  g_data.pd = doc["pd"] | 0.0f;
  g_data.frameSize = doc["frame_size"] | "—";
  g_data.frameStyle = doc["frame_style"] | "—";
  g_dataReady = true;
  g_currentSlide = 0;
  lastSlideSwap = 0; // show first slide immediately
}

// ─────────────────────────────────────────────────────────
//  Slide display functions
// ─────────────────────────────────────────────────────────
void showSlide(int idx) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  switch (idx) {
  case 0:
    slideface();
    break;
  case 1:
    slideEye();
    break;
  case 2:
    slidePD();
    break;
  case 3:
    slideFrame();
    break;
  }

  // Bottom progress dots
  int dotX = 44;
  for (int i = 0; i < 4; i++) {
    if (i == idx)
      display.fillCircle(dotX + i * 14, 60, 3, SSD1306_WHITE);
    else
      display.drawCircle(dotX + i * 14, 60, 3, SSD1306_WHITE);
  }

  display.display();
}

void slideface() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("FACE SHAPE");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(4, 18);
  display.println(g_data.faceShape.substring(0, 8));
}

void slideEye() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("EYE SHAPE");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(4, 18);
  display.println(g_data.eyeShape.substring(0, 8));
}

void slidePD() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("PD DISTANCE");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(4, 18);
  if (g_data.pd > 0) {
    display.print(g_data.pd, 1);
    display.println(" mm");
  } else {
    display.println("-- mm");
  }
}

void slideFrame() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("FRAME REC.");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  display.setCursor(0, 14);
  display.print("Size:  ");
  display.println(g_data.frameSize);
  display.setCursor(0, 26);
  display.print("Style: ");
  display.println(g_data.frameStyle.substring(0, 10));
}

// ─────────────────────────────────────────────────────────
//  Boot / status screens
// ─────────────────────────────────────────────────────────
void showBootScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(20, 10);
  display.println("** SpectAI **");
  display.setCursor(10, 26);
  display.println("AI Spectacle System");
  display.setCursor(28, 42);
  display.println("Starting...");
  display.display();
}

void showConnecting(int dots) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(10, 16);
  display.println("Connecting WiFi");
  display.setCursor(10, 32);
  String d = "";
  for (int i = 0; i < (dots % 4) + 1; i++)
    d += ".";
  display.println(d);
  display.display();
}

void showIP(String ip) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(14, 6);
  display.println("WiFi Connected!");
  display.setCursor(4, 24);
  display.print("IP: ");
  display.println(ip);
  display.setCursor(4, 42);
  display.println("Awaiting data...");
  display.display();
}

void showError(String msg) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(20, 16);
  display.println("ERROR:");
  display.setCursor(4, 32);
  display.println(msg);
  display.display();
}
