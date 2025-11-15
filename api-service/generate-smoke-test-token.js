#!/usr/bin/env node

/**
 * Generate a Firebase ID token for smoke testing
 * Usage: node generate-smoke-test-token.js
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

if (!fs.existsSync(serviceAccountPath)) {
  console.error("❌ Error: serviceAccountKey.json not found at", serviceAccountPath);
  console.error("Please ensure Firebase service account credentials are available.");
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Use Surya's user ID from users.json
const uid = "zUBGbRycgiOhdHgFZtbDycYw1SH3";
const email = "suryaatmuri57@gmail.com";
const displayName = "Surya A";

async function generateToken() {
  try {
    console.log("\n🔧 Generating Firebase ID token for smoke test...\n");

    // Create a custom token (backend-signed)
    const customToken = await admin.auth().createCustomToken(uid);
    console.log("✅ Custom token created\n");

    // Exchange custom token for ID token using Firebase REST API
    const apiKey = "AIzaSyCBcEwMxNLyCTZ6UIb2dnjGyZfsamGfR24";
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Firebase API error: ${error.error.message}`);
    }

    const data = await response.json();
    const idToken = data.idToken;

    console.log("📋 Smoke Test Configuration");
    console.log("=".repeat(60));
    console.log(`\n✅ ID Token (valid for 1 hour):\n`);
    console.log(idToken);
    console.log("\n" + "=".repeat(60));
    console.log("\n🎯 Environment Variables for Smoke Test:\n");

    const config = {
      SMOKE_PROJECT_ID: "yt-clone-385f4",
      SMOKE_REGION: "us-central1",
      SMOKE_FUNCTIONS_URL: "https://us-central1-yt-clone-385f4.cloudfunctions.net",
      SMOKE_ID_TOKEN: idToken,
      RAW_VIDEO_BUCKET_NAME: "atmuri-yt-raw-videos",
      PROCESSED_VIDEO_BUCKET_NAME: "atmuri-yt-processed-videos",
      SMOKE_POLL_INTERVAL: "30",
      SMOKE_MAX_POLLS: "10",
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || "~/.config/gcloud/application_default_credentials.json",
    };

    // Print as exportable bash
    console.log("# Copy and paste into your terminal:\n");
    Object.entries(config).forEach(([key, value]) => {
      console.log(`export ${key}="${value}"`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("\n🚀 Quick Start:\n");
    console.log("# 1. Set environment variables (copy-paste above)");
    console.log("# 2. Create a test video (or use an existing one):");
    console.log('   ffmpeg -f lavfi -i testsrc=s=1920x1080:d=5 -pix_fmt yuv420p test-video.mp4');
    console.log("# 3. Run smoke test:");
    console.log("   cd /Users/Surya/Projects/cloudscribe-ai");
    console.log("   export SMOKE_TEST_FILE=$(pwd)/test-video.mp4");
    console.log("   ./scripts/smoke-test.sh");
    console.log("\n" + "=".repeat(60));

    // Also write to .env.local for convenience
    const envLocalPath = path.join(__dirname, ".env.local.smoke-test");
    const envContent = Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    fs.writeFileSync(envLocalPath, envContent);
    console.log(`\n📝 Configuration saved to: ${envLocalPath}`);
    console.log("   You can source this: source ${envLocalPath}\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error generating token:", error.message);
    process.exit(1);
  }
}

generateToken();
