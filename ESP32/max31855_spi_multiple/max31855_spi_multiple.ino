#include <SPI.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ================== MAX31855 ==================
const byte max31855_num = 1;
const int  max31855_cs_pins[max31855_num] = { 7 };

SPISettings max31855_spi(16000000, MSBFIRST, SPI_MODE0);

// ================== BLE UART (Nordic UART Service) ==================
// Service UUID (NUS)
static BLEUUID SERVICE_UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
// RX: phone -> ESP32 (optionnel)
static BLEUUID RX_CHAR_UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E");
// TX: ESP32 -> phone
static BLEUUID TX_CHAR_UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E");

BLECharacteristic* txChar = nullptr;
bool deviceConnected = false;

// Test/emulation mode: set in setup() to emit synthetic motor values
bool testMode = false;

// helper for test emulation
void generateTestValues(float* rpm, float* egt, float* oil_pres, float* oil_temp, float* boost, float* afr, uint32_t t_ms) {
  float t = t_ms / 1000.0f;
  *rpm = 800.0f + 2200.0f * (0.5f + 0.5f * sinf(t * 0.8f));
  *egt = 700.0f + 200.0f * sinf(t * 0.4f) + (random(-50, 50) / 100.0f);
  *oil_pres = 3.0f + 1.5f * sinf(t * 0.7f + 1.2f) + (random(-20, 20) / 100.0f);
  *oil_temp = 90.0f + 12.0f * sinf(t * 0.25f + 0.5f) + (random(-30, 30) / 100.0f);
  *boost = 0.5f + 0.9f * sinf(t * 1.1f + 2.0f) + (random(-30, 30) / 100.0f);
  *afr = 14.7f + 1.2f * sinf(t * 0.6f + 0.8f) + (random(-20, 20) / 100.0f);
}

// ===== Handshake (HELLO) =====
// Décris le "schéma" des colonnes envoyées ensuite.
// Ici: t_ms, egt, oil_pres, oil_temp, boost, afr
// HELLO: describe fields in order: RPM, EGT, oil_pres, oil_temp, boost, afr
static const char* HELLO_LINE =
  "HELLO {\"fields\":["
  "{\"RPM\",\"RPM\",\"\"},"
  "{\"boost\",\"Boost\",\"b\"},"
  "{\"afr\",\"AFR\",\"AFR\"},"
  "{\"egt\",\"EGT\",\"°C\"},"
  "{\"oil_pres\",\"Pression huile\",\"b\"},"
  "{\"oil_temp\",\"Temp huile\",\"°C\"},"
  "]}\n";

// Flag: envoyer HELLO une fois à la prochaine loop après connexion
volatile bool sendHelloPending = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    sendHelloPending = true; // on déclenche le handshake
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    sendHelloPending = true;
    delay(200);
    BLEDevice::startAdvertising();
  }
};

static void bleSendLine(const String& line) {
  if (!deviceConnected || txChar == nullptr) return;
  const int chunkSize = 200;
  for (int i = 0; i < (int)line.length(); i += chunkSize) {
    String chunk = line.substring(i, i + chunkSize);
    txChar->setValue((uint8_t*)chunk.c_str(), chunk.length());
    txChar->notify();
    delay(5);
  }
}

void setup() {
  // CS pins
  for (int i = 0; i < max31855_num; i++) {
    pinMode(max31855_cs_pins[i], OUTPUT);
    digitalWrite(max31855_cs_pins[i], HIGH);
  }

  SPI.begin();

  Serial.begin(115200);
  Serial.println("Boot - BLE UART + MAX31855 + HELLO handshake");

  // Seed RNG for test jitter
  randomSeed(analogRead(0));

  // Toggle test mode here: set to true to emulate values
  testMode = true; // emulation enabled

  // BLE init
  BLEDevice::init("ESP32C3-MAX31855");
  BLEDevice::setMTU(247);

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  txChar = service->createCharacteristic(
    TX_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  txChar->addDescriptor(new BLE2902());

  service->createCharacteristic(
    RX_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  advertising->start();

  Serial.println("BLE advertising started");
}

// ===== Scheduler live =====
const uint32_t PERIOD_MS = 100; // 10 Hz
static uint32_t last = 0;

void loop() {
  // Envoi du handshake après connexion (une seule fois)
  if (deviceConnected && sendHelloPending) {
    sendHelloPending = false;
    delay(1000);
    bleSendLine(String(HELLO_LINE));
    delay(1000);
    bleSendLine(String(HELLO_LINE));
    delay(1000);
    bleSendLine(String(HELLO_LINE));
    Serial.print(HELLO_LINE);
  }

  if (millis() - last < PERIOD_MS) return;
  last += PERIOD_MS;

  uint32_t t = millis();

    if (testMode) {
    float rpm, egt, oil_pres, oil_temp, boost, afr;
    generateTestValues(&rpm, &egt, &oil_pres, &oil_temp, &boost, &afr, t);

    String line;
    line.reserve(128);
    line += "DATA ";
    line += String(t);
    line += ",";
    line += String(rpm, 0);
    line += ",";
    line += String(boost, 2);
    line += ",";
    line += String(afr, 2);
    line += ",";
    line += String(egt, 2);
    line += ",";
    line += String(oil_temp, 1);
    line += ",";
    line += String(oil_pres, 2);
    line += "\n";

    bleSendLine(line);
    Serial.print(line);
  } else {
    float thermocouple_temperature = NAN;
    float internal_temperature = NAN;
    byte  fault_bits = 0;

    for (int i = 0; i < max31855_num; i++) {
      max31855Read(max31855_cs_pins[i],
                   &thermocouple_temperature,
                   &internal_temperature,
                   &fault_bits);

      String line;
      line.reserve(96);
      line += "DATA ";
      line += String(t);
      line += ",";
      // No RPM sensor in this path: send 0 as placeholder
      line += String(0);
      line += ",";
      line += String(thermocouple_temperature, 2);
      line += ",0,0,0,0"; // keep placeholders for other values
      line += "\n";

      bleSendLine(line);
      Serial.print(line);
    }
  }
}

void max31855Read(int    max31855_cs_pin,
                  float* thermocouple_temperature,
                  float* internal_temperature,
                  byte*  fault_bits)
{
  unsigned int data_0;
  unsigned int data_1;

  digitalWrite(max31855_cs_pin, LOW);
  SPI.beginTransaction(max31855_spi);

  data_0 = SPI.transfer16(0);
  data_1 = SPI.transfer16(0);

  SPI.endTransaction();
  digitalWrite(max31855_cs_pin, HIGH);

  *fault_bits               =   (data_1 & 0B0000000000000111)
                            | (((data_0 & 0B0000000000000001) << 3));

  *internal_temperature     = ((data_1 & 0B0111111111110000) >> 4) * 0.0625;
  if (data_1 & 0B1000000000000000) *internal_temperature += -128;

  *thermocouple_temperature = ((data_0 & 0B0111111111111100) >> 2) * 0.25;
  if (data_0 & 0B1000000000000000) *thermocouple_temperature += -2048;

  // Ici on ignore fault_bits, on garde la température calculée
}