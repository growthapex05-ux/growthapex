/* ============================================================
   GrowthApex Dynamic AI Chatbot & WhatsApp Integration Engine
   ============================================================ */

(function() {
  // Inject Chatbot HTML and Styles dynamically into the document
  const css = `
    .ga-chatbot-btn {
      position: fixed;
      bottom: 25px;
      right: 25px;
      width: 62px;
      height: 62px;
      border-radius: 50%;
      background: linear-gradient(135deg, #00D4FF, #002b80);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      cursor: pointer;
      z-index: 9999;
      box-shadow: 0 8px 25px rgba(0, 212, 255, 0.45);
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      border: 2px solid rgba(255, 255, 255, 0.3);
    }
    .ga-chatbot-btn:hover {
      transform: scale(1.1) rotate(6deg);
      box-shadow: 0 12px 30px rgba(0, 212, 255, 0.65);
    }
    .ga-chatbot-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 20px;
      height: 20px;
      background: #16a34a;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #fff;
      animation: pulseGreen 2s infinite;
    }
    @keyframes pulseGreen {
      0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(22, 163, 74, 0); }
      100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
    }

    .ga-chatbot-window {
      position: fixed;
      bottom: 95px;
      right: 25px;
      width: 380px;
      max-width: calc(100vw - 30px);
      height: 520px;
      max-height: calc(100vh - 120px);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 9999;
      font-family: 'Urbanist', -apple-system, BlinkMacSystemFont, sans-serif;
      border: 1px solid rgba(0, 212, 255, 0.3);
      animation: slideUpChat 0.3s ease-out;
    }
    .ga-chatbot-window.open {
      display: flex;
    }
    @keyframes slideUpChat {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ga-chat-header {
      background: linear-gradient(135deg, #0f172a, #002b80);
      color: #ffffff;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #00D4FF;
    }
    .ga-chat-header-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .ga-chat-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #00D4FF;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: bold;
    }
    .ga-chat-title {
      font-size: 15px;
      font-weight: 700;
      margin: 0;
      color: #fff;
    }
    .ga-chat-status {
      font-size: 11px;
      color: #86efac;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ga-chat-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
    }
    .ga-chat-close:hover { color: #ffffff; }

    .ga-chat-body {
      flex: 1;
      padding: 14px;
      overflow-y: auto;
      background: #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .ga-msg {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .ga-msg.bot {
      background: #ffffff;
      color: #1e293b;
      align-self: flex-start;
      border-bottom-left-radius: 2px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
    }
    .ga-msg.user {
      background: #0284c7;
      color: #ffffff;
      align-self: flex-end;
      border-bottom-right-radius: 2px;
    }

    .ga-quick-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .ga-chip {
      background: #e0f2fe;
      color: #0284c7;
      font-size: 11.5px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 14px;
      cursor: pointer;
      border: 1px solid #bae6fd;
      transition: all 0.2s;
    }
    .ga-chip:hover {
      background: #0284c7;
      color: #ffffff;
    }

    .ga-wa-btn-inline {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #25D366;
      color: #ffffff !important;
      font-weight: 700;
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 20px;
      text-decoration: none !important;
      margin-top: 8px;
      box-shadow: 0 4px 12px rgba(37, 211, 102, 0.35);
      transition: transform 0.2s;
    }
    .ga-wa-btn-inline:hover {
      transform: scale(1.04);
      background: #1eb954;
    }

    .ga-chat-footer {
      padding: 10px;
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ga-chat-input {
      flex: 1;
      border: 1px solid #cbd5e1;
      border-radius: 20px;
      padding: 8px 14px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    .ga-chat-input:focus {
      border-color: #0284c7;
    }
    .ga-chat-send {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #0284c7;
      color: #ffffff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 14px;
    }
    .ga-chat-send:hover { background: #0369a1; }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // Widget HTML
  const widgetHtml = `
    <div class="ga-chatbot-btn" id="gaChatBtn" title="Chat with GrowthApex AI">
      🤖
      <div class="ga-chatbot-badge">1</div>
    </div>

    <div class="ga-chatbot-window" id="gaChatWindow">
      <div class="ga-chat-header">
        <div class="ga-chat-header-info">
          <div class="ga-chat-avatar">🤖</div>
          <div>
            <h4 class="ga-chat-title">GrowthApex AI Assistant</h4>
            <div class="ga-chat-status">● Active 24/7 • WhatsApp Connected</div>
          </div>
        </div>
        <button class="ga-chat-close" id="gaChatClose">✕</button>
      </div>

      <div class="ga-chat-body" id="gaChatBody">
        <div class="ga-msg bot">
          👋 Hello! Welcome to <b>GrowthApex Digital Media</b>. I am your AI growth assistant.<br><br>
          How can I help scale your business today? Choose a topic or type your query below:
          <div class="ga-quick-chips">
            <span class="ga-chip" onclick="gaSendQuick('Digital Marketing Services')">🚀 Digital Marketing</span>
            <span class="ga-chip" onclick="gaSendQuick('Web & App Development')">💻 Web & App Dev</span>
            <span class="ga-chip" onclick="gaSendQuick('SEO & Brand Strategy')">📈 SEO & Branding</span>
            <span class="ga-chip" onclick="gaSendQuick('Pricing & Quotation')">💰 Pricing & Packages</span>
            <span class="ga-chip" onclick="gaSendQuick('Contact WhatsApp Support')">📱 Connect on WhatsApp</span>
          </div>
        </div>
      </div>

      <div class="ga-chat-footer">
        <input type="text" class="ga-chat-input" id="gaChatInput" placeholder="Ask anything about our services..." onkeypress="if(event.key==='Enter') gaSendMessage()">
        <button class="ga-chat-send" onclick="gaSendMessage()" title="Send">✈️</button>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = widgetHtml;
  document.body.appendChild(div);

  // Event Listeners
  const btn = document.getElementById('gaChatBtn');
  const windowEl = document.getElementById('gaChatWindow');
  const closeBtn = document.getElementById('gaChatClose');

  if (btn && windowEl) {
    btn.addEventListener('click', () => {
      windowEl.classList.toggle('open');
      const badge = btn.querySelector('.ga-chatbot-badge');
      if (badge) badge.style.display = 'none';
    });
  }

  if (closeBtn && windowEl) {
    closeBtn.addEventListener('click', () => {
      windowEl.classList.remove('open');
    });
  }

  // AI Knowledge Base
  window.gaKnowledge = [
    {
      keys: ['hello', 'hi', 'hey', 'namaste', 'start'],
      answer: "Hello! Welcome to GrowthApex Digital Media. We specialize in Performance Marketing, Web Development, SEO, and Brand Scaling. What service are you looking for?"
    },
    {
      keys: ['marketing', 'digital marketing', 'ads', 'facebook', 'google ads', 'meta', 'instagram', 'leads'],
      answer: "🚀 Our Performance Marketing Services drive high-ROI lead generation & sales scaling via Meta Ads, Google Ads, & Brand Management. Would you like to get a custom campaign plan?"
    },
    {
      keys: ['web', 'website', 'app', 'development', 'design', 'software', 'ui', 'ux'],
      answer: "💻 We build high-converting, lightning-fast custom websites, E-commerce platforms, and Web Applications designed to convert visitors into loyal clients."
    },
    {
      keys: ['seo', 'google ranking', 'traffic', 'organic', 'search'],
      answer: "📈 Our Rank-#1 SEO strategies drive organic Google search traffic and position your brand as an industry leader in your niche."
    },
    {
      keys: ['pricing', 'price', 'cost', 'package', 'quote', 'charges', 'budget'],
      answer: "💰 Our packages are customized to match your growth goals. Click below to connect directly with our Growth Strategist on WhatsApp for an instant quote!"
    },
    {
      keys: ['contact', 'phone', 'number', 'address', 'office', 'email', 'location', 'gurugram', 'gurgaon'],
      answer: "📍 <b>GrowthApex Digital Media</b><br>HQ: F26, Fazilpur Jharsa, Sector 72, Gurugram, Haryana 122101<br>📞 Phone: +91 92176 48531 / +91 93112 18889<br>📧 Email: support@growthapex.in"
    },
    {
      keys: ['ems', 'login', 'portal', 'employee', 'admin', 'salary'],
      answer: "🔑 You can access the GrowthApex EMS Management Portal at <a href='/EMS_login/' target='_blank' style='color:#0284c7;font-weight:700'>growthapex.in/EMS_login/</a>."
    }
  ];

  window.gaSendMessage = function() {
    const input = document.getElementById('gaChatInput');
    const text = input.value.trim();
    if (!text) return;

    // Render User Message
    gaAppendMsg(text, 'user');
    input.value = '';

    // Process Bot Response
    setTimeout(() => {
      const lower = text.toLowerCase();
      let match = gaKnowledge.find(k => k.keys.some(key => lower.includes(key)));

      let responseText = match 
        ? match.answer 
        : "Thank you for your query! I can connect you directly with our Senior Growth Consultant on WhatsApp for instant assistance.";

      const waMsg = `Hi GrowthApex Team, I have an inquiry from website chatbot: "${text}"`;
      const waUrl = `https://api.whatsapp.com/send?phone=919217648531&text=${encodeURIComponent(waMsg)}`;
      
      const fullResponse = `${responseText}<br><a href="${waUrl}" target="_blank" class="ga-wa-btn-inline">📱 Connect on WhatsApp Instant</a>`;

      gaAppendMsg(fullResponse, 'bot');
    }, 450);
  };

  window.gaSendQuick = function(topic) {
    document.getElementById('gaChatInput').value = topic;
    gaSendMessage();
  };

  function gaAppendMsg(msgHtml, sender) {
    const body = document.getElementById('gaChatBody');
    if (!body) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `ga-msg ${sender}`;
    msgDiv.innerHTML = msgHtml;
    body.appendChild(msgDiv);
    body.scrollTop = body.scrollHeight;
  }

})();
