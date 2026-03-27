# WhatsApp Count Me In Bot

![Docker Build and Publish](https://github.com/borlafu/whatsapp-count-me-in/actions/workflows/docker-publish.yml/badge.svg)

A simple WhatsApp bot for managing event sign-ups and waitlists in groups.

## Features
- **Group Admin ONLY**: Only group admins can create new events.
- **Waitlist Support**: Automatically manage waitlists when an event is full.
- **Automatic Promotion**: When someone leaves, the first person on the waitlist is notified to confirm their spot.
- **Active State**: Only one active event can be managed per group at a time.

## Commands
- `!create "Event Title" Slots`: Create a new event (Admins only).
- `!cancel`: Deactivate the current active event (Admins only).
- `!join`: Sign up for the event or join the waitlist.
- `!leave`: Withdraw from the event or waitlist.
- `!status`: Show the current list of participants and waitlist.
- `!lang en|es`: Change bot language (Admins only).
- `!help`: Show help message.

## Setup

The recommended way to run the bot is using the pre-built Docker image. This ensures a stable environment with all required headless Chromium dependencies.

### Using Docker (Recommended)

1. Create a persistent file for the database to avoid permission issues, and start the container:
   ```bash
   touch events.db
   
   docker run -it --rm \
     -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth \
     -v $(pwd)/events.db:/app/events.db \
     borlafu/whatsapp-count-me-in
   ```

2. Scan the QR code displayed in the terminal with your WhatsApp mobile app (Linked Devices).
3. The session is automatically saved to `.wwebjs_auth` and events to `events.db`.
4. Add the connected number to a WhatsApp group and start managing events!

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the bot:
   ```bash
   npm start
   ```


## Technology
- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [qrcode-terminal](https://github.com/gtanner/qrcode-terminal)
