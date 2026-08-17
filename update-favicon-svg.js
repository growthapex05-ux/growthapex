const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const emsDir = path.join(rootDir, 'EMS_login');

// Root HTML files
const rootHtmls = [
  '404.html',
  'about.html',
  'blog-single.html',
  'blog-standard.html',
  'blog-three-columns.html',
  'blog-two-columns.html',
  'consultancy.html',
  'contact.html',
  'index.html',
  'service-details.html',
  'service.html',
  'work-details.html',
  'work.html'
];

// EMS HTML files
const emsHtmls = [
  'admin-dashboard.html',
  'employee-dashboard.html',
  'index.html'
];

// Update root files
rootHtmls.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    // Replace any existing shortcut icon tag containing logo/Screenshot... or images/fav.svg
    const originalTagRegex = /<link rel="shortcut icon"[^>]+href="assets\/images\/[^"]+">/g;
    const replacement = '<link rel="shortcut icon" type="image/svg+xml" href="assets/images/logo/favicon.svg">';
    
    content = content.replace(originalTagRegex, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated favicon in ${file}`);
  }
});

// Update EMS files
emsHtmls.forEach(file => {
  const filePath = path.join(emsDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalTagRegex = /<link rel="shortcut icon"[^>]+href="\.\.\/assets\/images\/[^"]+">/g;
    const replacement = '<link rel="shortcut icon" type="image/svg+xml" href="../assets/images/logo/favicon.svg">';
    
    content = content.replace(originalTagRegex, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated favicon in EMS_login/${file}`);
  }
});
