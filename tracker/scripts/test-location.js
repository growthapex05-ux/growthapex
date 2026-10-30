// Prints this laptop's location as the tracker sees it: npx electron scripts/test-location.js
const { app } = require('electron');
const { allowGeolocation, getLocation } = require('../src/location');
app.commandLine.appendSwitch('enable-features', 'WinrtGeolocationImplementation');
app.whenReady().then(async () => {
  allowGeolocation();
  console.log(JSON.stringify(await getLocation(), null, 2));
  app.exit(0);
});
