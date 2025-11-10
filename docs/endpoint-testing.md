# Firebase Function Endpoint Testing

Use these notes when invoking callable and HTTP Firebase Functions from Thunder Client (or Postman).

## General Principles

- Firebase callable functions are always HTTP `POST` requests.
- Set the `Content-Type` header to `application/json`.
- The request body must be a JSON object with a top-level `data` property. All parameters are passed inside `data`.
- Authenticate requests by including the Firebase ID token when the function requires it.

## Example: `generateUploadUrl`

```
POST https://us-central1-yt-clone-385f4.cloudfunctions.net/generateUploadUrl
Content-Type: application/json
Authorization: Bearer <Firebase ID token>

{
  "data": {
    "fileExtension": "mp4"
  }
}
```

## Example: `getVideos`

```
POST https://us-central1-yt-clone-385f4.cloudfunctions.net/getVideos
Content-Type: application/json
Authorization: Bearer <Firebase ID token>

{
  "data": {}
}
```

## Tips

- In Thunder Client add the `Authorization` header manually; the value is the ID token returned by Firebase Auth sign-in.
- Save requests in a collection so you can rerun them quickly after deployments.
- Use the response pane to verify structure before wiring up frontend logic.
