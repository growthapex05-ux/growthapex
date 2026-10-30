// Prints the foreground app / window / website every 2 s for 20 s (no Firebase, no screenshots).
const { currentActivity, siteFromTitle } = require('../src/activity');

const samples = [
  'Funny cats - YouTube - Google Chrome',
  'Inbox (3) - someone@gmail.com - Gmail - Brave',
  'GrowthApex EMS — Mozilla Firefox',
  'How to grow on Instagram | Later Blog and 4 more pages - Personal - Microsoft​ Edge',
  'New Tab - Google Chrome'
];
samples.forEach(t => console.log('title test:', JSON.stringify(t), '->', JSON.stringify(siteFromTitle(t))));

let n = 0;
const tick = async () => {
  console.log(new Date().toLocaleTimeString(), JSON.stringify(await currentActivity()));
  if (++n < 10) setTimeout(tick, 2000);
};
tick();
