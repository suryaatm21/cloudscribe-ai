/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {Firestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import {Storage} from "@google-cloud/storage";
import {onCall, onRequest} from "firebase-functions/v2/https";
import cors from "cors";

initializeApp();

const firestore = new Firestore();
const adminAuth = getAuth();

const videoCollectionId = "videos";
export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

export const createUser = functions.auth.user().onCreate((user) => {
  const userInfo = {
    uid: user.uid,
    email: user.email,
    photoUrl: user.photoURL,
  };

  firestore.collection("users").doc(user.uid).set(userInfo);
  logger.info(`User Created: ${JSON.stringify(userInfo)}`);
  return;
});

const storage = new Storage();
const rawVideoBucketName = "atmuri-yt-raw-videos";

// Set up CORS middleware with appropriate options
const corsHandler = cors({
  origin: true, // Reflects the request origin
  methods: ["GET", "POST"],
  credentials: true,
  maxAge: 3600,
});

// Keep the callable function for direct Firebase SDK use
export const generateUploadUrl = onCall(
  {maxInstances: 1},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The function must be called while authenticated.",
      );
    }
    const auth = request.auth;
    const data = request.data;
    const bucket = storage.bucket(rawVideoBucketName);

    const fileName = `${auth.uid}-${Date.now()}.${data.fileExtension}`;
    const [url] = await bucket.file(fileName).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return {url, fileName};
  },
);

// Add an HTTP endpoint for REST API access
export const getUploadUrl = onRequest(
  {maxInstances: 1},
  (request, response) => {
    // Apply CORS middleware
    corsHandler(request, response, async () => {
      try {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          response.status(401).send({error: "Missing bearer token"});
          return;
        }

        const idToken = authHeader.split("Bearer ")[1];
        let decodedToken;
        try {
          decodedToken = await adminAuth.verifyIdToken(idToken);
        } catch (verifyError) {
          logger.error("Invalid ID token for upload URL request", verifyError);
          response.status(401).send({error: "Invalid token"});
          return;
        }

        const fileExtension =
          (request.query.extension as string) ||
          request.body?.fileExtension ||
          "mp4";

        const fileName = `${decodedToken.uid}-${Date.now()}.${fileExtension}`;
        const bucket = storage.bucket(rawVideoBucketName);

        const [url] = await bucket.file(fileName).getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

        response.status(200).send({url, fileName});
      } catch (error) {
        console.error("Error generating upload URL:", error);
        response.status(500).send({error: "Failed to generate upload URL"});
      }
    });
  },
);

// TODO fix: naive endpoint to getVideos because no pagination / hardcoded
// limit, and not checking if there are even videos
export const getVideos = onCall({maxInstances: 1}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The function must be called while authenticated.",
    );
  }
  const querySnapshot = await firestore
    .collection(videoCollectionId)
    .limit(10)
    .get();
  return querySnapshot.docs.map((doc) => doc.data());
});
