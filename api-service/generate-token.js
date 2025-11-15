const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const uid = 'zUBGbRycgiOhdHgFZtbDycYw1SH3'; // Your localId

admin.auth().createCustomToken(uid)
  .then(token => {
    console.log('Custom Token:', token);
    console.log('\nNow exchange it for an ID token:');
    console.log(`curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=YOUR_API_KEY" \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '{"token":"${token}","returnSecureToken":true}' | jq -r '.idToken'`);
  })
  .catch(err => console.error(err));
