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
    // Replace href="assets/images/fav.svg" with href="assets/images/logo/Screenshot 2026-08-18 011142.png"
    const originalTag = /<link rel="shortcut icon" type="image\/x-icon" href="assets\/images\/fav\.svg">/g;
    const replacement = '<link rel="shortcut icon" type="image/png" href="assets/images/logo/Screenshot 2026-08-18 011142.png">';
    
    // Also try general case without type
    const originalTag2 = /<link rel="shortcut icon" href="assets\/images\/fav\.svg">/g;
    
    content = content.replace(originalTag, replacement).replace(originalTag2, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated favicon in ${file}`);
  }
});

// Update EMS files
emsHtmls.forEach(file => {
  const filePath = path.join(emsDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalTag = /<link rel="shortcut icon" href="\.\.\/assets\/images\/fav\.svg">/g;
    const replacement = '<link rel="shortcut icon" type="image/png" href="../assets/images/logo/Screenshot 2026-08-18 011142.png">';
    
    // Also try general case with type if present
    const originalTag2 = /<link rel="shortcut icon" type="image\/x-icon" href="\.\.\/assets\/images\/fav\.svg">/g;
    
    content = content.replace(originalTag, replacement).replace(originalTag2, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated favicon in EMS_login/${file}`);
  }
});
