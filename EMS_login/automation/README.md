# GrowthApex EMS WhatsApp Report Automation

This Node.js module automates fetching employee metrics (attendance, task completion, and leaves) from Firebase Firestore and broadcasting daily, weekly, and monthly reports to your WhatsApp Group.

## 🛠️ Setup Instructions

### 1. Install Dependencies
Make sure you have [Node.js](https://nodejs.org/) installed (v16+ recommended).
In your terminal, navigate to this automation folder and install the dependencies:
```bash
npm install
```

### 2. Add Firebase Service Account Key
You must place a Firebase Service Account JSON key inside this folder:
- Filename: `serviceAccountKey.json` (This file is protected and ignored in git to prevent security leaks).
- Note: If you already placed the file in the root and copied it, it should be in this folder now.

### 3. Configure the Environment (`.env`)
The `.env` file should have the following settings:
```env
# PROVIDER: "whatsapp-web-js" (free, scan QR code) or "green-api" (paid cloud instance)
PROVIDER=whatsapp-web-js

# Target WhatsApp Group Invite link
WA_INVITE_LINK=https://chat.whatsapp.com/CUHTYqpNen9HMYUZREoxCb
WA_GROUP_JID=
```

---

## 🚀 Running the Reports

To verify and test without sending messages to WhatsApp, use the `--dry-run` (or `-d`) flag. This queries Firestore, processes the statistics, and prints the report directly in your terminal.

### 🔍 Test Run (Dry Run / Console Output only)
```bash
# Test Daily Report
npm run test-daily

# Test Weekly Report
npm run test-weekly

# Test Monthly Report
npm run test-monthly
```

### 📲 Active Run (Sends to WhatsApp Group)
Ensure the console environment is interactive the first time you run this so that you can scan the QR code to link your WhatsApp account.
```bash
# Send Daily Report
node run.js --type=daily

# Send Weekly Report
node run.js --type=weekly

# Send Monthly Report
node run.js --type=monthly
```

#### 🔑 First-time scan (for `whatsapp-web-js` provider):
1. When you run a command without `--dry-run` for the first time, a QR code will render in your terminal.
2. Open WhatsApp on your phone -> **Linked Devices** -> **Link a Device**.
3. Scan the terminal's QR code.
4. The script will automatically link your account, use the invite link to join the group `CUHTYqpNen9HMYUZREoxCb` (if not already joined), and send the report.
5. Once authenticated, a folder named `.wwebjs_auth` will be created locally. Subsequent runs will use this session automatically without needing another scan.

---

### 📍 Real-Time Employee Check-In Listener

To send **instant WhatsApp group alerts** as soon as an employee checks in:
```bash
# Run real-time check-in listener
npm run listen-checkin
```
Whenever any employee clicks **"Mark Check-In"** on their dashboard, an instant alert formatted like this will be broadcasted to your WhatsApp Group:

```
📍 *EMPLOYEE CHECK-IN ALERT* 📍
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Employee:* Rahul Sharma
🆔 *ID:* EMP001
⏰ *Check-In Time:* 09:42:15
📅 *Date:* 2026-08-24
🚦 *Status:* ✅ On Time
━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## ⏰ Scheduling Automation (Cron Jobs)

To make these reports run fully automatically, you can schedule them:

### 🪟 On Windows (Task Scheduler)
Create a batch file named `run-reports.bat` (e.g., in your project directory):
```bat
@echo off
cd /d "C:\path\to\your\project\growthapex\EMS_login\automation"
node run.js --type=daily
```
1. Open **Task Scheduler** in Windows.
2. Click **Create Basic Task**.
3. Set the trigger (e.g., Daily at 6:00 PM).
4. For action, choose **Start a program** and browse to select your `run-reports.bat`.
5. Repeat to create separate tasks for:
   - **Weekly:** Runs on Monday mornings (`--type=weekly`).
   - **Monthly:** Runs on the 1st of every month (`--type=monthly`).

### 🐧 On Linux/Mac (Crontab)
Open your crontab manager:
```bash
crontab -e
```
Add the following entries (adjust path to your project):
```cron
# Send Daily Report every Mon-Fri at 6:00 PM
0 18 * * 1-5 cd /path/to/growthapex/EMS_login/automation && /usr/bin/node run.js --type=daily >> cron.log 2>&1

# Send Weekly Report every Monday at 9:00 AM
0 9 * * 1 cd /path/to/growthapex/EMS_login/automation && /usr/bin/node run.js --type=weekly >> cron.log 2>&1

# Send Monthly Report on the 1st of every month at 9:00 AM
0 9 1 * * cd /path/to/growthapex/EMS_login/automation && /usr/bin/node run.js --type=monthly >> cron.log 2>&1
```

### 🐙 On GitHub Actions (Serverless cloud trigger)
To run this in the cloud on a schedule using Green-API:
Create a file at `.github/workflows/ems-reports.yml` in your repository:
```yaml
name: Send Scheduled EMS Reports

on:
  schedule:
    - cron: '0 12 * * 1-5' # Daily (Mon-Fri) at 12:00 UTC (5:30 PM IST)
    - cron: '30 3 * * 1'   # Weekly (Monday) at 03:30 UTC (9:00 AM IST)
    - cron: '30 3 1 * *'   # Monthly (1st of month) at 03:30 UTC (9:00 AM IST)

jobs:
  run-report:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install Dependencies
        run: |
          cd EMS_login/automation
          npm ci

      - name: Run Script
        env:
          PROVIDER: green-api
          WA_GROUP_JID: ${{ secrets.WA_GROUP_JID }}
          GREEN_API_INSTANCE_ID: ${{ secrets.GREEN_API_INSTANCE_ID }}
          GREEN_API_TOKEN: ${{ secrets.GREEN_API_TOKEN }}
          FIREBASE_SERVICE_ACCOUNT_PATH: ./serviceAccountKey.json
        run: |
          # Write service account JSON from secret
          echo '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}' > EMS_login/automation/serviceAccountKey.json
          
          # Determine trigger type and execute
          cd EMS_login/automation
          if [[ "${{ github.event.schedule }}" == "0 12 * * 1-5" ]]; then
            node run.js --type=daily
          elif [[ "${{ github.event.schedule }}" == "30 3 * * 1" ]]; then
            node run.js --type=weekly
          else
            node run.js --type=monthly
          fi
```
*(Store `GREEN_API_INSTANCE_ID`, `GREEN_API_TOKEN`, `WA_GROUP_JID`, and the contents of `serviceAccountKey.json` under your Repository Settings -> Secrets and variables -> Actions)*
