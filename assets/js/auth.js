import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    doc,
    setDoc,
    getDoc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    getStorage,
    ref as storageRef,
    uploadBytes,
    getDownloadURL,
    listAll,
    getMetadata,
    deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBwv1vtzRLgaaJlQcEKb4e3_vjPAKx6wuU",
    authDomain: "traffic-9b19f.firebaseapp.com",
    projectId: "traffic-9b19f",
    storageBucket: "traffic-9b19f.firebasestorage.app",
    messagingSenderId: "999354084305",
    appId: "1:999354084305:web:2dca14852c1c3950404ef0",
    measurementId: "G-36S92HQZVS"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export {
    db, collection, query, where, getDocs, doc, setDoc, getDoc, deleteDoc,
    storage, storageRef, uploadBytes, getDownloadURL, listAll, getMetadata, deleteObject
};
