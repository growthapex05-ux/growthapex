// New WhatsApp attendance reports (morning + evening/daily) with full detail per employee:
// check-in/out, hours, active time, device, location (Google Maps), distance from home,
// network, late, EOD work log and the month's present / absent / leave balance.
// Month numbers use the same rules as the dashboards (../ems-payroll.js).

// The builder lives in ../ems-reports.js so the admin dashboard preview uses the same code.
const { buildAttendanceReport } = require('../ems-reports');

module.exports = { buildAttendanceReport };
