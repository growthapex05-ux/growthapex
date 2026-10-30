// Deletes Tracker screenshots older than SCREENSHOT_KEEP_DAYS (default 7) so the free Firestore
// storage (1 GB) does not fill up. Run once a day by the listener.
const KEEP_DAYS = parseInt(process.env.SCREENSHOT_KEEP_DAYS, 10) || 7;

async function deleteOldScreenshots(db) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  let deleted = 0;
  for (;;) {
    const snap = await db.collection('screenshots').where('date', '<', cutoff).limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 200) break;
  }
  if (deleted) console.log(`🧹 Deleted ${deleted} screenshot(s) older than ${cutoff}`);
  return deleted;
}

module.exports = { deleteOldScreenshots };
