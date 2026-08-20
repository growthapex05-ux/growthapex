const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const emsDir = path.join(rootDir, 'EMS_login');

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
  'work.html',
  'blog-local-seo.html',
  'blog-keyword-research.html',
  'blog-core-web-vitals.html',
  'blog-double-marketing-roi.html',
  'blog-branding-strategies.html',
  'blog-social-media-leads.html',
  'blog-b2b-lead-generation.html',
  'blog-visual-graphic-design.html',
  'blog-cro-web-design.html',
  'blog-content-marketing.html'
];

const emsHtmls = [
  'admin-dashboard.html',
  'employee-dashboard.html',
  'index.html'
];

// 1. Process root HTML files
rootHtmls.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace href="page.html" with href="page"
    // Regex: match href="something.html" where "something" is alphanumeric, dash, or underscore
    content = content.replace(/href="([a-zA-Z0-9_-]+)\.html"/g, 'href="$1"');
    
    // Replace action="page.html" with action="page" (if any forms exist)
    content = content.replace(/action="([a-zA-Z0-9_-]+)\.html"/g, 'action="$1"');

    // Also replace absolute EMS_login paths like /EMS_login/index.html to /EMS_login/
    content = content.replace(/\/EMS_login\/index\.html/g, '/EMS_login/');
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Removed .html extensions from links in ${file}`);
  }
});

// 2. Process EMS HTML files
emsHtmls.forEach(file => {
  const filePath = path.join(emsDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace href="page.html" with href="page"
    content = content.replace(/href="([a-zA-Z0-9_-]+)\.html"/g, 'href="$1"');
    
    // Also replace window.location.href redirections in JS scripts
    content = content.replace(/window\.location\.href\s*=\s*'index\.html'/g, "window.location.href = '/EMS_login/'");
    content = content.replace(/window\.location\.href\s*=\s*'([a-zA-Z0-9_-]+)\.html'/g, "window.location.href = '$1'");
    content = content.replace(/window\.location\.href\s*=\s*'\/EMS_login\/index\.html'/g, "window.location.href = '/EMS_login/'");
    content = content.replace(/window\.location\.href\s*=\s*'\/EMS_login\/([a-zA-Z0-9_-]+)\.html'/g, "window.location.href = '/EMS_login/$1'");

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Removed .html extensions from links/redirections in EMS_login/${file}`);
  }
});
