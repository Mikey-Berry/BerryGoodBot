# BerryGoodBot: BerryTunes

A personal music app. Paste a video link and your Windows PC pulls out the audio. The song then lands in a music player on your iPhone that works offline.

```
iPhone (home-screen app)  ──Tailscale──▶  Windows PC
  • library + player                        • server/ (FastAPI)
  • songs saved on the phone                 • yt-dlp + ffmpeg download the audio
  • works with the PC off                    • keeps the master copy of your library
```

- **The PC is only needed to add songs.** Everything already on the phone plays with the PC off.
- **Links you add while the PC is off wait on the phone** and are sent automatically when the PC is reachable again.
- **Nothing is exposed to the internet.** Tailscale makes the PC reachable only from your own signed-in devices.
- **Audio is YouTube's native AAC stream (`.m4a`), saved without re-encoding.** Sources that aren't AAC are converted once at 192 kbps.
- **Supported sites:** YouTube and the [~1,800 sites yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), one video per link (no playlists yet).

## Setup

### 1. On the Windows PC

1. Download this repo (Code → Download ZIP, then right-click → **Extract All**) and put the folder somewhere permanent. Don't move it after step 3, or auto-start loses track of it.
2. In the `windows` folder, **double-click `setup.cmd`**.
   This installs Python, ffmpeg, Deno (which yt-dlp needs for YouTube) and Tailscale if they're missing, sets up the server and shares it over Tailscale.
   - On first run, Tailscale will ask you to **log in**. If it prints a link about **enabling HTTPS**, open it and click enable. Then run `setup.cmd` again.
   - At the end it prints an address like `https://your-pc.tail1234.ts.net`. **Keep it; that's your app's address.**
3. **Double-click `install-autostart.cmd`.** The server now starts hidden whenever you log in, and starts right away too.
   - To remove auto-start, run `install-autostart.cmd -Remove` from a terminal.
   - `start.cmd` runs the server in a visible window instead, which is handy for watching errors. Don't use it while auto-start is running; both use the same port.

   Use the `.cmd` files rather than the `.ps1` ones. Windows blocks `.ps1` scripts by default ("running scripts is disabled on this system"), and the `.cmd` files get around that for these scripts only.
4. Optional: in Windows **Settings → System → Power**, set sleep to "Never" while plugged in, or at least long enough to finish downloads you queue from your phone.

### 2. On the iPhone

1. Install **Tailscale** from the App Store and sign in with the **same account** as on the PC.
2. In **Safari**, open your `https://….ts.net` address.
3. Tap **Share → Add to Home Screen**. From now on, always open BerryTunes from the home-screen icon. Safari and the home-screen app keep separate libraries on the phone.

### 3. "Add to BerryTunes" in the Share sheet (recommended)

iOS doesn't let home-screen web apps appear in the Share sheet, so an iOS Shortcut sends the link to your PC instead:

1. Open **Shortcuts → +**, and name it **Add to BerryTunes**.
2. Tap the **ⓘ** (details) button and turn on **Show in Share Sheet**. Set it to receive **URLs** and **Text**.
3. Add the action **Get Contents of URL**:
   - URL: `https://your-pc.tail1234.ts.net/api/jobs`
   - Method: **POST**
   - Request Body: **JSON**, with one field: key `url`, type Text, value **Shortcut Input**
4. Add the action **Show Notification** with the text `Sent to BerryTunes`.

Now in YouTube (or any app), tap **Share → Add to BerryTunes**. Open BerryTunes a minute later and the song will be there and saved to the phone. The Shortcut needs the PC on. If it's off, paste the link into the app instead, and the app will hold it until the PC is back.

## Using it

- **Add:** paste a link and tap **Add**. Progress shows at the top.
- **Play:** tap a song. It plays through the list, and shuffle and repeat are in the full player (tap the mini player). Lock-screen controls and artwork work.
- **Song status icons:** ✅ saved on this device (plays offline) · ☁️ on your PC only (plays only while the PC is reachable) · ⬇️ saving now.
- **⋯ menu:** save to this device, open the original video, or delete. Delete removes the song from the PC and this phone.
- **Settings (gear):** auto-save new songs to this device (on by default), storage used, the yt-dlp version, and "save all songs now".
- **Several devices:** each device you add the app to downloads the PC's library, so they all stay in sync while the PC is on.

## If YouTube downloads start failing

1. **Restart the server** (log out and back in, or reboot). Every start updates yt-dlp, which fixes most breakages.
2. **Still failing with "Sign in to confirm you're not a bot"?** Give it cookies from a logged-in YouTube account:
   - Use a **secondary Google account, not your main one.** Google occasionally flags accounts used this way.
   - Log in to YouTube with it in your browser, export its cookies with the "Get cookies.txt LOCALLY" extension, and save the file as `server\cookies.txt`. Then restart the server.
3. Errors from each download show in the app, and the full server log is at `server\logs\server.log`.

## Where things live

| What | Where |
|---|---|
| Your music (master copy) | `server\library\` on the PC (`tracks.json` + `.m4a`/`.jpg` files) |
| Songs on the phone | Inside the home-screen app's storage |
| Server log | `server\logs\server.log` |

Back up `server\library\` if you care about it. iOS can clear a web app's saved files when the phone is very low on space. If that happens, the songs download again from the PC.

## Known limits

- **Background playback:** iOS has historically been flaky with audio in home-screen web apps (playback stopping when you lock the phone or switch apps). Recent iOS versions are much better, but check this first on your phone.
- **Playlists:** not supported yet. A playlist link is rejected with a message; links to a video inside a playlist download just that video.

## Project layout

```
server/    FastAPI app: API + serves the web app (app.py, downloader.py, library.py)
web/       The phone app: plain HTML/CSS/JS, service worker for offline use
windows/   setup, start and install-autostart scripts (.cmd launchers for the .ps1 files)
```

Run the server anywhere for development: `pip install -r server/requirements.txt`, then `cd server && uvicorn app:app --port 8765`, then open http://localhost:8765. Needs `ffmpeg` on PATH (or set `BERRY_FFMPEG` to its folder).
