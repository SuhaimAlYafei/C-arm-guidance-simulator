import { initializeApp } from "firebase/app";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
} from "firebase/ai";

const firebaseConfig = {
  apiKey: "AIzaSyDkPh6U50QhMRGAOP_ozexIZaSRrioyeBw",
  authDomain: "c-arm-guidance-simulator.firebaseapp.com",
  projectId: "c-arm-guidance-simulator",
  storageBucket: "c-arm-guidance-simulator.firebasestorage.app",
  messagingSenderId: "945435041006",
  appId: "1:945435041006:web:46883b24683319ffece7ff",
};

export const app = initializeApp(firebaseConfig);

if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(
    "6LcGgpctAAAAAFZjT-lFlNz1JMAKr9SB3x3PbMJE"
  ),
  isTokenAutoRefreshEnabled: true,
});

export const ai = getAI(app, {
  backend: new GoogleAIBackend(),
});

export const geminiModel = getGenerativeModel(ai, {
  model: "gemini-3.7-flash",
});