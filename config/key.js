// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBwv1vtzRLgaaJlQcEKb4e3_vjPAKx6wuU",
  authDomain: "traffic-9b19f.firebaseapp.com",
  projectId: "traffic-9b19f",
  storageBucket: "traffic-9b19f.firebasestorage.app",
  messagingSenderId: "999354084305",
  appId: "1:999354084305:web:2dca14852c1c3950404ef0",
  measurementId: "G-36S92HQZVS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);