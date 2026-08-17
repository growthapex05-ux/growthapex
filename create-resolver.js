const admin = require('firebase-admin');

// We don't have the service account key file locally, but we can register the user using the Web API:
const fetch = require('node-fetch');

async function createResolverUser() {
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyAA84W6KghuGz8C3usn26igTGv_WAOCP34';
  const body = JSON.stringify({
    email: 'ems-system-resolver@growthapex.com',
    password: 'SystemResolverPassword123!',
    returnSecureToken: true
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });
    const data = await res.json();
    if (data.error) {
      console.log('User creation status:', data.error.message);
    } else {
      console.log('✅ Successfully created ems-system-resolver account!');
    }
  } catch (err) {
    console.error('Error creating user:', err);
  }
}

createResolverUser();
