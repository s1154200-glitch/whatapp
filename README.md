# WhatsApp iPhone archive viewer

A private, read-only viewer for the WhatsApp export in the parent folder. It recreates the iPhone chat screen and supports the complete message history, photos, stickers, voice notes, videos, documents, full-history search, and date navigation.

## Open on this Mac

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Open on an iPhone

1. Keep the Mac and iPhone on the same Wi-Fi network.
2. Run `npm run dev` on the Mac.
3. Find the Mac's local IP address in **System Settings → Wi-Fi → Details → IP Address**.
4. On the iPhone, open `http://MAC-IP-ADDRESS:3000` in Safari.
5. Optionally choose **Share → Add to Home Screen**.

The Mac must stay awake while the iPhone is using the local viewer.

## Archive preparation

`npm run prepare-chat` parses `../_chat.txt`, creates monthly data files, and hard-links the referenced media into `public/media`.

`npm run build` creates the verified production build in `dist`.

## GitHub Pages

`npm run build:pages` creates a static web build in `pages-dist`. The workflow in `.github/workflows/pages.yml` deploys that build from the `main` branch to:

```text
https://s1154200-glitch.github.io/whatapp/
```

The GitHub Pages build needs `public/data` and `public/media` in the repository. If the repository is public, the messages and every attachment are public too.

## Privacy

This project contains private family messages and media. Keep it local unless it is placed behind real access control. A secret URL or client-side password is not sufficient protection.
