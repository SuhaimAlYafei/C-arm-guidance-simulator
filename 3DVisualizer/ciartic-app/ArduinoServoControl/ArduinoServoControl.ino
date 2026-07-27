#include <Servo.h>
int laser = 7; // laser pointer to mimic the debugger line
Servo servoWigWag;   // pin 9
Servo servoColRot;   // pin 10

// --- Calibration (tune these) ---
const int WIG_CENTER = 90;     // neutral position for wig-wag
const int COL_CENTER = 90;     // neutral position for column rotation

// how many degrees of servo motion correspond to max simulator motion
// (start conservative; increase after testing)
const float WIG_GAIN = 1.0;    // 1.0 means 1 deg simulator => 1 deg servo
const float COL_GAIN = 1.0;

// optional safety limits (avoid hitting mechanical stops)
const int WIG_MIN = 20, WIG_MAX = 160;
const int COL_MIN = 20, COL_MAX = 160;

String line;

int clampInt(int v, int lo, int hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

void setup() {

  digitalWrite(laser, HIGH);
  Serial.begin(115200);
  servoWigWag.attach(9);
  servoColRot.attach(10);

  servoWigWag.write(WIG_CENTER);
  servoColRot.write(COL_CENTER);

  Serial.println("READY: send lines like 'W:90 C:90'");
}

void loop() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n') {
      // Parse line: "W:### C:###"
      int wPos = line.indexOf("W:");
      int cPos = line.indexOf("C:");

      if (wPos != -1 && cPos != -1) {
        int wVal = line.substring(wPos + 2).toInt();
        int cVal = line.substring(cPos + 2).toInt();

        // Apply gain around center (optional, but useful when you calibrate)
        int wServo = (int)(WIG_CENTER + (wVal - 90) * WIG_GAIN);
        int cServo = (int)(COL_CENTER + (cVal - 90) * COL_GAIN);

        wServo = clampInt(wServo, WIG_MIN, WIG_MAX);
        cServo = clampInt(cServo, COL_MIN, COL_MAX);

        servoWigWag.write(wServo);
        servoColRot.write(cServo);
      }

      line = "";
    } else if (ch != '\r') {
      line += ch;
    }
  }
}