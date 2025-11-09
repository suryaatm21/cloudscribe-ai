// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCBcEwMxNLyCTZ6UIb2dnjGyZfsamGfR24",
  authDomain: "yt-clone-385f4.firebaseapp.com",
  projectId: "yt-clone-385f4",
  appId: "1:262816123746:web:963716b0add6e31732ba3b",
  measurementId: "G-2KH3XNC4VJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const auth = getAuth();

export function signInWithGoogle(){
    return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signOut(){
    return auth.signOut();
}


export function onAuthStateChangedHelper(callback: (user: User | null) => void){
    return onAuthStateChanged(auth, callback);
}
