WebP CDN Source Maker Online Version

Upload this folder to Vercel as a new project.
After deployment, open the Vercel URL. The dashboard will open as a normal website, no Chrome extension install needed.

Files included:
- index.html
- dashboard.js
- styles.css
- icons/
- api/fetch-url.js  (serverless proxy for image/page URLs that block browser CORS)

Important:
- Cloudinary unsigned preset must allow unsigned uploads.
- API keys saved in the browser localStorage if entered in the dashboard. For stronger protection, move OpenRouter/Cloudinary secret logic fully into backend environment variables later.
- Chrome-only features like hidden tab scraping cannot work on a normal website. I disabled that part and added serverless fetch proxy instead.
