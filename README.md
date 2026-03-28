# WhatsApp Count Me In Bot

![Docker Build and Publish](https://github.com/borlafu/whatsapp-count-me-in/actions/workflows/docker-publish.yml/badge.svg)

A super-lightweight WhatsApp bot for managing event sign-ups and waitlists in groups.

## Features
- **Group Admin ONLY**: Only group admins can create new events.
- **Waitlist Support**: Automatically manage waitlists when an event is full.
- **Automatic Promotion**: When someone leaves, the first person on the waitlist is notified to confirm their spot.
- **Active State**: Only one active event can be managed per group at a time.
- **Low Profile Engine**: Specifically designed to run in environments with 1GB RAM or less, consuming < 100MB of RAM.

## Commands
- `!create "Event Title" Slots`: Create a new event (Admins only).
- `!cancel`: Deactivate the current active event (Admins only).
- `!join` or `!waitlist`: Sign up for the event or join the waitlist.
- `!leave`: Withdraw from the event or waitlist.
- `!status`: Show the current list of participants and waitlist.
- `!lang en|es`: Change bot language (Admins only).
- `!help`: Show help message.

## Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the bot in development mode (TypeScript runs dynamically via `tsx`):
   ```bash
   npm start
   ```

3. Scan the QR code displayed in your terminal using WhatsApp (Menu > Linked Devices).
4. Note: Authentication data will be safely stored in the `.auth_info_baileys` folder.

## Build for Production

For lowest CPU and memory footprint, pre-compile the TypeScript source codes to JavaScript before deployment.

```bash
npm run build
```

Then, you can start the application natively:
```bash
node dist/index.js
```

## Deployment

The application runs seamlessly either natively (recommended for the absolute lowest RAM usage) or securely packaged inside a Docker container.

### Using Docker (Highly Recommended)
We provide a minimalist Docker image leveraging Alpine/Slim Node images.

1. Create a persistent folder to avoid credential loss, and a database file:
   ```bash
   mkdir .auth_info_baileys
   touch events.db
   ```

2. Run the container mapping the local volumes into the app configuration hooks:
   ```bash
   docker run -it --rm \
     -v $(pwd)/.auth_info_baileys:/app/.auth_info_baileys:z \
     -v $(pwd)/events.db:/app/events.db:z \
     borlafu/whatsapp-count-me-in
   ```

3. Scan the QR code via terminal block when first linking the device.

### Native via PM2

1. Build the app as described previously.
2. Install PM2 process monitor globally (`npm install -g pm2`).
3. Limit the application's aggressive memory consumption dynamically and start the cluster:
   ```bash
   pm2 start ecosystem.config.cjs
   ```
4. Follow logs to scan the QR code using:
   ```bash
   pm2 logs whatsapp-count-me-in
   ```

## Technology
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [pm2](https://github.com/Unitech/pm2)
