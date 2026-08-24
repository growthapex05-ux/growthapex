#!/bin/bash
# GrowthApex EMS - PM2 Live Server Background Service Setup

cd "$(dirname "$0")"

echo "🚀 Setting up EMS WhatsApp Automation in PM2..."

# Install PM2 if not present
if ! command -v pm2 &> /dev/null
then
    echo "📦 Installing PM2 globally..."
    npm install -g pm2
fi

# Stop existing process if running
pm2 stop ems-whatsapp 2>/dev/null || true
pm2 delete ems-whatsapp 2>/dev/null || true

# Start checkin listener in PM2
pm2 start checkin-listener.js --name "ems-whatsapp"

# Save PM2 process list
pm2 save

echo "✅ EMS WhatsApp Automation is now running 24/7 in background under PM2!"
echo "👉 Check status anytime using: pm2 status"
echo "👉 View live logs using: pm2 logs ems-whatsapp"
